"use client";

/**
 * 角色列表（INS「消息」页签的内容；08 §2）。
 *
 * 这里有两条刻意的边界：
 *  - **角色不显示虚构的实时在线状态**（08 §2）。没有「在线 / 3 分钟前」这类假信息；
 *    只显示真实存在的东西：会话状态、消息条数、最后一条的摘要。
 *  - **真实友链不混进这个列表**（08 §2）：友链在 COOP 应用里，是 T07 的范围。
 *
 * 每条会话摘要都**只属于当前访客**：服务端按访客会话过滤，前端不做也不该做这件事。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchCharacters } from "./api";
import { MESSAGES_APP_PATH, conversationAppPath } from "./paths";
import { previewOf, type Character } from "./types";
import { describeChatError } from "./use-conversation";

export interface CharacterListProps {
  /** 手机里点是短过渡，独立页是普通跳转。 */
  linkSource?: "phone-internal" | "phone-link";
  /** 手机宿主：点角色时用 navigateScreen，而不是整页跳转。 */
  onOpen?: (characterId: string) => void;
}

interface ListState {
  phase: "loading" | "ready" | "error";
  characters: readonly Character[];
  error: string | null;
}

export function CharacterList({ linkSource = "phone-link", onOpen }: CharacterListProps): ReactNode {
  const [state, setState] = useState<ListState>({ phase: "loading", characters: [], error: null });
  const [reloadToken, setReloadToken] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  /**
   * 读取角色目录。
   *
   * 结构上有两条硬要求（都是被 lint 与真实行为逼出来的）：
   *  1. 异步工作直接放在 effect 里的 IIFE 中，**所有 `setState` 都在 `await` 之后** ——
   *     `react-hooks/set-state-in-effect` 会把「effect 内（含它调用的 useCallback）
   *     同步 setState」判为级联渲染（T05 / T07 踩过这条）；
   *  2. 加载态由**初始 state** 表达；「重试」是用户操作，那时切回 loading 没有问题。
   */
  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;

    void (async () => {
      try {
        const characters = await fetchCharacters(controller.signal);
        if (controller.signal.aborted || !mountedRef.current) return;
        setState({ phase: "ready", characters, error: null });
      } catch (failure) {
        if (controller.signal.aborted || !mountedRef.current) return;
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setState({ phase: "error", characters: [], error: describeChatError(failure) });
      }
    })();

    return () => controller.abort();
  }, [reloadToken]);

  // 卸载即取消（验收 §1：模块退出不留挂起请求与监听）。
  useEffect(
    () => () => {
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    },
    [],
  );

  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, phase: "loading", error: null }));
    setReloadToken((value) => value + 1);
  }, []);

  if (state.phase === "loading") {
    return (
      <p className="msg-state" role="status">
        正在读取角色列表…
      </p>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="msg-state" role="status">
        <p className="msg-state-kicker">READ FAILED</p>
        <h2>读不到角色列表</h2>
        <p>{state.error}</p>
        <button type="button" className="msg-btn" onClick={reload}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="msg-role-list">
      <div className="msg-list-head">
        {/* IM 应用标识：与会话页一致，黑底白字 + 红色块。 */}
        <span className="msg-logo" aria-hidden="true">
          IM
        </span>
        <span className="msg-list-head-note">Character messages</span>
      </div>
      <p className="msg-role-intro">
        这里是游戏角色的非官方同人会话：预设剧情由本站写好，自由聊天由 AI 生成。
        名单里只有游戏角色；真实朋友的入口在 COOP 应用里，不混在这里。
      </p>
      <ul className="msg-roles">
        {state.characters.map((character) => {
          const summary = character.conversation;
          const preview =
            summary === null
              ? "还没有聊过。点开会有个开场。"
              : previewOf(summary.preview || "（还没有消息）");
          const meta =
            summary === null
              ? "新会话"
              : summary.status === "free"
                ? `剧情暂停中 · ${summary.message_count} 条`
                : summary.status === "finished"
                  ? `这段剧情已结束 · ${summary.message_count} 条`
                  : `${summary.message_count} 条消息`;
          const href = conversationAppPath(character.id);

          const body = (
            <>
              <span className="msg-role-avatar" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element -- 固定 52×52 的装饰性头像。 */}
                <img src={character.avatar} alt={character.avatar_alt} width={52} height={52} />
              </span>
              <span className="msg-role-text">
                <span className="msg-role-name">{character.name}</span>
                <span className="msg-role-tagline">{character.tagline}</span>
                <span className="msg-role-preview">{preview}</span>
                <span className="msg-role-meta">{meta}</span>
              </span>
              <span className="msg-role-chevron" aria-hidden="true">
                ›
              </span>
            </>
          );

          return (
            <li key={character.id}>
              {onOpen ? (
                <button
                  type="button"
                  className="msg-role"
                  onClick={() => onOpen(character.id)}
                  aria-label={`打开与${character.name}的会话`}
                >
                  {body}
                </button>
              ) : (
                <SiteLink
                  className="msg-role"
                  href={href}
                  source={linkSource}
                  aria-label={`打开与${character.name}的会话`}
                >
                  {body}
                </SiteLink>
              )}
            </li>
          );
        })}
      </ul>
      <p className="msg-role-footnote">
        会话保存在本站最多 24 小时，你可以随时清除。角色台词不是游戏原文。
        {" "}
        <SiteLink href={MESSAGES_APP_PATH} source={linkSource} className="msg-inline-link">
          消息页
        </SiteLink>
      </p>
    </div>
  );
}
