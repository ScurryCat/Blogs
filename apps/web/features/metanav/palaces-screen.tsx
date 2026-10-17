"use client";

/**
 * 已发现殿堂：默认入口（04 §4A）+ 本机足迹（04 §9）。
 *
 *  - 默认落在**专题卡片列表**，不是三个空白输入框；所有公开专题都能直接进入，
 *    「已发现」只是叙事名称，不代表要先解谜；
 *  - 关键词引导与普通搜索是并列的次要入口，用普通中文说明它们能做什么；
 *  - 足迹只在本机、上限 30、可清除；**重访前先读一次公开状态**：专题已不再公开时
 *    把过期入口清掉并说明，而不是假装还能进（验收 3 / 6）；
 *  - 存储不可用不影响导航，只提示「这次访问不会被记住」。
 */

import { useCallback, useState, type ReactNode } from "react";

import { getPalace, listPalaces } from "./api";
import { isAbort } from "./failure";
import {
  FOOTPRINT_LIMIT,
  clearFootprint,
  recordVisit,
  removeVisit,
  type FootprintEntry,
} from "./footprint";
import { useFootprint } from "./footprint-react";
import type { MetanavHost } from "./host";
import { formatWhen, palacePath, useLoader } from "./host";
import styles from "./metanav.module.css";
import { PalaceCard } from "./palace-card";

function FootprintSection({ host }: { host: MetanavHost }): ReactNode {
  // 本机足迹是外部存储：用 useSyncExternalStore 订阅，写入 / 清除 / 其它标签页改动都会刷新。
  const entries = useFootprint(host.state);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const revisit = useCallback(
    async (entry: FootprintEntry) => {
      setBusy(true);
      setNotice(null);
      try {
        // 重访不是离线存档：先按当前公开状态读一次（04 §2）。
        const palace = await getPalace(entry.slug);
        const recorded = recordVisit(host.state, { slug: palace.slug, title: palace.title });
        if (!recorded.persisted) {
          // 存储不可用不影响导航，但要如实说明「这次不会被记住」。
          setNotice("浏览器存储不可用：可以继续进入殿堂，但这次访问不会被记住。");
        }
        if (host.mode === "phone") {
          // 手机里：殿堂阅读是应用内屏幕，不跳 canonical 页面（否则手机会被关闭）
          host.changeScreen("palace", palace.slug);
          return;
        }
        host.openContent({ destination: palacePath(palace.slug), source: "metaverse-entry" });
      } catch (error) {
        if (isAbort(error)) return;
        removeVisit(host.state, entry.slug);
        setNotice(`「${entry.title}」现在已经不可读了（可能已撤回或撤下），入口已从足迹里移除。`);
      } finally {
        setBusy(false);
      }
    },
    [host],
  );

  const clear = useCallback(() => {
    clearFootprint(host.state);
    setNotice("本机访问足迹已清除。");
  }, [host.state]);

  return (
    <section className={styles.footprint} aria-labelledby="metanav-footprint">
      <div className={styles.bar}>
        <div>
          <p className="kick">{"// Footprint"}</p>
          <h3 id="metanav-footprint" className={styles.cardTitle}>
            最近访问的殿堂
          </h3>
          <p className={styles.hint}>
            只保存在这台设备的浏览器里，上限 {FOOTPRINT_LIMIT} 条，随时可以清除；它不是「已读完」。
          </p>
        </div>
        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.buttonGhost}`}
            type="button"
            onClick={clear}
            disabled={!entries.length}
          >
            清除足迹
          </button>
        </div>
      </div>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {entries.length ? (
        <ul className={styles.footprintList}>
          {entries.map((entry) => (
            <li key={entry.slug}>
              <button
                className={styles.footprintItem}
                type="button"
                disabled={busy}
                onClick={() => {
                  void revisit(entry);
                }}
              >
                <span>{entry.title}</span>
                <span className={styles.footprintTime}>{formatWhen(entry.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>还没有访问记录。进入任意殿堂后会出现在这里。</p>
      )}
    </section>
  );
}

export function PalacesScreen({ host }: { host: MetanavHost }): ReactNode {
  const { state, reload } = useLoader((signal) => listPalaces(signal), []);

  return (
    <div className={styles.wrap}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Metaverse Navigator"}</p>
          <h2 className={styles.title}>已发现殿堂</h2>
          <p className={styles.lead}>
            这里是站主整理好的专题入口。不熟悉 Persona 也没关系：点卡片就能直接读文章，
            关键词与印象空间只是另外两条路。
          </p>
        </div>
        <nav className={styles.tabs} aria-label="导航方式">
          <button
            className={styles.tab}
            type="button"
            aria-current="true"
            onClick={() => host.changeScreen("palaces")}
          >
            已发现殿堂
          </button>
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("resolve")}>
            认知定位
          </button>
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("search")}>
            普通搜索
          </button>
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("mugen")}>
            印象空间
          </button>
        </nav>
      </header>

      {state.status === "loading" ? (
        <p className={styles.empty} role="status">
          正在读取殿堂列表…
        </p>
      ) : null}

      {state.status === "failed" ? (
        <div className={styles.empty} role="alert">
          <p>{state.failure.message}</p>
          <button className={styles.button} type="button" onClick={reload}>
            重新读取
          </button>
        </div>
      ) : null}

      {state.status === "ready" && state.data.items.length === 0 ? (
        <p className={styles.empty}>
          现在还没有已发布的殿堂。站主可以在管理页整理专题；你也可以先用普通搜索找文章。
        </p>
      ) : null}

      {state.status === "ready" && state.data.items.length ? (
        <div className={styles.grid}>
          {state.data.items.map((palace) => (
            <PalaceCard key={palace.slug} palace={palace} host={host} />
          ))}
        </div>
      ) : null}

      <FootprintSection host={host} />
    </div>
  );
}
