"""环境配置。

契约（T00 执行清单）：共同配置由 T00 定义；**共享配置与构建不含密钥**。
这里没有任何密钥默认值：DATABASE_URL 与 SECRET_KEY 都是必填项，缺失即启动失败，
以免「本地能跑」的默认值被顺手带进生产。

环境变量（无前缀，均为必填或显式默认）：
  APP_ENV           dev | test | prod，默认 dev
  DATABASE_URL      PostgreSQL 连接串，必填
  SECRET_KEY        签名密钥，必填，至少 32 字符
  APP_VERSION       版本号，进健康端点，默认 0.0.0
  CORS_ORIGINS      逗号分隔的可信来源，仅开发期使用
  TEST_DATABASE_URL 仅测试使用，由 apps/api/tests/conftest.py 读取并校验
  MEDIA_ROOT        媒体文件根目录（05 §8：媒体在受控持久卷；默认 apps/api/var/media）
  MEDIA_MAX_CONCURRENCY 并发图片处理上限（05 §8 建议首版 2）
  TRUST_PROXY_HEADERS 是否信任网关传来的 X-Forwarded-For（默认否，见 06 §2）

T01 增加的字段全部**带默认值**：缺省不会让已有部署或测试启动失败。
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

    # --- 媒体（05 §8 / T01）-------------------------------------------------
    # 媒体根目录由部署注入（容器里是持久卷挂载点）；默认值仅供本机开发。
    media_root: str = str(API_DIR / "var" / "media")
    # 单文件 8 MiB；解码像素上限 40MP、单边不超过 8192px。
    media_max_bytes: int = Field(default=8 * 1024 * 1024, gt=0)
    media_max_pixels: int = Field(default=40_000_000, gt=0)
    media_max_side: int = Field(default=8192, gt=0)
    # 有界并发：不在事件循环里长时间做 CPU 阻塞的解码 / 压缩（05 §8）。
    media_max_concurrency: int = Field(default=2, gt=0, le=16)

    # --- 会话（05 §5）-------------------------------------------------------
    # 建议会话最长 8 小时、空闲 30 分钟失效；预登录会话 10 分钟。
    session_absolute_ttl_seconds: int = Field(default=8 * 60 * 60, gt=0)
    session_idle_ttl_seconds: int = Field(default=30 * 60, gt=0)
    prelogin_ttl_seconds: int = Field(default=10 * 60, gt=0)
    # 登录限流：每 IP 每分钟 5 次（05 §9 的起始建议值）。
    login_rate_limit_per_minute: int = Field(default=5, gt=0)
    # 只信任网关传来的代理头；直连部署时保持 False（06 §2）。
    trust_proxy_headers: bool = False

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

    @property
    def media_root_path(self) -> Path:
        """媒体根目录。只在这里做一次展开，其余代码都从这里取。"""
        return Path(self.media_root).expanduser()

    def safe_summary(self) -> dict[str, object]:
        """可安全写入日志 / 交付单的配置摘要。任何密钥都只以是否设置的形式出现。"""
        return {
            "app_env": self.app_env,
            "app_version": self.app_version,
            "database_url_set": bool(self.database_url),
            "secret_key_set": bool(self.secret_key),
            "cors_origins": self.cors_origin_list(),
            "media_root_set": bool(self.media_root),
            "media_max_bytes": self.media_max_bytes,
            "media_max_concurrency": self.media_max_concurrency,
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
