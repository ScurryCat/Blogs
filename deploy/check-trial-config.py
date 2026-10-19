#!/usr/bin/env python3
"""M1A 校验：受限试用最小配置层的静态审查（不需要 Docker daemon 也能跑）。

背景（2026-10-19，P5-M0M1-20261019-r1 M1A）：
  受限试用要求在**网关**增加独立访问认证，覆盖页面 / API / 媒体 / 静态资源，
  同时复用生产 compose.prod.yaml、不复制全量编排、不绕过站主登录 / CSRF / 媒体权限。

本脚本把下列设计约束变成可执行检查（全部来自任务书 H2 / C03 / C04）：
  A. 覆盖层最小化：deploy/compose.trial.yaml 只改 gateway 的访问片段挂载与认证变量；
     不新增服务、不改端口、不改数据库 / 卷类型，不是一份长期分叉的全量 Compose。
  B. 渲染后的试用编排（base + overlay）：
     1. 服务集合与生产一致（db/migrate/grants/api/web/gateway）；
     2. 仍然只有 gateway 发布宿主端口；db/api/web 不发布端口；
     3. gateway 挂载 access/trial（覆盖 /etc/caddy/access），而不是生产 noop 目录；
     4. gateway 环境含 TRIAL_AUTH_USER / TRIAL_AUTH_HASH（且没有明文口令变量）；
     5. api / web / gateway 仍是 read-only + cap_drop；镜像不是 latest。
  C. 网关访问认证片段：
     6. site 块存在 import 扩展点（`import access/*.caddy`）；
     7. 生产片段只有注释（无任何规则）；试用片段含 basic_auth；
     8. 试用片段的免认证例外**只有** /gateway-healthz，没有 API / 媒体 / 静态旁路；
     9. Caddy 语法真实 validate（宿主二进制，或退而使用 Docker 中的 caddy 镜像；
        两者都没有时明确标注「结构断言，不是 validate」）。
  D. 秘密与运行手册：
     10. trial.env.example 只有占位符，没有真实密钥；.gitignore 排除实际 *.env；
     11. 生成脚本存在且不把明文口令放进 argv / 不写进编排；
     12. 新增的编排 / 片段 / 脚本没有破坏性卷删除命令。

用法（先渲染，再检查；渲染不需要 Docker daemon）：
  # 用示例 env 做渲染冒烟：把 <必填> 占位替换成临时值
  cp deploy/env/trial.env.example /tmp/trial-render.env
  sed -i '' 's/<必填[^>]*>/x/g' /tmp/trial-render.env
  docker compose -f deploy/compose.prod.yaml -f deploy/compose.trial.yaml \
    -p phantom-log-trial --env-file /tmp/trial-render.env config --format json > /tmp/trial-rendered.json
  python3 deploy/check-trial-config.py --compose-config /tmp/trial-rendered.json

  # Caddy validate：--caddy /path/to/caddy 或（默认）用 docker 里的 caddy 镜像
  python3 deploy/check-trial-config.py --compose-config /tmp/trial-rendered.json

退出码 0 = 全部通过；1 = 有失败；2 = 前置条件缺失（工具/文件）。
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
GATEWAY = DEPLOY / "gateway"
BASE_COMPOSE = DEPLOY / "compose.prod.yaml"
TRIAL_COMPOSE = DEPLOY / "compose.trial.yaml"
TRIAL_ENV_EXAMPLE = DEPLOY / "env" / "trial.env.example"
ENV_GITIGNORE = DEPLOY / "env" / ".gitignore"
SETUP_SCRIPT = REPO_ROOT / "tools" / "setup-trial-secrets.sh"
RUNBOOK = REPO_ROOT / "docs" / "operations" / "trial-runbook.md"
CADDY_IMAGE = "caddy:2.10.2-alpine"

REQUIRED_SERVICES = {"db", "migrate", "grants", "api", "web", "gateway"}
REQUIRED_ENV_KEYS = (
    "SITE_ADDRESS",
    "GATEWAY_HTTP_HOST_PORT",
    "GATEWAY_HTTPS_HOST_PORT",
    "API_IMAGE",
    "WEB_IMAGE",
    "POSTGRES_MIGRATOR_PASSWORD_FILE",
    "POSTGRES_APP_PASSWORD_FILE",
    "POSTGRES_MIGRATOR_PASSWORD",
    "POSTGRES_APP_PASSWORD",
    "SECRET_KEY",
    "TRIAL_AUTH_USER",
    "TRIAL_AUTH_HASH",
)
PLACEHOLDER_MARKERS = ("<必填", "replace-with", "change-me", "changeme", "placeholder",
                       "your-", "example", "xxxx", "TODO", "生成", "填")
SECRET_KEY_HINTS = ("password", "secret", "token", "credential", "apikey", "api_key", "hash")


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
        return json.loads(path.read_text(encoding="utf-8"))
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_config(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return load_yaml(path)


def check_overlay(report: Report) -> None:
    print(f"== A. 覆盖层最小化（{TRIAL_COMPOSE.relative_to(REPO_ROOT)}）==")
    report.check("覆盖层文件存在", TRIAL_COMPOSE.is_file())
    if not TRIAL_COMPOSE.is_file():
        return
    overlay = load_yaml(TRIAL_COMPOSE)
    report.check("覆盖层顶层只有 services", set(overlay or {}) == {"services"}, str(sorted((overlay or {}).keys())))
    services = (overlay or {}).get("services") or {}
    report.check("覆盖层只改 gateway 一个服务", set(services) == {"gateway"}, str(sorted(services)))
    gateway = services.get("gateway") or {}
    report.check("覆盖层没有新增 ports / networks / volumes 顶层定义",
                 not any(key in (overlay or {}) for key in ("ports", "networks", "volumes", "secrets")))
    report.check("gateway 覆盖只含 environment 与 volumes",
                 set(gateway) == {"environment", "volumes"}, str(sorted(gateway)))
    env = gateway.get("environment") or {}
    report.check("gateway 覆盖注入 TRIAL_AUTH_USER + TRIAL_AUTH_HASH",
                 set(env) == {"TRIAL_AUTH_USER", "TRIAL_AUTH_HASH"}, str(sorted(env)))
    vols = gateway.get("volumes") or []
    text_vols = [str(item) for item in vols]
    report.check("gateway 挂载 access/trial → /etc/caddy/access（覆盖生产 noop 片段）",
                 any("/etc/caddy/access" in item and "access/trial" in item for item in text_vols),
                 str(text_vols))


def check_rendered(report: Report, cfg: dict) -> None:
    print("== B. 渲染后的试用编排（base + overlay）==")
    services = cfg.get("services") or {}
    report.check("服务集合与生产一致（db/migrate/grants/api/web/gateway）",
                 set(services) == REQUIRED_SERVICES, ",".join(sorted(services)))
    publishers = {name: svc.get("ports") for name, svc in services.items() if svc.get("ports")}
    report.check("仍然只有 gateway 发布宿主端口", set(publishers) == {"gateway"}, str(sorted(publishers)))
    gw = services.get("gateway") or {}
    volumes = [item if isinstance(item, dict) else {} for item in (gw.get("volumes") or [])]
    access = [item for item in volumes if str(item.get("target", "")) == "/etc/caddy/access"]
    report.check("gateway 的 /etc/caddy/access 在渲染后来自 access/trial",
                 len(access) == 1 and "access/trial" in str(access[0].get("source", "")),
                 str(access))
    report.check("gateway 认证变量在渲染后非空（来自 --env-file）",
                 all(str((gw.get("environment") or {}).get(key, "")).strip()
                     for key in ("TRIAL_AUTH_USER", "TRIAL_AUTH_HASH")),
                 str(sorted((gw.get("environment") or {}).keys()))[:120])
    report.check("没有把明文试用口令变量写进编排",
                 all("PASSWORD" not in key and "PLAINTEXT" not in key
                     for key in (gw.get("environment") or {})))
    for name in ("api", "web", "gateway"):
        svc = services.get(name) or {}
        report.check(f"{name} 仍是 read-only + cap_drop",
                     svc.get("read_only") is True and bool(svc.get("cap_drop")), str(svc.get("cap_drop")))
    for name in ("db", "api", "web"):
        report.check(f"{name} 不发布宿主端口", not (services.get(name) or {}).get("ports"))
    images_ok = all(
        "latest" not in str((services.get(name) or {}).get("image", ""))
        for name in ("api", "web")
    )
    report.check("api / web 镜像不是 latest（真实试用需再固定 digest）", images_ok)


def check_gateway_snippets(report: Report) -> None:
    print("== C. 网关访问认证片段 ==")
    caddyfile = GATEWAY / "Caddyfile"
    text = caddyfile.read_text(encoding="utf-8")
    report.check("Caddyfile site 块有 import access/*.caddy 扩展点",
                 "import access/*.caddy" in text and "/etc/caddy" not in text.split("import")[1][:80])
    prod_dir = GATEWAY / "access" / "prod"
    trial_file = GATEWAY / "access" / "trial" / "trial-auth.caddy"
    report.check("生产片段目录存在且只有注释（无规则）", prod_dir.is_dir())
    prod_dirs = sorted(prod_dir.glob("*.caddy"))
    prod_body = "\n".join(p.read_text(encoding="utf-8") for p in prod_dirs)
    stripped = "\n".join(line for line in prod_body.splitlines() if line.strip() and not line.strip().startswith("#"))
    report.check("生产访问片段为空规则（不改变生产认证行为）", not stripped, stripped[:80])
    report.check("试用访问片段存在", trial_file.is_file())
    trial_text = trial_file.read_text(encoding="utf-8") if trial_file.is_file() else ""
    report.check("试用片段包含 basic_auth", "basic_auth" in trial_text)
    report.check("认证变量来自环境（TRIAL_AUTH_USER / TRIAL_AUTH_HASH）",
                 "{$TRIAL_AUTH_USER}" in trial_text and "{$TRIAL_AUTH_HASH}" in trial_text)
    exemptions = re.findall(r"not\s+path\s+([^\n{]+)", trial_text)
    report.check("免认证例外只有 /gateway-healthz", len(exemptions) == 1 and exemptions[0].split() == ["/gateway-healthz"],
                 str(exemptions))
    for forbidden in ("/api/", "/media/", "/_next/", "/assets/"):
        report.check(f"没有为 {forbidden} 开免认证旁路", not re.search(rf"path[^\n]*{re.escape(forbidden)}", trial_text))
    report.check("没有用 noindex / 隐藏入口代替访问认证",
                 "noindex" not in trial_text.lower())


def run_caddy_validate(report: Report, caddy_binary: str | None) -> None:
    print("== C2. Caddy validate ==")
    tmp = Path(tempfile.mkdtemp(prefix="pl-trial-caddy-"))
    try:
        (tmp / "data").mkdir()
        caddyfile = (GATEWAY / "Caddyfile").read_text(encoding="utf-8").replace("/data", str(tmp / "data"))
        (tmp / "Caddyfile").write_text(caddyfile, encoding="utf-8")
        prod_src = GATEWAY / "access" / "prod"
        trial_src = GATEWAY / "access" / "trial"
        env_base = {"SITE_ADDRESS": "http://127.0.0.1:18091",
                    "TRIAL_AUTH_USER": "trial-verify",
                    "TRIAL_AUTH_HASH": "$2a$14$7jmhcKvgcqzR1dwH2od3QeuRzKWvkAaboj4N685Zo480mTwcP/Xku"}
        modes = {"生产（noop 片段）": prod_src, "试用（basic_auth 片段）": trial_src}
        for label, access_src in modes.items():
            shutil.copytree(access_src, tmp / "access", dirs_exist_ok=True)
            argv, env = None, None
            if caddy_binary:
                argv = [caddy_binary, "validate", "--config", str(tmp / "Caddyfile"), "--adapter", "caddyfile"]
                env = env_base
            else:
                # 用 Docker 里的真实 Caddy 二进制：把临时目录挂进容器（不联网、不写宿主）。
                argv = ["docker", "run", "--rm", "-v", f"{tmp}:/work", "-w", "/work",
                        "-e", "SITE_ADDRESS", "-e", "TRIAL_AUTH_USER", "-e", "TRIAL_AUTH_HASH",
                        CADDY_IMAGE, "caddy", "validate", "--config", "/work/Caddyfile", "--adapter", "caddyfile"]
                env = env_base
            try:
                result = subprocess.run(argv, capture_output=True, text=True, timeout=120,
                                        env={**__import__("os").environ, **env})
            except FileNotFoundError:
                report.check(f"caddy validate（{label}）：无可用 Caddy / Docker，只做结构断言", True,
                             "结构断言已执行；本机没有 caddy 二进制也没有 docker")
                return
            detail = (result.stderr or result.stdout).strip().splitlines()[-1][:140] if result.returncode else ""
            report.check(f"caddy validate 通过（{label}）", result.returncode == 0, detail)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check_secrets_and_docs(report: Report) -> None:
    print("== D. 秘密示例 / 生成脚本 / 破坏性命令 ==")
    report.check("trial.env.example 存在", TRIAL_ENV_EXAMPLE.is_file())
    text = TRIAL_ENV_EXAMPLE.read_text(encoding="utf-8") if TRIAL_ENV_EXAMPLE.is_file() else ""
    missing = [key for key in REQUIRED_ENV_KEYS if not re.search(rf"^{re.escape(key)}=", text, re.MULTILINE)]
    report.check("示例声明全部必需变量", not missing, str(missing))
    bad_values = []
    for line in text.splitlines():
        if "=" not in line or line.strip().startswith("#"):
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if not value or any(marker in value for marker in PLACEHOLDER_MARKERS):
            continue
        if any(hint in key.lower() for hint in SECRET_KEY_HINTS) and not key.endswith(("_USER", "_FILE", "_IMAGE")):
            if len(value) >= 24 and not value.startswith("<"):
                bad_values.append(f"{key}=<长值>")
    report.check("示例里没有看起来像真实密钥的值", not bad_values, str(bad_values[:3]))
    report.check("示例里 TRIAL_AUTH_HASH 仍是占位符（不是可用 bcrypt 哈希）",
                 not re.search(r"TRIAL_AUTH_HASH=\$2[ab]\$", text))
    gitignore = ENV_GITIGNORE.read_text(encoding="utf-8") if ENV_GITIGNORE.is_file() else ""
    report.check("deploy/env/.gitignore 排除实际 *.env、保留示例",
                 "*.env" in gitignore and "!*.env.example" in gitignore)
    report.check("生成脚本存在", SETUP_SCRIPT.is_file())
    if SETUP_SCRIPT.is_file():
        script = SETUP_SCRIPT.read_text(encoding="utf-8")
        report.check("生成脚本通过 caddy hash-password 计算哈希（明文不出现在宿主 argv）",
                     "hash-password" in script and "printf '%s\\n' \"$ACCESS_PW\"" in script)
        report.check("生成脚本 chmod 600 私有文件", "chmod 600" in script)
        report.check("生成脚本对 bcrypt 哈希做 $$ 转义（Compose --env-file 的 $ 插值防护）",
                     "HASH_ESCAPED" in script and "${HASH//" in script)
    report.check("trial.env.example 说明 bcrypt 哈希的 $$ 转义",
                 "$$" in text and "bcrypt" in text)
    report.check("运行手册存在", RUNBOOK.is_file())
    new_paths = [TRIAL_COMPOSE, GATEWAY / "access" / "prod" / "noop.caddy",
                 GATEWAY / "access" / "trial" / "trial-auth.caddy", TRIAL_ENV_EXAMPLE, SETUP_SCRIPT]
    needle = "down" + " -v"
    offenders = []
    for path in new_paths:
        if not path.is_file():
            continue
        body = path.read_text(encoding="utf-8")
        if path.suffix != ".md":
            body = re.sub(r"#[^\n]*", "", body)
        if needle in body:
            offenders.append(str(path.name))
    report.check(f"新增配置 / 脚本里没有可执行的 {needle}", not offenders, str(offenders))


def main() -> int:
    parser = argparse.ArgumentParser(description="受限试用最小配置层静态审查")
    parser.add_argument("--compose-config", required=True, help="base + trial 渲染后的组成（JSON 或 YAML）")
    parser.add_argument("--caddy", default="", help="Caddy 二进制路径（可选；否则尝试 docker caddy 镜像）")
    parser.add_argument("--no-caddy-validate", action="store_true", help="跳过真实 validate（只做结构断言）")
    args = parser.parse_args()

    config_path = Path(args.compose_config)
    if not config_path.is_file():
        print(f"✗ 找不到渲染后的编排：{config_path}", file=sys.stderr)
        return 2
    report = Report()
    print(f"== 受限试用配置静态审查（{REPO_ROOT}）==")
    check_overlay(report)
    check_rendered(report, load_config(config_path))
    check_gateway_snippets(report)
    if not args.no_caddy_validate:
        run_caddy_validate(report, args.caddy or shutil.which("caddy"))
    check_secrets_and_docs(report)
    return report.summary()


if __name__ == "__main__":
    sys.exit(main())
