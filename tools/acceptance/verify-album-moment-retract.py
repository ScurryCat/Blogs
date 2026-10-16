#!/usr/bin/env python3
"""验收矩阵第 6 行：**动态撤回，但照片仍在公开相册**。

预期：图文不可见，**仍公开的相册图片可见**；提示准确。

**为什么单独写**：这一行长期没有被验证过 —— T06 报告「仓库里没有任何真实照片素材」，
所以画廊线上内容为空，而它的 seed **拒绝用游戏素材或占位图冒充照片**（这是对的）。
但这一行验的是**语义**而不是素材：用一张测试图同时挂在相册与动态上就能验完整条链路。

流程：上传**一次** → 同一 media 既作为相册照片（并发布）又作为动态配图（并发布）→
      两处引用都在时派生变体匿名可读、照片墙与相册详情都含它 →
      **只撤回动态** → 动态详情 404，但派生变体**仍公开可读**、照片墙与相册详情**仍含它** →
      原图始终仅管理用途。

⚠️ 两个 API 细节（第一版都踩了，报 422 才发现）：
  - 相册的 `AlbumCreateIn` 是 `extra="forbid"` 且有必填 `slug`；
  - 它**不接受 body 里的 `csrf_token`**（与 moments 不同），CSRF 必须走 `X-CSRF-Token` 头。

用法（从 apps/api 目录）：`uv run python ../../tools/acceptance/verify-album-moment-retract.py`
自建临时库与媒体目录，结束时 drop/删除。退出码 0 = 全部通过。
"""

import os, shutil, subprocess, sys, time, json, urllib.request, urllib.error, uuid, io
BASE = "postgresql+psycopg://pl@127.0.0.1:55432/"
DB, PSQL = "pl_row6", "/opt/homebrew/opt/postgresql@18/bin/psql"
PORT, API = 8131, "http://127.0.0.1:8131"
MEDIA = "/tmp/pl_row6_media"; API_DIR = "/Users/学习/blog/Blogs/apps/api"; ORIGIN = "http://127.0.0.1:3100"
shutil.rmtree(MEDIA, ignore_errors=True); os.makedirs(MEDIA)
os.environ.update(SECRET_KEY="row6-placeholder-0123456789abcdef", APP_ENV="dev",
                  DATABASE_URL=BASE + DB, MEDIA_ROOT=MEDIA, CORS_ORIGINS=ORIGIN)

def psql(sql, db="postgres"):
    return subprocess.run([PSQL,"-h","127.0.0.1","-p","55432","-U","pl","-d",db,"-tAc",sql], capture_output=True, text=True)
def sh(c, **kw): return subprocess.run(c, shell=True, capture_output=True, text=True, env=dict(os.environ), **kw)
ok = True
def judge(label, cond, extra=""):
    global ok; ok = ok and cond
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {extra}" if extra else ""))

psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)'); psql(f'CREATE DATABASE {DB}')
sh(f"cd {API_DIR} && uv run alembic upgrade head")
sh(f"cd {API_DIR} && uv run python -m app.commands.bootstrap_admin --username owner --password-stdin",
   input="row6-password-123456\n")

srv = subprocess.Popen(f"cd {API_DIR} && uv run uvicorn app.main:app --port {PORT} --log-level warning",
                       shell=True, env=dict(os.environ), stdout=open(f"/tmp/pl-row6-{PORT}.log","w"),
                       stderr=subprocess.STDOUT, start_new_session=True)
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
    except Exception as e: return None, type(e).__name__

for _ in range(120):
    if req("GET", "/api/v1/health/live")[0] == 200: break
    time.sleep(0.5)

s, b = req("GET", "/api/v1/auth/session"); csrf = b.get("csrf_token")
s, b = req("POST", "/api/v1/auth/login",
           json.dumps({"username":"owner","password":"row6-password-123456","csrf_token":csrf}).encode(),
           {"Content-Type":"application/json","Origin":ORIGIN})
csrf = b.get("csrf_token") or csrf
W = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
judge("登录", s == 200)

from PIL import Image
buf = io.BytesIO(); Image.new("RGB",(900,600),(30,30,50)).save(buf, format="PNG")
boundary = "----r6" + uuid.uuid4().hex
body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"p.png\"\r\n"
        f"Content-Type: image/png\r\n\r\n").encode() + buf.getvalue() + f"\r\n--{boundary}--\r\n".encode()
s, up = req("POST", "/api/v1/admin/media", body, {"Content-Type": f"multipart/form-data; boundary={boundary}", **W})
media_id = up.get("id")
derived = next((v for v in up.get("variants", []) if v["name"] != "original"), None)
judge("上传一次", s == 201 and media_id and derived, f"{s}")

# 相册：同一 media 作为照片
s, alb = req("POST", "/api/v1/admin/albums",
             json.dumps({"slug":"row6-acceptance-album","title":"验收用相册","kind":"photo","position":0,
                         "photos":[{"media_id":media_id,"position":0,"alt":"验收用照片","taken_on":None}]}).encode(),
             {"Content-Type":"application/json","Origin":ORIGIN,"X-CSRF-Token":csrf})
album_id, aver = alb.get("id"), alb.get("version")
judge("建相册并挂同一张图", s == 201 and album_id, f"{s} {json.dumps(alb, ensure_ascii=False)[:300] if s != 201 else ''}")
s, _ = req("POST", f"/api/v1/admin/albums/{album_id}/publish", None, {**W, "If-Match": str(aver)})
judge("相册发布", s == 200, f"{s}")

# 动态：同一 media
s, mom = req("POST", "/api/v1/admin/moments",
             json.dumps({"text":"引用同一张图的动态","images":[{"media_id":media_id,"position":0,"alt":"同一张图"}],
                         "tags":[],"csrf_token":csrf}).encode(), {"Content-Type":"application/json","Origin":ORIGIN})
mid, mver = mom.get("id"), mom.get("version")
s2, _ = req("POST", f"/api/v1/admin/moments/{mid}/publish", None, {**W, "If-Match": str(mver)})
judge("动态发布（与相册复用同一 media）", s == 201 and s2 == 200)

print("== 两处引用都在 ==")
judge("派生变体匿名 200", req("GET", derived["url"], raw=True, anonymous=True)[0] == 200)
s, wall = req("GET", "/api/v1/gallery/photos", anonymous=True)
n_before = len(wall.get("items", []))
judge("公开照片墙含这张图", n_before >= 1, f"{n_before} 张")
s, det = req("GET", f"/api/v1/gallery/albums/{alb.get('slug')}", anonymous=True)
judge("公开相册详情含这张图", bool(det.get("photos")), f"{len(det.get('photos', []))} 张")

print("== 只撤回动态 ==")
s, cur = req("GET", f"/api/v1/admin/moments/{mid}"); v = cur.get("version")
s, _ = req("POST", f"/api/v1/admin/moments/{mid}/unpublish", None, {**W, "If-Match": str(v)})
judge("图文不可见（动态详情 404）", req("GET", f"/api/v1/moments/{mid}", anonymous=True)[0] == 404)
judge("**派生变体仍公开可读**（相册还在引用）", req("GET", derived["url"], raw=True, anonymous=True)[0] == 200)
s, wall = req("GET", "/api/v1/gallery/photos", anonymous=True)
judge("**仍公开的相册图片可见**（照片墙仍含它）", len(wall.get("items", [])) == n_before, f"{len(wall.get('items', []))} 张")
s, det = req("GET", f"/api/v1/gallery/albums/{alb.get('slug')}", anonymous=True)
judge("相册详情仍含它", bool(det.get("photos")))
judge("原图始终仅管理用途（匿名 404）", req("GET", up["variants"][0]["url"], raw=True, anonymous=True)[0] == 404)

os.killpg(os.getpgid(srv.pid), 9); srv.wait()
psql(f'DROP DATABASE IF EXISTS {DB} WITH (FORCE)'); shutil.rmtree(MEDIA, ignore_errors=True)
print("\n  总判定:", "全部通过" if ok else "有失败")
sys.exit(0 if ok else 1)
