#!/usr/bin/env python3
"""验收行「发布一条图文并在另一浏览器读取」+「同图所有公开引用撤回」的端到端验证。

**这是集成负责人（T00）写的独立验证，不是 T03 的自测**：全程走真实 uvicorn + 真实
PostgreSQL + 真实 HTTP，用一个**带 cookie 的 opener 做管理写**、一个**无 cookie 的
opener 做匿名读** —— 后者是关键：用同一个 opener 会让「匿名」请求带上站主会话，
从而把「站主能读原图」误当成「匿名能读」。

验证内容：
  1. CSRF 流程：GET /auth/session 取 token → 登录（token 放 body）
  2. 上传真实图片（900×600，产生 original + w320 + w640）
  3. 建草稿 → 草稿匿名 404 → 发布（需 If-Match，否则 428）
  4. **匿名**读动态列表/详情；**派生变体匿名可读**（证明 media/public_refs 的 moments
     贡献已由 T00 登记，否则一律 404）；**原图匿名 404、站主 200**（原图永远仅管理用途）
  5. 撤回（If-Match）→ 详情 404 且**派生变体也不再公开**

用法（从 apps/api 目录）：`uv run python ../../../tools/acceptance/verify-ins-media-loop.py`
自建临时库与媒体目录，结束时 drop/删除。退出码 0 = 全部通过。

出处：T00 于 2026-10-16 集成 T03 后独立验证；T03 交付单 §5.2 有其自测的浏览器版本。
"""

import os, shutil, subprocess, sys, time, json, urllib.request, urllib.error, uuid
BASE = "postgresql+psycopg://pl@127.0.0.1:55432/"
DB, PSQL, PORT, API = "pl_verify_ins", "/opt/homebrew/opt/postgresql@18/bin/psql", 8124, "http://127.0.0.1:8124"
MEDIA = "/tmp/verify-ins-media"
os.environ.update(SECRET_KEY="verify-ins-placeholder-0123456789abcdef", APP_ENV="dev",
                  DATABASE_URL=BASE + DB, MEDIA_ROOT=MEDIA,
                  CORS_ORIGINS="http://127.0.0.1:3100")
ALLOWED_ORIGIN = "http://127.0.0.1:3100"   # 与 CORS_ORIGINS 一致：浏览器的真实 origin
shutil.rmtree(MEDIA, ignore_errors=True); os.makedirs(MEDIA)

def psql(sql, db="postgres"):
    return subprocess.run([PSQL,"-h","127.0.0.1","-p","55432","-U","pl","-d",db,"-tAc",sql], capture_output=True, text=True)
def sh(c, **kw): return subprocess.run(c, shell=True, capture_output=True, text=True, env=dict(os.environ), **kw)

psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)'); psql(f'CREATE DATABASE {DB}')
API_DIR = "/Users/学习/blog/Blogs/apps/api"
sh(f"cd {API_DIR} && uv run alembic upgrade head")
sh(f"cd {API_DIR} && uv run python -m app.commands.bootstrap_admin --username owner --password-stdin",
   input="verify-ins-password-123\n")

ok = True
def judge(label, cond, extra=""):
    global ok; ok = ok and cond
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {extra}" if extra else ""))

srv = subprocess.Popen(f"cd {API_DIR} && uv run uvicorn app.main:app --port {PORT} --log-level warning",
                       shell=True, env=dict(os.environ), stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, start_new_session=True)
import http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

anon = urllib.request.build_opener()   # **无 cookie**：真正匿名
def req(method, path, data=None, headers=None, raw=False, timeout=15, anonymous=False):
    op = anon if anonymous else opener
    r = urllib.request.Request(API + path, method=method, data=data, headers=headers or {})
    try:
        with op.open(r, timeout=timeout) as resp:
            body = resp.read()
            return resp.status, (body if raw else (json.loads(body) if body else {}))
    except urllib.error.HTTPError as e:
        body = e.read()
        try: return e.code, json.loads(body or b"{}")
        except Exception: return e.code, body
    except Exception as e:
        return None, type(e).__name__

for _ in range(60):
    if req("GET", "/api/v1/health/live")[0] == 200: break
    time.sleep(0.5)

print("== 1) 取 CSRF token（GET /auth/session 建立预登录会话）并登录 ==")
s, b = req("GET", "/api/v1/auth/session")
csrf = b.get("csrf_token") if isinstance(b, dict) else None
judge("会话端点返回 csrf_token", s == 200 and bool(csrf), f"{s} token={'有' if csrf else '无'}")

s, b = req("POST", "/api/v1/auth/login",
           json.dumps({"username": "owner", "password": "verify-ins-password-123", "csrf_token": csrf}).encode(),
           {"Content-Type": "application/json", "Origin": ALLOWED_ORIGIN})
judge("登录成功", s == 200, f"{s} {str(b)[:60]}")
csrf = (b.get("csrf_token") if isinstance(b, dict) else None) or csrf   # 登录后会话换新 token
WRITE = {"Origin": ALLOWED_ORIGIN, "X-CSRF-Token": csrf}

print("== 2) 上传媒体（真实图片）==")
from PIL import Image
import io as _io
_buf = _io.BytesIO()
Image.new("RGB", (900, 600), (30, 30, 40)).save(_buf, format="PNG")   # 够大 → 会产生 w320/w640
img = _buf.getvalue()
boundary = "----pl" + uuid.uuid4().hex
body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"crow.webp\"\r\n"
        f"Content-Type: image/png\r\n\r\n").encode() + img + f"\r\n--{boundary}--\r\n".encode()
s, b = req("POST", "/api/v1/admin/media", body,
           {"Content-Type": f"multipart/form-data; boundary={boundary}", **WRITE})
media_id = b.get("id") if isinstance(b, dict) else None
judge("上传成功且返回 media id", s == 201 and bool(media_id), f"{s} {str(b)[:70]}")
variants = b.get("variants") if isinstance(b, dict) else None

print("== 3) 创建草稿并发布 ==")
s, b = req("POST", "/api/v1/admin/moments",
           json.dumps({"text": "T00 集成验证：一条图文动态", "images": [{"media_id": media_id, "position": 0, "alt": "一只乌鸦"}],
                       "tags": ["验证"], "csrf_token": csrf}).encode(),
           {"Content-Type": "application/json", "Origin": ALLOWED_ORIGIN})
mid = b.get("id") if isinstance(b, dict) else None
version = b.get("version") if isinstance(b, dict) else None
judge("创建草稿 201", s == 201 and bool(mid), f"{s} status={b.get('status') if isinstance(b,dict) else b} version={version}")
judge("草稿不可匿名读", req("GET", f"/api/v1/moments/{mid}", anonymous=True)[0] == 404, "")
s, b = req("POST", f"/api/v1/admin/moments/{mid}/publish", None, {**WRITE, "If-Match": str(version)})
judge("发布成功", s == 200, f"{s}")

print("== 4) 匿名读：动态与**图片**（后者验证 T00 的 wiring 登记）==")
s, b = req("GET", "/api/v1/moments", anonymous=True)
ids = [i.get("id") for i in b.get("items", [])] if s == 200 else []
judge("公开列表含该动态", mid in ids, f"{s} items={len(ids)}")
judge("详情匿名可读 200", req("GET", f"/api/v1/moments/{mid}", anonymous=True)[0] == 200, "")
vlist = variants if isinstance(variants, list) else (list(variants.values()) if isinstance(variants, dict) else [])
judge("上传返回了变体", bool(vlist), f"{[v['name'] for v in vlist] if vlist else variants}")
derived = next((v for v in vlist if v["name"] != "original"), None)
orig = next((v for v in vlist if v["name"] == "original"), None)
judge("上传产生了派生变体（够大的图）", derived is not None, f"变体={[v['name'] for v in vlist]}")
if derived:
    s, raw = req("GET", derived["url"], raw=True, anonymous=True)
    judge(f"**派生变体匿名可读（wiring 生效）** {derived['name']}", s == 200 and isinstance(raw, bytes) and len(raw) > 0,
          f"{s} {len(raw) if isinstance(raw,bytes) else raw} 字节")
if orig:
    st_anon = req("GET", orig["url"], raw=True, anonymous=True)[0]
    st_owner = req("GET", orig["url"], raw=True)[0]
    judge("**原图匿名不可读（永远仅管理用途）**", st_anon == 404, f"匿名={st_anon}")
    judge("原图站主可读", st_owner == 200, f"站主={st_owner}")

print("== 5) 撤回：动态与图片都不再公开 ==")
s, pub = req("GET", f"/api/v1/admin/moments/{mid}")   # 取发布后的新版本
v2 = pub.get("version") if isinstance(pub, dict) else None
s, _ = req("POST", f"/api/v1/admin/moments/{mid}/unpublish", None, {**WRITE, "If-Match": str(v2)})
judge("撤回成功", s == 200, f"{s}")
judge("公开详情 404", req("GET", f"/api/v1/moments/{mid}", anonymous=True)[0] == 404, "")
if derived:
    s, _ = req("GET", derived["url"], raw=True, anonymous=True)
    judge("**撤回后派生变体匿名不可读（公开引用已撤）**", s == 404, str(s))

os.killpg(os.getpgid(srv.pid), 9); srv.wait()
psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)'); shutil.rmtree(MEDIA, ignore_errors=True)
print("\n  总判定:", "全部通过" if ok else "有失败")
sys.exit(0 if ok else 1)
