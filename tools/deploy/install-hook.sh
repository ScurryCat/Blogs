#!/bin/sh
# 在服务器上执行一次：装一个 post-merge 钩子，之后每次 git pull 完自动更新
# version.json —— 这样「线上是哪个版本」用一条 curl 就能问清楚。
set -e
ROOT=$(git rev-parse --show-toplevel)
HOOK="$ROOT/.git/hooks/post-merge"
cat > "$HOOK" <<'EOF'
#!/bin/sh
# git pull / merge 之后刷新版本标记（失败不影响 pull 本身）
python3 "$(git rev-parse --show-toplevel)/tools/deploy/version.py" || true
EOF
chmod +x "$HOOK"
echo "已安装 $HOOK"
python3 "$ROOT/tools/deploy/version.py"
