/**
 * 宿主提供的版本化本机状态（02 §4 / §7）。
 *
 * 每个应用按自己的 `state_version` 分区存储，键形如
 * `pl-app:<appId>:v<state_version>:<key>`。版本升级时旧键自然读不到，
 * 应用自己决定怎么迁移；存储不可用时退化为内存，并如实返回 `persisted: false`。
 */

import type { PhoneStateService } from "./types";
import { LocalStateService } from "@/features/runtime/storage";

export interface PhoneStateOptions {
  /** 取应用的状态结构版本；未注册的应用用 1。 */
  versionOf: (appId: string) => number;
  /** 测试可注入；默认使用带探测的 localStorage。 */
  service?: LocalStateService;
}

export function createPhoneStateService(options: PhoneStateOptions): PhoneStateService & {
  available: boolean;
} {
  const service = options.service ?? new LocalStateService(1);
  // LocalStateService 的版本在构造时固定；手机侧要按应用切换版本，
  // 因此这里用一个版本映射表代理出多份实例（同一个底层存储）。
  const scoped = new Map<number, LocalStateService>();

  const forVersion = (version: number): LocalStateService => {
    const found = scoped.get(version);
    if (found) return found;
    const created = new LocalStateService(version);
    scoped.set(version, created);
    return created;
  };

  return {
    get available() {
      return service.available;
    },
    get<T>(appId: string, key: string, fallback: T): T {
      return forVersion(options.versionOf(appId)).get<T>(appId, key, fallback);
    },
    set<T>(appId: string, key: string, value: T) {
      return forVersion(options.versionOf(appId)).set(appId, key, value);
    },
    clear(appId: string): void {
      forVersion(options.versionOf(appId)).clear(appId);
    },
  };
}
