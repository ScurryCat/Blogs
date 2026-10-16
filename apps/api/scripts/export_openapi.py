"""导出 OpenAPI 文档到 `contracts/openapi.json`。

契约（SHARED-CONTRACTS §2 / 01 §7）：`contracts/openapi.json` 由 T00 拥有，
从**已挂载的后端**生成，前端类型由它派生（`apps/web` 的 `npm run gen:api`），
不手写第二套字段映射。CI / 测试用同一函数检查漂移。

用法（仓库根目录）：
    uv run --project apps/api python apps/api/scripts/export_openapi.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = REPO_ROOT / "contracts" / "openapi.json"

# 导出只需要能构造应用；不连数据库、不读真实密钥。
EXPORT_PLACEHOLDER_SECRET = "openapi-export-placeholder-not-a-secret-0123456789"
EXPORT_PLACEHOLDER_DATABASE = "postgresql+psycopg://export:export@127.0.0.1:5432/export_placeholder"


def build_schema() -> dict:
    """构造应用并返回 OpenAPI schema。导入放在函数内，避免脚本被 import 时产生副作用。"""
    os.environ.setdefault("APP_ENV", "dev")
    os.environ.setdefault("DATABASE_URL", EXPORT_PLACEHOLDER_DATABASE)
    os.environ.setdefault("SECRET_KEY", EXPORT_PLACEHOLDER_SECRET)

    from app.core.config import Settings
    from app.main import create_app

    app = create_app(settings=Settings(), module_routers={})
    return app.openapi()


def serialized_schema() -> str:
    """稳定序列化：键排序 + 结尾换行，让「有没有变化」可以直接 diff。"""
    return json.dumps(build_schema(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(serialized_schema(), encoding="utf-8")
    print(f"已写入 {OUTPUT.relative_to(REPO_ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
