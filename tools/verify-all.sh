#!/usr/bin/env bash
# 一键跑全部验收（任务书 §8.5「所有验证命令可直接运行」）。
#
# 分 6 段，每段独立判定，最后汇总。任一失败 → 退出码 1。
#
# 用法：
#   tools/verify-all.sh                 # 全跑（约 5-6 分钟）
#   tools/verify-all.sh --fast          # 只跑快的：静态审计 + typecheck/lint/单测（约 40 秒）
#   tools/verify-all.sh --no-browser    # 跳过需要浏览器与隔离构建的段
#   tools/verify-all.sh --no-backend    # 跳过后端整树
#   tools/verify-all.sh --e2e           # 额外跑真实浏览器端到端（需起隔离全栈，约 3 分钟）
#   tools/verify-all.sh --e2e --mobile  # 端到端再跑一遍手机全屏视口（390×844）
#
# 前置条件：
#   - 段 3 用独立 Postgres 集群，自动起停，不碰共享集群；
#   - 段 5 的 4 个业务脚本连**共享测试集群**（55432），需先 `tools/pg-local.sh start`；
#   - 段 4/6 需要 `apps/web/node_modules` 已安装。
set -uo pipefail

# 本机若开了系统代理（例如 Clash 的 127.0.0.1:7890），Python 3.13 的 urllib 在 macOS 上
# **不会采用系统代理的 ExceptionsList**：验收脚本直连 127.0.0.1 也会被送进代理，
# 表现为 502 / 超时（2026-10-17 实测：curl 200、python urllib 502）。
# 统一绕过本机地址，保证 acceptance / T02 / e2e 的本地 HTTP 直连。
export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
export NO_PROXY="$no_proxy"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1

export LC_ALL=C
export UV_CACHE_DIR="${UV_CACHE_DIR:-$REPO/.dsh/uv-cache}"
export npm_config_cache="${npm_config_cache:-$REPO/.dsh/npm-cache}"
PG_BIN="/opt/homebrew/opt/postgresql@18/bin"

FAST=0
DO_BACKEND=1
DO_BROWSER=1
DO_E2E=0
DO_MOBILE=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1; DO_BACKEND=0; DO_BROWSER=0 ;;
    --no-backend) DO_BACKEND=0 ;;
    --no-browser) DO_BROWSER=0 ;;
    --e2e) DO_E2E=1 ;;
    --mobile) DO_MOBILE=1 ;;
    --help|-h) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg（用 --help 看用法）"; exit 2 ;;
  esac
done

declare -a NAMES=() RESULTS=() DETAILS=()
FAILED=0

record() { # $1=名称 $2=0/1/skip $3=补充
  NAMES+=("$1")
  case "$2" in
    0) RESULTS+=("PASS") ;;
    skip) RESULTS+=("SKIP") ;;
    *) RESULTS+=("FAIL"); FAILED=1 ;;
  esac
  DETAILS+=("${3:-}")
}

run_section() { # $1=标题
  echo
  echo "────────────────────────────────────────────────────────"
  echo "▶ $1"
  echo "────────────────────────────────────────────────────────"
}

# ── 1. 静态审计（快，不需要服务）────────────────────────────
run_section "1/6 静态审计（引用完整性 / 素材许可）"
static_ok=0
python3 tools/acceptance/verify-phone-icons.py >/tmp/vf-icons.log 2>&1 || static_ok=1
python3 tools/acceptance/verify-asset-refs.py >/tmp/vf-assets.log 2>&1 || static_ok=1
python3 tools/acceptance/verify-no-akechi-assets.py >/tmp/vf-akechi.log 2>&1 || static_ok=1
echo "  图标/路由：$(tail -1 /tmp/vf-icons.log)"
echo "  资源引用：$(tail -1 /tmp/vf-assets.log)"
echo "  明智资源：$(tail -1 /tmp/vf-akechi.log)"
record "静态审计（图标/路由/资源/明智资源）" "$static_ok" "见 /tmp/vf-*.log"

if [ "$FAST" -eq 1 ]; then
  echo
  echo "（--fast：跳过前端全量之外的慢段）"
fi

# ── 2. 前端：typecheck / lint / 单测 ────────────────────────
run_section "2/6 前端 typecheck / lint / 单测"
cd "$REPO/apps/web" || exit 1
fe_ok=0
npm run typecheck >/tmp/vf-typecheck.log 2>&1 || fe_ok=1
npm run lint >/tmp/vf-lint.log 2>&1 || fe_ok=1
npm run test -- --run >/tmp/vf-test.log 2>&1 || fe_ok=1
echo "  typecheck：$( [ -f /tmp/vf-typecheck.log ] && grep -q "error TS" /tmp/vf-typecheck.log && echo "有 TS 错误" || echo "✓ 无错误" )"
echo "  lint：$(grep -cE ' error ' /tmp/vf-lint.log | xargs -I{} echo '{} 个 error')"
echo "  单测：$(grep -E '^ *Tests ' /tmp/vf-test.log | tail -1)"
record "前端 typecheck / lint / 单测" "$fe_ok" "$(grep -E '^ *Tests ' /tmp/vf-test.log | tail -1)"
cd "$REPO" || exit 1

# ── 3. 后端整树（独立集群）──────────────────────────────────
if [ "$DO_BACKEND" -eq 1 ]; then
  run_section "3/6 后端整树（独立 Postgres 集群，自动清理）"
  if tools/verify-backend-isolated.sh 55433 >/tmp/vf-backend.log 2>&1; then
    be=0; be_line="$(grep -E '进度点' /tmp/vf-backend.log | tail -1)"
  else
    be=1; be_line="有失败，见 /tmp/vf-backend.log"
  fi
  echo "  $be_line"
  record "后端整树" "$be" "$be_line"
else
  record "后端整树" skip "（本轮跳过）"
  echo
  echo "3/6 后端整树：已跳过"
fi

# ── 4/6 浏览器：隔离构建 + T02 + 取数审计 ───────────────────
if [ "$DO_BROWSER" -eq 1 ]; then
  run_section "4/6 浏览器套件 T02 + 取数审计（隔离构建，不抢共享 .next）"
  if tools/verify-isolated.sh 3120 >/tmp/vf-browser.log 2>&1; then
    br=0
    br_line="$(grep -oE '"passed": [0-9]+' /tmp/vf-browser.log | head -1) / $(grep -cE '^PASS ' /tmp/vf-browser.log | xargs -I{} echo '{} PASS 行')"
  else
    br=1; br_line="有失败，见 /tmp/vf-browser.log"
  fi
  echo "  T02：$br_line"
  record "浏览器 T02 + 取数审计" "$br" "$br_line"

  # ── 5/6 响应式（复用 4/6 起的隔离站 3120）─────────────────
  run_section "5/6 多视口 × 缩放档（对隔离站 3120）"
  if python3 tools/acceptance/verify-viewports.py http://127.0.0.1:3120 >/tmp/vf-viewports.log 2>&1; then
    # 只数真正的视口结果行（`1440x900  100% …` / `320  …`），别把「（无 ✓）」也算进去
    vp=0; vp_line="$(grep -cE '^  ([0-9]+x[0-9]+|320|390) ' /tmp/vf-viewports.log | xargs -I{} echo '{} 项')"
  else
    vp=1; vp_line="有失败，见 /tmp/vf-viewports.log"
  fi
  echo "  $vp_line"
  record "多视口 × 缩放档" "$vp" "$vp_line"
else
  record "浏览器 T02 + 取数审计" skip "（本轮跳过）"
  record "多视口 × 缩放档" skip "（本轮跳过）"
  echo
  echo "4/6、5/6：已跳过"
fi

# ── 6/6 业务流验收脚本（需共享测试集群）────────────────────
if [ "$DO_BROWSER" -eq 1 ]; then
  run_section "6/6 业务流验收脚本（媒体闭环 / 多引用 / 相册撤回 / 恢复撤销会话）"
  if ! "$PG_BIN/pg_isready" -h 127.0.0.1 -p 55432 >/dev/null 2>&1; then
    echo "  ⚠ 共享测试集群（55432）未启动 —— 先跑 tools/pg-local.sh start"
    record "业务流验收脚本" 1 "共享集群未启动"
  else
    biz_ok=0
    cd "$REPO/apps/api" || exit 1
    for t in verify-ins-media-loop verify-media-multiref verify-album-moment-retract verify-restore-revokes-sessions; do
      if uv run python "../../tools/acceptance/$t.py" >"/tmp/vf-$t.log" 2>&1; then
        printf "  %-34s PASS\n" "$t"
      else
        printf "  %-34s FAIL（见 /tmp/vf-%s.log）\n" "$t" "$t"
        biz_ok=1
      fi
    done
    cd "$REPO" || exit 1
    record "业务流验收脚本 ×4" "$biz_ok" ""
  fi
else
  record "业务流验收脚本 ×4" skip "（本轮跳过）"
  echo
  echo "6/6：已跳过"
fi

# ── 7 (--e2e) 真实浏览器端到端 ──────────────────────────────
if [ "${DO_E2E:-0}" -eq 1 ]; then
  run_section "7/7 真实浏览器端到端（隔离全栈：独立集群 + 隔离 API + 隔离前端 + 种子）"
  if tools/e2e-stack.sh up >/tmp/vf-e2e-stack.log 2>&1; then
    e2e_ok=0
    check_e2e() { # $1=脚本 $2=名称
      if python3 "$REPO/tools/$1" http://127.0.0.1:3130 >"/tmp/vf-$1.log" 2>&1; then
        printf "  %-28s PASS\n" "$2"
      else
        printf "  %-28s FAIL（见 /tmp/vf-%s.log）\n" "$2" "$1"
        e2e_ok=1
      fi
    }
    check_e2e e2e-phone-scroll.py "手机滚动位置恢复"
    check_e2e e2e-im-draft.py "IM 草稿持久化"
    check_e2e e2e-journal-reading.py "手记正文留在手机内（§3.3 P3）"
    check_e2e e2e-metanav-palace.py "殿堂正文留在手机内（§3.3 P4）"
    check_e2e e2e-ins-tag.py "INS 标签筛选留在手机内（§3.3 P1）"
    check_e2e e2e-ins-conversation.py "INS 会话留在手机内（§3.3 P2）"
    if [ "${DO_MOBILE:-0}" -eq 1 ]; then
      echo "  —— 手机全屏视口（390×844）——"
      export E2E_VIEWPORT=390x844
      check_e2e e2e-phone-scroll.py "手机滚动位置恢复（移动）"
      check_e2e e2e-im-draft.py "IM 草稿持久化（移动）"
      check_e2e e2e-journal-reading.py "手记正文留在手机内（移动）"
      check_e2e e2e-metanav-palace.py "殿堂正文留在手机内（移动）"
      check_e2e e2e-ins-tag.py "INS 标签筛选留在手机内（移动）"
      check_e2e e2e-ins-conversation.py "INS 会话留在手机内（移动）"
      unset E2E_VIEWPORT
    fi
    tools/e2e-stack.sh down >/dev/null 2>&1
        if [ "${DO_MOBILE:-0}" -eq 1 ]; then
      record "真实浏览器端到端 ×12（桌面 6 + 移动 6）" "$e2e_ok" "隔离全栈（up→测→down）"
    else
      record "真实浏览器端到端 ×6" "$e2e_ok" "隔离全栈（up→测→down）"
    fi
  else
    echo "  ⚠ 隔离全栈没起来，见 /tmp/vf-e2e-stack.log"
    tools/e2e-stack.sh down >/dev/null 2>&1
    record "真实浏览器端到端 ×6" 1 "隔离全栈起不来"
  fi
else
  record "真实浏览器端到端 ×6" skip "（未加 --e2e）"
  echo
  echo "7/7 端到端：已跳过（加 --e2e 启用）"
fi

# ── 汇总 ───────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════"
echo "  验收汇总"
echo "════════════════════════════════════════════════════════"
for i in "${!NAMES[@]}"; do
  printf "  %-34s %s  %s\n" "${NAMES[$i]}" "${RESULTS[$i]}" "${DETAILS[$i]}"
done
echo
skips=$(printf '%s\n' "${RESULTS[@]}" | grep -c '^SKIP$' || true)
if [ "$FAILED" -ne 0 ]; then
  echo "  有失败 ✗ —— 逐段日志见 /tmp/vf-*.log"
elif [ "$skips" -gt 0 ]; then
  echo "  已跑的段全部通过 ✓（跳过 $skips 段；代码状态：$(git rev-parse --short HEAD)）"
else
  echo "  全部通过 ✓（代码状态：$(git rev-parse --short HEAD)）"
fi
exit "$FAILED"
