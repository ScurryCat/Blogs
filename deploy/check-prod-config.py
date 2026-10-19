#!/usr/bin/env python3
"""T10 校验：生产部署配置的静态审查（不需要 Docker daemon 也能跑）。

为什么要有这个脚本：本机 Docker daemon 不可用，容器构建与启动**没有**被验证过
（见交付单的未验证项）。在没有 daemon 的前提下，能做实的是把「生产配置里不该出现
的东西」变成可执行检查，而不是靠人肉阅读 YAML。

检查项（全部来自 06 §2 / §6 与 T10 任务卡的硬约束）：

  A. 渲染后的生产编排（`docker compose config` 的输出；没有 daemon 也能渲染）
     1. 只有 gateway 发布宿主端口；db / api / web 一个端口都不发布。
     2. db 与 api 在 `internal: true` 的网络上；web 不在数据库网络上。
     3. web 的环境变量里没有任何数据库凭据（名字或值）。
     4. api / web 不挂源码目录（没有指向仓库源码的 bind mount）。
     5. 没有任何服务使用 `privileged` 或挂载 docker socket。
     6. api / web / gateway 都是非 root 的 read-only 根文件系统 + cap_drop。
     7. 镜像引用不是 `latest`，且 API / WEB 镜像带 digest（生产要求不可变）。
     8. 没有 `down -v` 之类的卷删除动作出现在任何编排 / 脚本里。
  A2. 健康检查契约与依赖启动（D1 回归保护，2026-10-19）
     15. db / api / web / gateway 都启用健康检查，且没有 `disable: true`。
     16. api 健康检查打**真实 readiness** `/api/v1/health/ready`（不是 liveness），
         且期望的 `status` 与 `apps/api/app/core/health.py` 的成功状态词一致
         （D1 根因就是这里写死成 `"ok"` 而后端返回 `"ready"`）。
     17. 依赖启动链：migrate 等 db 健康；grants（运行账号授权）等 migrate 成功；
         api 等 migrate + grants 成功 + db 健康；web 等 api 健康；
         gateway 等 web + api 健康（06 §3 / D1 隔离验证补全）。
  B. Caddyfile
     9. 用真实 Caddy 二进制（若提供 `--caddy`）做 `caddy validate`；
        没有二进制时退回结构断言，并在输出里明确标注「结构断言，不是 validate」。
    10. API 与音频两条 `handle` 都在兜底 `handle {}` 之前（Caddyfile 里的顺序决定匹配）。
    11. 没有把 `Host` 改写成上游地址、没有删 `Origin`（那会破坏同源校验）。
     11b. M1A（2026-10-19）：Caddyfile 有 `import access/*.caddy` 扩展点；生产片段为空规则，
          受限试用片段存在且含 basic_auth（由 deploy/check-trial-config.py 做完整审查）。
  C. Dockerfile / 环境变量示例
    12. 生产 Dockerfile 里没有 `ARG`/`ENV` 形式的密钥，没有 `dev` 阶段的源码挂载。
    14b. web 镜像的音频必须走独立命名构建上下文 `music=assets/music`（D1 隔离验证时
         发现旧写法会把整个仓库复制进 public/ 并打挂生产构建）。
    13. `.env` 示例文件里没有看起来像真实密钥的值。
    14. `.dockerignore` 没有排除镜像真正需要的输入路径。

用法：
  python3 deploy/check-prod-config.py --compose-config /tmp/rendered.yaml \
      --caddy /tmp/caddybin/caddy --env-file deploy/env/prod.env.example

退出码 0 = 全部通过；1 = 有失败。
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEPLOY = REPO_ROOT / "deploy"

# 密钥像是「真值」的形状：够长、不是占位符语法。
PLACEHOLDER_MARKERS = (
    "<必填", "replace-with", "change-me", "changeme", "placeholder", "your-", "example",
    "xxxx", "TODO", "生成", "填",
)
SECRET_KEY_HINTS = ("password", "secret", "token", "credential", "apikey", "api_key")

# 镜像输入路径：`.dockerignore` 里出现这些条目就意味着镜像会缺东西。
REQUIRED_BUILD_INPUTS = (
    "apps/api/app",
    "apps/api/migrations",
    "apps/api/alembic.ini",
    "apps/api/pyproject.toml",
    "apps/api/uv.lock",
    "apps/web/package.json",
    "apps/web/package-lock.json",
    "apps/web/next.config.ts",
    "apps/web/public",
    "assets/music",
)


class Report:
    def __init__(self) -> None:
        self.results: list[tuple[str, bool, str]] = []

    def check(self, label: str, condition: bool, detail: str = "") -> bool:
        self.results.append((label, bool(condition), detail))
        print(f"  {'✓' if condition else '✗'} {label}" + (f"  {detail}" if detail else ""))
        return bool(condition)

    def summary(self) -> int:
        failed = [item for item in self.results if not item[1]]
        print(f"\n== 汇总：{len(self.results) - len(failed)}/{len(self.results)} 通过 ==")
        for label, _, detail in failed:
            print(f"  ✗ {label}  {detail}")
        return 1 if failed else 0


def load_yaml(path: Path) -> dict:
    try:
        import yaml  # type: ignore
    except ImportError:
        # 没有 PyYAML 时退回 compose 自己的 json 输出（`docker compose config --format json`）。
        return json.loads(path.read_text(encoding="utf-8"))
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def check_compose(report: Report, cfg: dict, source: str) -> None:
    services = cfg.get("services") or {}
    print(f"== A. 生产编排（{source}）==")
    report.check("编排里有 gateway / web / api / db / migrate / grants",
                 {"gateway", "web", "api", "db", "migrate", "grants"} <= set(services),
                 ",".join(sorted(services)))

    publishers = {name: svc.get("ports") for name, svc in services.items() if svc.get("ports")}
    report.check("只有 gateway 发布宿主端口", set(publishers) == {"gateway"},
                 f"发布了端口: {sorted(publishers)}")

    # D1 复验（2026-10-19）发现：grants 复用 postgres 镜像会为镜像 VOLUME 建匿名卷，
    # `compose down` 不删，反复部署会累积。要求显式 tmpfs 覆盖该路径。
    grants_tmpfs = (services.get("grants") or {}).get("tmpfs")
    report.check("grants 用 tmpfs 覆盖 postgres 镜像 VOLUME（避免部署泄漏匿名卷）",
                 bool(grants_tmpfs) and any("/var/lib/postgresql" in str(item) for item in grants_tmpfs),
                 str(grants_tmpfs))

    db_networks = set((services.get("db") or {}).get("networks") or {})
    api_networks = set((services.get("api") or {}).get("networks") or {})
    web_networks = set((services.get("web") or {}).get("networks") or {})
    internal = {name for name, net in (cfg.get("networks") or {}).items() if (net or {}).get("internal")}
    report.check("db 在 internal 网络上", bool(db_networks & internal), f"db={sorted(db_networks)} internal={sorted(internal)}")
    report.check("api 同时接内部数据网络", bool(api_networks & internal), f"api={sorted(api_networks)}")
    report.check("web 不在数据库网络上", not (web_networks & internal) and not (web_networks & db_networks),
                 f"web={sorted(web_networks)}")

    web_env = (services.get("web") or {}).get("environment") or {}
    leaked = [key for key in web_env if any(hint in key.lower() for hint in SECRET_KEY_HINTS)]
    report.check("web 不持有任何数据库凭据（环境变量名）", not leaked, str(leaked))
    report.check("web 没有 DATABASE_URL", "DATABASE_URL" not in web_env)

    source_mounts = []
    for name, svc in services.items():
        for volume in svc.get("volumes") or []:
            source_path = str(volume.get("source") or "")
            if source_path.startswith(str(REPO_ROOT)) and "/deploy/" not in source_path:
                source_mounts.append((name, source_path))
    report.check("没有服务挂载仓库源码目录（生产不挂源码）", not source_mounts, str(source_mounts))

    privileged = [name for name, svc in services.items() if svc.get("privileged")]
    report.check("没有 privileged 服务", not privileged, str(privileged))

    socket_mounts = [
        (name, str(volume.get("source")))
        for name, svc in services.items()
        for volume in svc.get("volumes") or []
        if "docker.sock" in str(volume.get("source"))
    ]
    report.check("没有挂载 docker socket", not socket_mounts, str(socket_mounts))

    for name in ("api", "web", "gateway"):
        svc = services.get(name) or {}
        report.check(f"{name}: read_only 根文件系统", svc.get("read_only") is True)
        report.check(f"{name}: cap_drop ALL", (svc.get("cap_drop") or []) == ["ALL"],
                     str(svc.get("cap_drop")))
        report.check(f"{name}: no-new-privileges",
                     "no-new-privileges:true" in (svc.get("security_opt") or []),
                     str(svc.get("security_opt")))

    images = {name: str(svc.get("image") or "") for name, svc in services.items()}
    report.check("没有服务使用 latest 标签",
                 not [name for name, image in images.items() if image.endswith(":latest")],
                 str({k: v for k, v in images.items() if v.endswith(":latest")}))
    for name in ("api", "web"):
        report.check(f"{name} 镜像按 digest 固定", "@sha256:" in images.get(name, ""),
                     images.get(name, "")[:70])


HEALTH_READY_PATH = "/api/v1/health/ready"


def _healthcheck_test(service: dict) -> str:
    """把渲染后的 healthcheck.test（list 或 str）折成一段可搜索的文本。"""
    healthcheck = service.get("healthcheck") or {}
    test = healthcheck.get("test")
    if isinstance(test, list):
        return " ".join(str(part) for part in test)
    return str(test or "")


def _depends_conditions(service: dict) -> dict[str, str | None]:
    deps = service.get("depends_on") or {}
    out: dict[str, str | None] = {}
    for name, spec in deps.items():
        out[name] = spec.get("condition") if isinstance(spec, dict) else None
    return out


def check_health_and_dependencies(report: Report, cfg: dict) -> None:
    """D1 回归保护：健康检查契约必须与后端 readiness 实际响应一致，依赖链必须显式。"""
    print("== A2. 健康检查契约与依赖启动（D1）==")
    services = cfg.get("services") or {}

    health_py = (REPO_ROOT / "apps/api/app/core/health.py").read_text(encoding="utf-8")
    match = re.search(
        r'"status"\s*:\s*"([a-z_]+)"\s+if\s+ready\s+else\s+"([a-z_]+)"', health_py
    )
    report.check("能从 health.py 读到 readiness 成功/未就绪状态词", match is not None)
    ready_word = match.group(1) if match else ""
    not_ready_word = match.group(2) if match else ""
    report.check("readiness 成功状态词是 ready", ready_word == "ready", ready_word or "未找到")

    # 长驻服务必须启用健康检查；禁用健康检查属于「绕过问题」，不接受。
    for name in ("db", "api", "web", "gateway"):
        svc = services.get(name) or {}
        healthcheck = svc.get("healthcheck") or {}
        report.check(
            f"{name}: 启用健康检查（未 disable）",
            bool(healthcheck) and not bool(healthcheck.get("disable")),
            f"healthcheck={healthcheck}",
        )

    api_test = _healthcheck_test(services.get("api") or {})
    report.check(
        "api 健康检查调用真实 readiness /api/v1/health/ready（不是 liveness）",
        HEALTH_READY_PATH in api_test,
    )
    expected = re.search(r'body\.get\("status"\)\s*==\s*"([a-z_]+)"', api_test)
    report.check(
        "api 健康检查期望的 status 与后端 readiness 成功状态词一致（D1：不能写死 ok）",
        expected is not None and expected.group(1) == ready_word,
        f"healthcheck={expected.group(1) if expected else None!r} backend={ready_word!r}",
    )
    report.check(
        "api 健康检查没有把未就绪状态词当成功",
        expected is not None and expected.group(1) != not_ready_word,
        f"not_ready={not_ready_word!r}",
    )

    migrate_deps = _depends_conditions(services.get("migrate") or {})
    grants_deps = _depends_conditions(services.get("grants") or {})
    api_deps = _depends_conditions(services.get("api") or {})
    web_deps = _depends_conditions(services.get("web") or {})
    gateway_deps = _depends_conditions(services.get("gateway") or {})

    report.check(
        "migrate 等 db 健康后执行",
        migrate_deps.get("db") == "service_healthy",
        str(migrate_deps),
    )
    report.check(
        "grants 等 migrate 成功 + db 健康后才执行（运行账号授权）",
        grants_deps.get("migrate") == "service_completed_successfully"
        and grants_deps.get("db") == "service_healthy",
        str(grants_deps),
    )
    report.check(
        "api 等 migrate + grants 成功 + db 健康后才启动",
        api_deps.get("migrate") == "service_completed_successfully"
        and api_deps.get("grants") == "service_completed_successfully"
        and api_deps.get("db") == "service_healthy",
        str(api_deps),
    )
    report.check(
        "web 等 api 健康后才启动",
        web_deps.get("api") == "service_healthy",
        str(web_deps),
    )
    report.check(
        "gateway 等 web + api 都健康后才启动",
        gateway_deps.get("web") == "service_healthy"
        and gateway_deps.get("api") == "service_healthy",
        str(gateway_deps),
    )


def check_caddy(r: Report, caddy_binary: str | None) -> None:
    print("== B. Caddyfile ==")
    caddyfile = DEPLOY / "gateway" / "Caddyfile"
    text = caddyfile.read_text(encoding="utf-8")

    order = []
    for match in re.finditer(r"^\t(handle[^\n{]*)\{", text, re.MULTILINE):
        order.append(match.group(1).strip())
    api_index = next((i for i, item in enumerate(order) if "/api/v1" in item), None)
    music_index = next((i for i, item in enumerate(order) if "/assets/music" in item), None)
    fallback_index = next((i for i, item in enumerate(order) if item == "handle"), None)
    r.check("API 的 handle 在兜底 handle 之前",
            api_index is not None and fallback_index is not None and api_index < fallback_index,
            f"顺序 {order}")
    r.check("音频的 handle 在兜底 handle 之前",
            music_index is not None and fallback_index is not None and music_index < fallback_index)
    r.check("网关自身探针在兜底 handle 之前",
            "gateway-healthz" in text and text.index("gateway-healthz") < text.rindex("handle {"))

    rewritten_host = re.search(r"header_up\s+Host", text)
    r.check("没有改写 Host（同源校验依赖它与 Origin 一致）", rewritten_host is None,
            rewritten_host.group(0) if rewritten_host else "")
    r.check("没有删除 Origin 的指令", "-Origin" not in text and "header_up -Origin" not in text)
    r.check("明确标注不做业务限流（06 §1）", "速率限制" in text or "rate" in text.lower())

    # M1A（2026-10-19）：网关访问控制片段扩展点。生产为空规则占位（不改变生产行为），
    # 受限试用由 compose.trial.yaml 覆盖为 access/trial（basic_auth）。
    r.check("Caddyfile 有访问控制扩展点（import access/*.caddy）",
            "import access/*.caddy" in text)
    prod_access = DEPLOY / "gateway" / "access" / "prod"
    trial_access = DEPLOY / "gateway" / "access" / "trial"
    r.check("生产访问片段存在（空规则占位）",
            prod_access.is_dir() and any(prod_access.glob("*.caddy")))
    r.check("受限试用访问片段存在（含 basic_auth）",
            trial_access.is_dir()
            and any("basic_auth" in p.read_text(encoding="utf-8") for p in trial_access.glob("*.caddy")))

    if not caddy_binary:
        r.check("caddy validate（未提供 --caddy，只做了结构断言）", True,
                "结构断言已执行；validate 需要 Caddy 二进制")
        return
    with tempfile.TemporaryDirectory() as tmp:
        sandbox = Path(tmp) / "Caddyfile"
        # 把持久化路径换到临时目录：本机对 /data 没有写权限，而这只影响日志输出目录。
        sandbox.write_text(text.replace("/data", str(Path(tmp) / "data")), encoding="utf-8")
        Path(tmp, "data").mkdir(exist_ok=True)
        # Caddyfile 用 `import access/*.caddy` 引入访问控制片段；沙箱需要同样的相对目录，
        # 否则 validate 会因找不到 import 文件失败。生产片段是空规则，validate 结果与线上一致。
        access_src = DEPLOY / "gateway" / "access" / "prod"
        if access_src.is_dir():
            shutil.copytree(access_src, Path(tmp) / "access")
        result = subprocess.run([caddy_binary, "validate", "--config", str(sandbox),
                                 "--adapter", "caddyfile"], capture_output=True, text=True)
        version = subprocess.run([caddy_binary, "version"], capture_output=True, text=True).stdout.strip()
        r.check(f"caddy validate 通过（{version}）", result.returncode == 0,
                (result.stderr or result.stdout).strip().splitlines()[-1][:120]
                if result.returncode else "")


def check_dockerfiles(report: Report) -> None:
    print("== C. Dockerfile / 环境变量示例 ==")
    for name in ("prod.Dockerfile.api", "prod.Dockerfile.web"):
        text = (DEPLOY / name).read_text(encoding="utf-8")
        secret_args = [
            line for line in text.splitlines()
            if re.match(r"\s*(ARG|ENV)\s", line) and any(hint in line.lower() for hint in SECRET_KEY_HINTS)
        ]
        report.check(f"{name}: 构建层没有密钥类 ARG / ENV", not secret_args, str(secret_args[:2]))
        report.check(f"{name}: 声明并切换到非 root 用户",
                     re.search(r"^USER\s+(?!root)", text, re.MULTILINE) is not None)
        report.check(f"{name}: 锁定依赖（npm ci / uv sync --frozen）",
                     "npm ci" in text or "uv sync --frozen" in text)
    web = (DEPLOY / "prod.Dockerfile.web").read_text(encoding="utf-8")
    report.check("web 镜像显式包含 public 与 .next/static（standalone 不会自动带）",
                 "/srv/apps/web/public" in web and "/srv/apps/web/.next/static" in web)
    # D1 隔离验证时发现的构建缺陷（2026-10-19）：music 必须用独立命名构建上下文，
    # 不能 `FROM scratch AS music; COPY . /music/`（会把整个仓库复制进 public/ 并打挂 tsc）。
    release_yml = (REPO_ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
    report.check(
        "web Dockerfile 用命名构建上下文引用 music（而非复制整个主上下文）",
        "COPY --from=music /" in web
        and re.search(r"^FROM\s+scratch\s+AS\s+music", web, re.MULTILINE) is None,
    )
    report.check(
        "web 构建保留 apps/web 层级且 CMD 与 standalone 路径一致（否则启动即 MODULE_NOT_FOUND）",
        "WORKDIR /srv\n" in web
        and "COPY apps/web/ ./apps/web/" in web
        and 'CMD ["node", "apps/web/server.js"]' in web,
    )
    report.check("release workflow 传入 music=assets/music 构建上下文",
                 "music=assets/music" in release_yml)

    for env_name in ("prod.env.example", "dev.env.example"):
        path = DEPLOY / "env" / env_name
        text = path.read_text(encoding="utf-8")
        suspicious = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # `*_FILE` 是「密钥文件路径」，不是密钥本身；路径短、可为空，且本来就该出现。
            if key.endswith("_FILE"):
                continue
            if not value or len(value) < 12:
                continue
            if any(hint in key.lower() for hint in SECRET_KEY_HINTS):
                if not any(marker.lower() in value.lower() for marker in PLACEHOLDER_MARKERS):
                    suspicious.append(key)
        report.check(f"{env_name}: 没有像真值的密钥（*_FILE 路径不算密钥）", not suspicious, str(suspicious))

    dockerignore = (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8")
    patterns = [line.strip() for line in dockerignore.splitlines()
                if line.strip() and not line.strip().startswith("#")]
    offenders = [pattern for pattern in patterns
                 if any(pattern.rstrip("/") == required for required in REQUIRED_BUILD_INPUTS)]
    # `assets/music` 是**刻意**排除的：它由独立的 `music` 构建上下文提供
    # （compose 的 additional_contexts / CI 的 --build-context），理由见 prod.Dockerfile.web。
    allowed_exclusions = {"assets/music"}
    offenders = [pattern for pattern in offenders if pattern.rstrip("/") not in allowed_exclusions]
    report.check(".dockerignore 没有排除镜像需要的输入路径（music 走独立上下文）",
                 not offenders, str(offenders))
    report.check(".dockerignore 排除了密钥文件", any(".env" in pattern for pattern in patterns))
    report.check(".dockerignore 排除了 node_modules 与 .venv",
                 any("node_modules" in pattern for pattern in patterns)
                 and any(".venv" in pattern for pattern in patterns))
    report.check(".dockerignore 排除了前端测试文件（否则镜像内 tsc 会因缺 tests/ helper 失败）",
                 any(pattern.endswith("*.test.ts") for pattern in patterns)
                 and any(pattern.endswith("*.test.tsx") for pattern in patterns))


def strip_docstrings_and_comments(text: str, suffix: str) -> str:
    """去掉注释与文档字符串，只留下「会真的被执行」的文本。

    第一版直接在原文里搜 `down -v`，结果把「本脚本不做 down -v」这种**声明**当成了违规。
    检查器自己的注释也算违规 —— 那种检查没有意义，只能改成先剥离再搜。
    """
    if suffix == ".py":
        # 去掉三引号文档字符串（含多行）与 `#` 注释。
        text = re.sub(r'"""(?:.|\n)*?"""', "", text)
        text = re.sub(r"'''(?:.|\n)*?'''", "", text)
        text = re.sub(r"#[^\n]*", "", text)
        return text
    if suffix in (".yaml", ".yml", ".sh", ".sql", ""):
        return re.sub(r"#[^\n]*", "", text)
    if suffix == ".md":
        return ""  # Markdown 只是文档，不会被执行
    return text


def check_no_down_v(report: Report, compose_path: Path) -> None:
    print("== D. 破坏性命令扫描 ==")
    # 用拼接构造被搜索的字面量：这个文件本身是检查器，不该把自己的检测代码当违规。
    needle = "down" + " -v"
    needle_long = "down" + " --volumes"
    self_path = Path(__file__).resolve()
    offenders = []
    for path in sorted(DEPLOY.rglob("*")) + [compose_path]:
        if not path.is_file() or path.resolve() == self_path:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        body = strip_docstrings_and_comments(text, path.suffix)
        for line in body.splitlines():
            if needle in line or needle_long in line:
                offenders.append(f"{path.relative_to(REPO_ROOT)}: {line.strip()[:80]}")
    report.check(f"脚本与编排里没有可执行的 {needle}", not offenders, str(offenders[:3]))


def main() -> int:
    parser = argparse.ArgumentParser(description="生产部署配置静态审查")
    parser.add_argument("--compose-config", required=True,
                        help="`docker compose config` 的输出（YAML 或 JSON）")
    parser.add_argument("--caddy", default="", help="Caddy 二进制路径（可选，用于真 validate）")
    parser.add_argument("--compose-file", default=str(DEPLOY / "compose.prod.yaml"))
    args = parser.parse_args()

    report = Report()
    config_path = Path(args.compose_config)
    cfg = load_yaml(config_path)
    check_compose(report, cfg, str(config_path))
    check_health_and_dependencies(report, cfg)
    check_caddy(report, args.caddy or shutil.which("caddy"))
    check_dockerfiles(report)
    check_no_down_v(report, Path(args.compose_file))
    return report.summary()


if __name__ == "__main__":
    sys.exit(main())
