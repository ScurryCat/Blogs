"use client";

/**
 * 前台应用视图（02 §5 / §7）。
 *
 * 规则：
 *  - **同时只挂载一份前台应用视图**：宿主只渲染当前 URL 指向的那一个应用；
 *  - `loader` 是构建期懒加载入口，只在内置应用被打开时才 `import()`；
 *  - 应用自己的 `screens` 枚举决定 screen 是否合法：非法回退桌面，不执行任意路径；
 *  - 未加载 / 加载失败 / 应用崩溃都只影响这一块：手机桌面、关闭与音乐仍可操作；
 *  - 退出时调用模块的 `dispose()`，并用 `cancelled` 标记丢弃晚到的加载结果。
 */

import {
  Component,
  useEffect,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";

import type { PhoneAppManifest, PhoneAppModule, PhoneDisplayMode, PhoneViewProps } from "./types";
import { usePhone } from "./phone-provider";

interface BoundaryProps {
  appName: string;
  onHome: () => void;
  onClose: () => void;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

/** 应用崩溃只显示该应用的错误页（02 §3）。 */
class AppBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 保留在控制台，便于诊断；不把堆栈渲染给访客。
    console.error(`手机应用「${this.props.appName}」渲染失败`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pw-app-error" role="alert">
        <p className="pw-kick">APP ERROR</p>
        <h2>{this.props.appName} 打不开了</h2>
        <p>这个应用出了问题，手机桌面、关闭和音乐仍然可用。</p>
        <div className="pw-app-error-act">
          <button className="btn" type="button" onClick={this.props.onHome}>
            <span>回到桌面</span>
          </button>
          <button className="btn red" type="button" onClick={this.props.onClose}>
            <span>收起手机</span>
          </button>
        </div>
      </div>
    );
  }
}

export interface PhoneAppViewProps {
  manifest: PhoneAppManifest;
  screen: string | null;
  item: string | null;
  mode: PhoneDisplayMode;
}

export function PhoneAppView({ manifest, screen, item, mode }: PhoneAppViewProps): ReactNode {
  const { host, goHome, rejectScreen } = usePhone();
  const [module, setModule] = useState<PhoneAppModule | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (manifest.kind !== "embedded" || !manifest.loader) return;
    let cancelled = false;
    manifest
      .loader()
      .then(
        (loaded) => {
          if (!cancelled) setModule(loaded);
        },
        () => {
          if (!cancelled) setFailed(true);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [manifest]);

  // 退出时清理订阅 / 定时器 / 未完成请求。
  useEffect(() => () => module?.dispose?.(), [module]);

  const effectiveScreen = screen ?? module?.screens[0] ?? null;
  // 应用自己声明允许的屏幕：不在枚举里就**不渲染视图**，并让宿主退回桌面
  // （02 §6 第 6 条：不会执行任意路径，也不会先渲染非法内容再纠正）。
  const screenAllowed = Boolean(module && effectiveScreen && module.screens.includes(effectiveScreen));

  useEffect(() => {
    if (module && effectiveScreen && !screenAllowed) rejectScreen();
  }, [effectiveScreen, module, screenAllowed, rejectScreen]);

  if (manifest.kind === "site-link") {
    // 站点链接不该走内置视图；宿主会在点击时直接跳转，这里只做兜底。
    return null;
  }

  if (failed) {
    return (
      <div className="pw-app-error" role="alert">
        <p className="pw-kick">LOAD FAILED</p>
        <h2>{manifest.name} 没加载出来</h2>
        <p>可能是网络或构建产物缺失。回到桌面可以继续用其他应用。</p>
        <div className="pw-app-error-act">
          <button className="btn" type="button" onClick={goHome}>
            <span>回到桌面</span>
          </button>
        </div>
      </div>
    );
  }

  if (!module || !effectiveScreen) {
    return (
      <p className="pw-loading" role="status">
        正在打开 {manifest.name}…
      </p>
    );
  }

  if (!screenAllowed) {
    // 非法 screen：等待宿主把地址改回桌面，中间不渲染任何应用内容。
    return (
      <p className="pw-loading" role="status">
        这个屏幕不存在，正在回到桌面…
      </p>
    );
  }

  const View: ComponentType<PhoneViewProps> = module.default;
  return (
    <AppBoundary
      appName={manifest.name}
      onHome={goHome}
      onClose={() => host.close()}
    >
      <View screen={effectiveScreen} item={item} mode={mode} host={host} />
    </AppBoundary>
  );
}
