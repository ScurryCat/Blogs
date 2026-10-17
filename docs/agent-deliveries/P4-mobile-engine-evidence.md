# 移动引擎冒烟证据（WebKit / iPhone 视口）——非真机

> 验收报告 §5.3：「真实触控、软键盘、中文输入法与移动 Safari 未验证」。
> 本文件补 **Safari 同源引擎（WebKit）+ iPhone 尺寸/触控上下文** 的自动化证据，
> **不宣称已完成真机验证**。

## 1. 结论

- `tools/e2e-webkit-mobile-smoke.py`：在 **WebKit** 引擎、390×844 与 320×720、
  `is_mobile + has_touch` 下运行 **24/24 通过**：
  - 首页 WebKit 渲染、无横向溢出、「怪盗手记」无红底；
  - 手机可打开、桌面磁贴渲染、**原版图标 2 枚加载**、触控点按应用磁贴有响应；
  - IM 在手机内打开且 feed 渲染；
  - 图库页有内容、**触控打开灯箱**、Escape 关闭灯箱。
- 截图：`.dsh/screenshots/mobile-webkit/`（本地产物，不随包分发）。
- 结果 JSON：`.dsh/mobile-webkit-results.json`。

```bash
# WebKit 浏览器装在工作区（不改用户缓存目录）
PLAYWRIGHT_BROWSERS_PATH=.dsh/ms-playwright python3 -m playwright install webkit
PLAYWRIGHT_BROWSERS_PATH=.dsh/ms-playwright \
  python3 tools/e2e-webkit-mobile-smoke.py http://127.0.0.1:3100
```

## 2. 这能证明什么 / 不能证明什么

| 能证明 | 不能证明（仍需真机） |
| --- | --- |
| WebKit/Safari 引擎能正确渲染首页/手机/IM/图库 | 真实 iPhone 的硬件性能与内存表现 |
| iPhone 尺寸（390/320）下无横向溢出、布局可用 | **软键盘弹出/遮挡**与中文输入法组合输入 |
| 触控事件可打开应用、可打开/关闭灯箱 | 真实手指触控精度、滚动惯性、手势冲突 |
| 原版图标在移动引擎下真实加载（HTTP 200） | 真机 iOS Safari 的完整兼容性（含后台/旋转/省电） |

## 3. 仍未关闭

- **真实设备验证**：无 iPhone/Android 设备，本轮无法执行；
- 软键盘/中文输入法：自动化无法等价模拟，需真机手动用例；
- 移动 Safari 的其余场景（斜屏、触控滑动换页）仍按原口径标未完成。
