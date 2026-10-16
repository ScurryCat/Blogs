#!/usr/bin/env python3
"""验收行「同图所有公开引用撤回」的多引用语义验证（T00 独立执行）。

**为什么单独写**：单个内容撤回图片不可读，只证明了「引用没了就 404」；真正的验收要求是
**多引用**下的语义 —— 同一张图被多处引用时，撤回其中一处**不应**让图失效，只有全部撤回
才不可读。这一条用两个动态引用同一 media 来验证。

验证内容：
  1. 上传**一次**，得到 media 与派生变体（original + w320 + w640）
  2. **两个动态复用同一 media**（不同上下文，未重复保存图像）
  3. 两处引用都在 → 派生变体匿名 200；**原图匿名始终 404**（永远仅管理用途）
  4. **只撤回一处** → 该动态公开详情 404，但派生变体**仍公开可读**（另一处还在引用）
  5. **全部撤回** → 派生变体匿名 **404**

用法（从 apps/api 目录）：`uv run python ../../tools/acceptance/verify-media-multiref.py`
自建临时库与媒体目录，结束时 drop/删除。退出码 0 = 全部通过。
"""

import os, shutil, subprocess, sys, time, json, urllib.request, urllib.error, uuid, io
BASE = "postgresql+psycopg://pl@127.0.0.1:55432/"
DB, PSQL, PORT, API = "pl_verify_multiref", "/opt/homebrew/opt/postgresql@18/bin/psql", 8125, "http://127.0.0.1:8125"
SRV_LOG = f"/tmp/pl-acceptance-{PORT}.log"   # 服务输出写文件：启动失败时可直接看它
MEDIA = "/tmp/verify-multiref-media"
API_DIR = "/Users/学习/blog/Blogs/apps/api"
ORIGIN = "http://127.0.0.1:3100"
os.environ.update(SECRET_KEY="verify-multiref-placeholder-0123456789", APP_ENV="dev",
                  DATABASE_URL=BASE + DB, MEDIA_ROOT=MEDIA, CORS_ORIGINS=ORIGIN)
shutil.rmtree(MEDIA, ignore_errors=True); os.makedirs(MEDIA)

def psql(sql, db="postgres"):
    return subprocess.run([PSQL,"-h","127.0.0.1","-p","55432","-U","pl","-d",db,"-tAc",sql], capture_output=True, text=True)
def sh(c, **kw): return subprocess.run(c, shell=True, capture_output=True, text=True, env=dict(os.environ), **kw)

psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)'); psql(f'CREATE DATABASE {DB}')
sh(f"cd {API_DIR} && uv run alembic upgrade head")
sh(f"cd {API_DIR} && uv run python -m app.commands.bootstrap_admin --username owner --password-stdin",
   input="verify-multiref-password-123\n")

ok = True
def judge(label, cond, extra=""):
    global ok; ok = ok and cond
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {extra}" if extra else ""))

srv = subprocess.Popen(f"cd {API_DIR} && uv run uvicorn app.main:app --port {PORT} --log-level warning",
                       shell=True, env=dict(os.environ), stdout=open(SRV_LOG, "w"), stderr=subprocess.STDOUT, start_new_session=True)

import http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
anon = urllib.request.build_opener()

def req(method, path, data=None, headers=None, raw=False, anonymous=False, timeout=15):
    op = anon if anonymous else opener
    r = urllib.request.Request(API + path, method=method, data=data, headers=headers or {})
    try:
        with op.open(r, timeout=timeout) as resp:
            b = resp.read(); return resp.status, (b if raw else (json.loads(b) if b else {}))
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b or b"{}")
        except Exception: return e.code, b
    except Exception as e:
        return None, type(e).__name__

for _ in range(120):   # 最多等 60s：现在要导入 9 个内容域，冷启动比早期慢
    if req("GET", "/api/v1/health/live")[0] == 200: break
    time.sleep(0.5)

s, b = req("GET", "/api/v1/auth/session"); csrf = b.get("csrf_token")
s, b = req("POST", "/api/v1/auth/login",
           json.dumps({"username":"owner","password":"verify-multiref-password-123","csrf_token":csrf}).encode(),
           {"Content-Type":"application/json","Origin":ORIGIN})
csrf = b.get("csrf_token") or csrf
W = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
judge("登录", s == 200)

from PIL import Image
buf = io.BytesIO(); Image.new("RGB",(800,500),(20,40,60)).save(buf, format="PNG")
img = buf.getvalue()
boundary = "----pl" + uuid.uuid4().hex
body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"m.png\"\r\n"
        f"Content-Type: image/png\r\n\r\n").encode() + img + f"\r\n--{boundary}--\r\n".encode()
s, up = req("POST", "/api/v1/admin/media", body, {"Content-Type": f"multipart/form-data; boundary={boundary}", **W})
media_id = up.get("id"); derived = next((v for v in up.get("variants", []) if v["name"] != "original"), None)
orig = next((v for v in up.get("variants", []) if v["name"] == "original"), None)
judge("上传一次，拿到 media 与派生变体", s == 201 and bool(media_id) and derived is not None,
      f"{s} {[v['name'] for v in up.get('variants',[])]}")

def make_moment(text):
    payload = {"text": text, "images": [{"media_id": media_id, "position": 0, "alt": "共享的图"}],
               "tags": [], "csrf_token": csrf}
    s, b = req("POST", "/api/v1/admin/moments", json.dumps(payload).encode(),
               {"Content-Type":"application/json","Origin":ORIGIN})
    mid, ver = b.get("id"), b.get("version")
    s2, _ = req("POST", f"/api/v1/admin/moments/{mid}/publish", None, {**W, "If-Match": str(ver)})
    return mid, s == 201 and s2 == 200

a, okA = make_moment("引用同一张图的动态 A")
c, okC = make_moment("引用同一张图的动态 B")
judge("两个动态都创建并发布（**复用同一 media，未重复上传**）", okA and okC)

print("== 两处引用都在时：派生变体公开可读 ==")
judge("派生变体匿名 200", req("GET", derived["url"], raw=True, anonymous=True)[0] == 200)
judge("原图匿名仍 404（永远仅管理用途）", req("GET", orig["url"], raw=True, anonymous=True)[0] == 404)

print("== 只撤回一处引用 ==")
s, pub = req("GET", f"/api/v1/admin/moments/{a}"); v = pub.get("version")
req("POST", f"/api/v1/admin/moments/{a}/unpublish", None, {**W, "If-Match": str(v)})
judge("动态 A 公开详情 404", req("GET", f"/api/v1/moments/{a}", anonymous=True)[0] == 404)
judge("**派生变体仍公开可读（B 还在引用）**", req("GET", derived["url"], raw=True, anonymous=True)[0] == 200)

print("== 全部撤回 ==")
s, pub = req("GET", f"/api/v1/admin/moments/{c}"); v = pub.get("version")
req("POST", f"/api/v1/admin/moments/{c}/unpublish", None, {**W, "If-Match": str(v)})
judge("**派生变体现在匿名 404（所有公开引用已撤）**", req("GET", derived["url"], raw=True, anonymous=True)[0] == 404)

os.killpg(os.getpgid(srv.pid), 9); srv.wait()
psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)'); shutil.rmtree(MEDIA, ignore_errors=True)
print("\n  总判定:", "全部通过" if ok else "有失败")
sys.exit(0 if ok else 1)
