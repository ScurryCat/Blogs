# 旧站浏览器回归（T00 协调）

旧站的 `tests/poll-browser.html` 与 `tests/crowd-browser.html` 原本需要人工点开、点击按钮、肉眼看结果，
所以验收清单里的「浏览器证据」一直无法自动收集。这个目录把两页变成一条可复现命令。

## 运行

```bash
# 1) 起旧站预览（仓库既有约定端口）
python3 -m http.server 8000

# 2) 跑检查（另开一个终端，在仓库根目录）
python3 tools/browser-check/check.py
python3 tools/browser-check/check.py --page poll          # 只跑一页
python3 tools/browser-check/check.py --shots /tmp/shots   # 附带整页截图
```

退出码 0 表示全部通过；有 `FAIL ` / `检查中止` 行或一条 `PASS` 都没有时退出码为 1。

## 依赖

用**系统 Python** 的 Playwright，刻意不写进 `apps/api/pyproject.toml` 或 `apps/web/package.json`：
它是开发机工具，不是站点运行时依赖，也不该让 CI 去下载浏览器。

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
```

## 判定规则（诚实说明）

| 页面 | 完成判定 | 失败判定 |
| --- | --- | --- |
| `poll-browser.html` | 出现 `ALL BROWSER CHECKS PASSED` 或 `FAIL ` | 含 `FAIL ` |
| `crowd-browser.html` | 该页逐条累加结果且**没有终态文案**，只能等结果文本稳定（`settle_ms`），再用是否有 `PASS` 行判定 | 含 `FAIL ` 或 `检查中止` |

`crowd` 的「文本稳定」是启发式。若以后给该页补一个终态文案（例如 `ALL CROWD CHECKS PASSED`），
请把它加进 `PAGES` 的 `done_markers`，判定就变成确定性等待。

## 两个已知的坑

1. **`#boot` 开屏会拦截所有指针事件**，直接截图会拿到开屏画面而不是页面内容。
   关闭方式：`page.keyboard.press("Enter")`（`assets/js/boot.js` 支持 Enter / Space / Escape，也支持点击），
   然后等 `#boot` detached。
2. **问卷浮层是 JS 渲染的**，`wait_until="load"` 之后仍要等 `.poll-panel` / `section.poll--inline` 出现再截图。

## 边界

- 本工具**只读**旧站页面，不修改 `assets/`、`*.html` 或 `tests/*.cjs`。
- 新栈（`apps/web`）的浏览器验收属 T02 / T10，工具放 `apps/web/tests/`，不要与这里混用。
