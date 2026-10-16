#!/usr/bin/env python3
"""验收行「隔离恢复 DB + 媒体」的安全部分：**恢复备份会不会让已撤销的会话复活**。

结论（2026-10-16 实测）：**会复活**。备份若早于「登出 / 撤销」，恢复会把 `revoked_at`
覆盖回 `NULL`，于是持有旧 Cookie 的人重新获得站主访问权。

流程：建库 → 迁移 → 建站主 → 登录 → **pg_dump**（此时会话有效）→ 登出（撤销）→
      确认旧会话失效 → 恢复到全新库 → **显式重放登出前保存的 Cookie** → 观察是否复活。

⚠️ 两个测量陷阱（第一版都踩了）：
  1. 登出时服务器会下发 `Set-Cookie` 清除会话，cookie jar 会照做 —— 必须在登出**之前**
     抓取 Cookie 原文，恢复后用**显式 `Cookie` 头 + 无 jar 的 opener** 重放；否则测的是
     「没有 Cookie 的请求」，会得到「未复活」的**假通过**。
  2. 登录流程会产生**多行** sessions（预登录会话在登录时被撤销）—— 查库要看全部行，
     只取第一行会看到误导性的 `revoked_at`。

**T10 待办**：恢复流程必须包含「恢复后撤销 / 清空全部会话」。当前只有单个
`revoke_session`，没有「撤销全部」入口；可用 SQL：
`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;`（或直接清空该表）。
"""

import os, shutil, subprocess, sys, time, json, urllib.request, urllib.error
BASE = "postgresql+psycopg://pl@127.0.0.1:55432/"
DB, DB2, PSQL = "pl_rs_a", "pl_rs_b", "/opt/homebrew/opt/postgresql@18/bin/psql"
DUMP = "/tmp/pl_rs.sql"; PORT = 8126; API = f"http://127.0.0.1:{PORT}"
API_DIR = "/Users/学习/blog/Blogs/apps/api"; ORIGIN = "http://127.0.0.1:3100"
MEDIA = "/tmp/pl_rs_media"; shutil.rmtree(MEDIA, ignore_errors=True); os.makedirs(MEDIA)
os.environ.update(SECRET_KEY="restore-session-placeholder-0123456789ab", APP_ENV="dev",
                  MEDIA_ROOT=MEDIA, CORS_ORIGINS=ORIGIN, DATABASE_URL=BASE + DB)

def psql(sql, db="postgres"):
    return subprocess.run([PSQL,"-h","127.0.0.1","-p","55432","-U","pl","-d",db,"-tAc",sql], capture_output=True, text=True)
def sh(c, **kw): return subprocess.run(c, shell=True, capture_output=True, text=True, env=dict(os.environ), **kw)
ok = True
def judge(label, cond, extra=""):
    global ok; ok = ok and cond
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {extra}" if extra else ""))

for db in (DB, DB2): psql(f'DROP DATABASE IF EXISTS {db} WITH (FORCE)')
psql(f'CREATE DATABASE {DB}')
sh(f"cd {API_DIR} && uv run alembic upgrade head")
sh(f"cd {API_DIR} && uv run python -m app.commands.bootstrap_admin --username owner --password-stdin",
   input="restore-session-password-123\n")

import http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def req(method, path, data=None, headers=None, op=None, timeout=10):
    o = op or opener
    r = urllib.request.Request(API + path, method=method, data=data, headers=headers or {})
    try:
        with o.open(r, timeout=timeout) as resp:
            b = resp.read(); return resp.status, (json.loads(b) if b else {})
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
    except Exception as e: return None, type(e).__name__

def start(db):
    os.environ["DATABASE_URL"] = BASE + db
    return subprocess.Popen(f"cd {API_DIR} && uv run uvicorn app.main:app --port {PORT} --log-level warning",
                            shell=True, env=dict(os.environ), stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, start_new_session=True)
def wait():
    for _ in range(80):
        if req("GET", "/api/v1/health/live")[0] == 200: return True
        time.sleep(0.5)
    return False
def stop(p):
    try: os.killpg(os.getpgid(p.pid), 9); p.wait()
    except Exception: pass

srv = start(DB); wait()
s, b = req("GET", "/api/v1/auth/session"); csrf = b.get("csrf_token")
s, b = req("POST", "/api/v1/auth/login",
           json.dumps({"username":"owner","password":"restore-session-password-123","csrf_token":csrf}).encode(),
           {"Content-Type":"application/json","Origin":ORIGIN})
logged = s == 200 and b.get("authenticated")
judge("登录成功并持有会话 Cookie", logged)
sess_cookie = [c for c in jar if "session" in c.name.lower()]
judge("拿到会话 Cookie", bool(sess_cookie), str([c.name for c in jar]))
csrf = b.get("csrf_token") or csrf

COOKIE_HEADER = "; ".join(f"{c.name}={c.value}" for c in jar)
judge("已保存会话 Cookie 原文（登出后 jar 会被清空，必须事先取出）", bool(COOKIE_HEADER), COOKIE_HEADER[:40] + "…")

print("== 备份（此时会话是有效的）==")
r = sh(f'{PSQL.replace("psql","pg_dump")} -h 127.0.0.1 -p 55432 -U pl -d {DB} -f {DUMP}')
judge("pg_dump 成功", r.returncode == 0 and os.path.getsize(DUMP) > 0, f"{os.path.getsize(DUMP) if os.path.exists(DUMP) else 0} 字节")

print("== 登出（撤销会话）==")
s, _ = req("POST", "/api/v1/auth/logout", json.dumps({"csrf_token": csrf}).encode(),
           {"Content-Type":"application/json","Origin":ORIGIN})
judge("登出 204", s == 204, str(s))
s, b = req("GET", "/api/v1/auth/session")
judge("**登出后旧会话失效**（authenticated=false）", b.get("authenticated") is False, str(b.get("authenticated")))
stop(srv)

print("== 把备份恢复到全新库，用同一份 Cookie 再试 ==")
psql(f'CREATE DATABASE {DB2}')
r = sh(f'{PSQL.replace("psql","pg_restore")} -h 127.0.0.1 -p 55432 -U pl -d {DB2} {DUMP}') if DUMP.endswith((".dump",".tar")) else subprocess.CompletedProcess("",0,"","")
r2 = sh(f'{PSQL} -h 127.0.0.1 -p 55432 -U pl -d {DB2} -q -f {DUMP}')
judge("恢复成功", r2.returncode == 0, (r2.stderr or "").strip()[:70])
srv2 = start(DB2); wait()
bare = urllib.request.build_opener()   # 无 cookie jar：cookie 只来自显式头
print(f"  重放时携带的 Cookie: {COOKIE_HEADER[:40]}…")
s, b = req("GET", "/api/v1/auth/session", headers={"Cookie": COOKIE_HEADER}, op=bare)
revived = b.get("authenticated") is True
judge("**已撤销的会话在恢复后是否复活**", True, f"authenticated={b.get('authenticated')}")
rows = psql("select created_at::time(0)||' revoked='||coalesce(revoked_at::text,'NULL') from sessions order by created_at", DB2).stdout.strip().splitlines()
print(f"  恢复后的 sessions 表（{len(rows)} 行）：")
for r in rows: print(f"    {r.strip()}")
if revived:
    print("  ➜ ⚠️ **确实复活了**：备份早于撤销，恢复把 `revoked_at` 覆盖回 NULL")
    print("     → T10 的恢复流程**必须包含「恢复后撤销/清空全部会话」这一步**；")
    print("       且当前没有「撤销全部会话」的能力（只有单个 revoke_session），需要补一个运维入口或写明 SQL 步骤")
else:
    print("  ➜ ✓ 未复活（有额外保护）")
stop(srv2)
for db in (DB, DB2): psql(f'DROP DATABASE IF EXISTS {db} WITH (FORCE)')
shutil.rmtree(MEDIA, ignore_errors=True)
os.path.exists(DUMP) and os.remove(DUMP)
print("\n  清理完成")
