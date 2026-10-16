"""环境配置。

契约（T00 执行清单）：共同配置由 T00 定义；**共享配置与构建不含密钥**。
这里没有任何密钥默认值：DATABASE_URL 与 SECRET_KEY 都是必填项，缺失即启动失败，
以免「本地能跑」的默认值被顺手带进生产。

环境变量（无前缀，均为必填或显式默认）：
  APP_ENV           dev | test | prod，默认 dev
  DATABASE_URL      PostgreSQL 连接串，必填
  SECRET_KEY        签名密钥，必填，至少 32 字符
  TEST_DATABASE_URL 仅测试使用，由 apps/api/tests/conftest.py 读取并校验
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["dev", "test", "prod"]

# 明显的占位符：出现在生产环境即拒绝启动。
PLACEHOLDER_SECRETS = {
    "change-me",
    "changeme",
    "secret",
    "dev",
    "test",
    "placeholder",
    "your-secret-key",
    "xxxxxxxx",
}

API_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=API_DIR / ".env",
        env_file_encoding="utf-8",
        extra="forbid",
        case_sensitive=False,
    )

    app_env: Environment = "dev"
    database_url: str = Field(min_length=1)
    secret_key: str = Field(min_length=32)
    # 版本号进健康端点与 OpenAPI，便于确认线上跑的是哪一版。
    app_version: str = "0.0.0"
    # 允许的前端来源，逗号分隔；仅开发期使用，生产由网关同源提供。
    cors_origins: str = ""

    @field_validator("secret_key")
    @classmethod
    def _reject_placeholder_secret(cls, value: str) -> str:
        if value.strip().lower() in PLACEHOLDER_SECRETS:
            raise ValueError("SECRET_KEY 不能使用占位符")
        return value

    @field_validator("database_url")
    @classmethod
    def _require_postgres(cls, value: str) -> str:
        if not value.startswith(("postgresql://", "postgresql+psycopg://")):
            raise ValueError("DATABASE_URL 必须是 PostgreSQL 连接串")
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "prod"

    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    def safe_summary(self) -> dict[str, object]:
        """可安全写入日志 / 交付单的配置摘要。任何密钥都只以是否设置的形式出现。"""
        return {
            "app_env": self.app_env,
            "app_version": self.app_version,
            "database_url_set": bool(self.database_url),
            "secret_key_set": bool(self.secret_key),
            "cors_origins": self.cors_origin_list(),
        }

    def assert_production_safe(self) -> None:
        """生产环境启动前的最后一道闸：只拦截确定危险的情况，不做猜测性检查。"""
        if not self.is_production:
            return
        if self.secret_key.strip().lower() in PLACEHOLDER_SECRETS:
            raise RuntimeError("生产环境禁止使用占位符 SECRET_KEY")
        if len(self.secret_key) < 32:
            raise RuntimeError("生产环境 SECRET_KEY 长度不足 32 字符")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """进程级单例。测试用 get_settings.cache_clear() 重建。"""
    return Settings()  # type: ignore[call-arg]  # 必填项来自环境变量
