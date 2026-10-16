"""密码哈希（05 §5.2）。

约定：
  - 只使用 **Argon2id**；禁止明文、禁止 SHA/MD5 这类快速哈希。
  - 参数写死在这个模块里，便于统一评估与升级；`needs_rehash` 让登录时能顺手升级旧参数。
  - 未知用户也要走一次校验（`verify_password(password, DUMMY_HASH)`），
    否则「用户名是否存在」会从响应时间泄漏出去。

本模块不打印、不记录任何密码或哈希。
"""

from __future__ import annotations

import hmac
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type

# Argon2id, 32 MiB, t=2, p=2：单次约几十毫秒，足以让离线爆破昂贵而不拖慢登录。
_TIME_COST = 2
_MEMORY_COST_KIB = 32 * 1024
_PARALLELISM = 2
_HASH_LEN = 32
_SALT_LEN = 16

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 1024


@lru_cache(maxsize=1)
def _hasher() -> PasswordHasher:
    return PasswordHasher(
        time_cost=_TIME_COST,
        memory_cost=_MEMORY_COST_KIB,
        parallelism=_PARALLELISM,
        hash_len=_HASH_LEN,
        salt_len=_SALT_LEN,
        type=Type.ID,
    )


@lru_cache(maxsize=1)
def dummy_hash() -> str:
    """固定的一次性哈希，用于「用户不存在」时也消耗同样的校验时间。

    延迟创建：导入本模块不应付出哈希成本。
    """
    return _hasher().hash("phantom-log-unknown-user-placeholder")


def hash_password(password: str) -> str:
    return _hasher().hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    """校验密码。任何异常（包括哈希串损坏）都返回 False，不向调用方区分原因。"""
    try:
        _hasher().verify(stored_hash, password)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    except Exception:  # pragma: no cover - 防御性兜底，绝不因校验异常放行
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher().check_needs_rehash(stored_hash)
    except (InvalidHashError, VerificationError):
        return True


def password_policy_error(password: str, *, username: str = "") -> str | None:
    """返回不满足策略的原因；满足则返回 None。策略由部署期 CLI 与测试共用。"""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"密码至少 {MIN_PASSWORD_LENGTH} 个字符"
    if len(password) > MAX_PASSWORD_LENGTH:
        return f"密码最长 {MAX_PASSWORD_LENGTH} 个字符"
    if username and hmac.compare_digest(password.strip().lower(), username.strip().lower()):
        return "密码不能与用户名相同"
    return None
