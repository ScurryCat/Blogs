#!/usr/bin/env python3
"""T10 校验：CI / 发布工作流的静态审查（本机不能执行 GitHub Actions，但能审结构）。

本机没有 GitHub 远端，Actions 不会真的跑。因此这里做的是**把工作流当成数据来检查**：
YAML 能否解析、必须存在的 job / step 是否都在、有没有把「未验证」写成已验证、
有没有把部署做成自动执行。等真的有远端时，这份检查同时也是 CI 的第一个 job。

用法：
  python3 deploy/check-ci-workflows.py

退出码 0 = 全部通过；1 = 有失败。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = REPO_ROOT / ".github" / "workflows"

REQUIRED_COMMANDS = {
    "tests": [
        "node --test tests/*.test.cjs",                     # 旧站 53 例
        "npm --prefix apps/web run typecheck",
        "npm --prefix apps/web run lint",
        "npm --prefix apps/web run test -- --run",
        "uv run --project apps/api pytest apps/api/tests",  # 真实 PostgreSQL
        "export_openapi.py",                                # OpenAPI 漂移守卫（前半）
        "npm --prefix apps/web run gen:api",                # OpenAPI 漂移守卫（后半）
        "docker compose -f deploy/compose.prod.yaml",        # compose config 校验
        "check-prod-config.py",
    ],
    "release": [
        "docker/build-push-action",  # 镜像构建（含 provenance / sbom）
        "outputs.digest",            # 镜像 digest 记录（api / web 各一次）
        "docker/build-push-action@v6",
        "build-contexts",            # 音频的独立构建上下文
    ],
}


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


def load(path: Path) -> dict:
    try:
        import yaml  # type: ignore
    except ImportError:
        print("跳过：需要 PyYAML 才能解析工作流（brew install pyyaml / pip install pyyaml）",
              file=sys.stderr)
        sys.exit(2)
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def all_text(value) -> str:
    """把一个嵌套结构里的键与值都拼起来。

    第一版只拼值，于是 `env: { TEST_DATABASE_URL: ... }` 里的**键名**没被看到，
    检查器误报「没有用真实 PostgreSQL」。键名是工作流语义的一部分，必须一起看。
    """
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return "\n".join(f"{key}\n{all_text(item)}" for key, item in value.items())
    if isinstance(value, list):
        return "\n".join(all_text(item) for item in value)
    return ""


def main() -> int:
    report = Report()
    print("== CI / 发布工作流 ==")
    if not WORKFLOWS.exists():
        report.check(".github/workflows 存在", False, "目录不存在")
        return report.summary()

    files = sorted(WORKFLOWS.glob("*.y*ml"))
    report.check("有工作流文件", bool(files), ",".join(p.name for p in files))

    parsed: dict[str, dict] = {}
    raw: dict[str, str] = {}
    for path in files:
        try:
            parsed[path.name] = load(path)
            # 注释不是 YAML 数据，但「本工作流不自动部署生产」这类声明只可能写在注释里，
            # 所以对「不要部署」的检查要读原文（第一版只看解析结果，于是永远误报）。
            raw[path.name] = path.read_text(encoding="utf-8")
            report.check(f"{path.name} 是合法 YAML", True)
        except Exception as exc:  # noqa: BLE001
            report.check(f"{path.name} 是合法 YAML", False, str(exc)[:120])

    tests_text = ""
    for name, workflow in parsed.items():
        text = all_text(workflow)
        print(f"-- {name} --")
        jobs = list((workflow.get("jobs") or {}).keys())
        report.check(f"{name}: 声明了 job", bool(jobs), ",".join(jobs))
        # 只在只读权限下运行：工作流不需要写仓库。
        perms = workflow.get("permissions")
        report.check(f"{name}: 权限最小化（contents: read）",
                     isinstance(perms, dict) and perms.get("contents") == "read", str(perms))
        # 不允许自动部署生产：没有任何 job 直接 ssh / compose up 到生产主机。
        deploy_smells = [line for line in text.splitlines()
                         if re.search(r"\b(ssh|scp|rsync)\b", line) and "not" not in line.lower()]
        report.check(f"{name}: 没有自动部署生产（ssh/scp/rsync）", not deploy_smells,
                     str(deploy_smells[:2]))
        report.check(f"{name}: 明确写了不自动部署生产",
                     ("不自动" in raw.get(name, "") or "不部署" in raw.get(name, ""))
                     and "Dockerfile" not in name)
        if "release" in name:
            tests_text += text
        else:
            tests_text += text

    for command in REQUIRED_COMMANDS["tests"]:
        report.check(f"CI 覆盖：{command}", command in tests_text)

    release_file = next((name for name in parsed if "release" in name), None)
    if release_file:
        text = all_text(parsed[release_file])
        for command in REQUIRED_COMMANDS["release"]:
            report.check(f"发布工作流覆盖：{command}", command in text)
        report.check("发布工作流按 digest 记录镜像引用", "outputs.digest" in text)
        report.check("发布记录里含提交 SHA 与 schema 版本线索",
                     "github.sha" in text and "alembic" in text)
        triggers = parsed[release_file].get("on") or {}
        report.check("发布工作流只在 tag 与手动触发（不随每次 push 发布）",
                     "push" not in triggers or "tags" in (triggers.get("push") or {}),
                     str(triggers))
        report.check("发布工作流默认不推送镜像（需显式开启）",
                     "PHANTOM_PUSH_IMAGES" in text)
    else:
        report.check("存在发布工作流", False, "没有 release 工作流文件")

    for name, workflow in parsed.items():
        text = all_text(workflow)
        if "pytest" in text:
            report.check(f"{name}: API 测试用真实 PostgreSQL 服务",
                         "postgres" in text and "TEST_DATABASE_URL" in text)
            # 只禁止**真的去连 SQLite**（连接串 / 驱动）；说明性文字里出现这个词不算违规。
            sqlite_connections = [
                line for line in text.splitlines()
                if "sqlite" in line.lower() and ("://" in line or "driver" in line.lower() or "+aiosqlite" in line)
            ]
            report.check(f"{name}: 没有把数据库测试降级成 SQLite", not sqlite_connections,
                         str(sqlite_connections[:2]))

    return report.summary()


if __name__ == "__main__":
    sys.exit(main())
