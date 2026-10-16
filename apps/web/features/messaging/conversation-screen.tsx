"use client";

/**
 * 会话屏幕：把状态机 hook 与视图接起来（独立页与手机视图共用同一个组件）。
 *
 * 为什么单独一个文件：`/apps/ins/messages/<character_id>` 与手机
 * `screen=conversation` 必须渲染**同一套界面与同一份数据**（03 §1）。
 * 两端各写一遍迟早会漂移，而且在手机上会出现「独立页有的提示手机没有」。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchStatus } from "./api";
import { ConversationView } from "./conversation-view";
import { MESSAGES_APP_PATH } from "./paths";
import { useConversation } from "./use-conversation";
import type { Limits } from "./types";

export interface ConversationScreenProps {
  characterId: string;
  linkSource?: "phone-internal" | "phone-link";
}

export function ConversationScreen({
  characterId,
  linkSource = "phone-link",
}: ConversationScreenProps): ReactNode {
  const controller = useConversation(characterId);
  const [limits, setLimits] = useState<Limits | null>(null);

  // 限额只用于输入长度与用量提示；读不到就用后端默认值（1000 码点），
  // 不因为没有 /status 就让整个会话打不开。
  useEffect(() => {
    const fetched = new AbortController();
    void (async () => {
      try {
        const status = await fetchStatus(fetched.signal);
        if (fetched.signal.aborted) return;
        setLimits(status.limits);
      } catch {
        // 忽略：这是展示用的元数据，不是会话本身。
      }
    })();
    return () => fetched.abort();
  }, []);

  const character = useMemo(() => {
    const list = controller.session?.characters ?? [];
    return list.find((item) => item.id === characterId) ?? null;
  }, [characterId, controller.session]);

  // 角色目录是服务端给的权威清单：不在清单里的 id 直接给「没有这个角色」，
  // 而不是拿一个泛泛的请求失败去糊弄（也算软 404 的可见提示）。
  if (controller.session !== null && character === null) {
    return (
      <div className="msg-app">
        <div className="msg-state" role="status">
          <p className="msg-state-kicker">NOT FOUND</p>
          <h2>没有这个角色</h2>
          <p>链接里的角色标识不在角色列表里。</p>
          <SiteLink className="msg-btn" href={MESSAGES_APP_PATH} source={linkSource}>
            回到角色列表
          </SiteLink>
        </div>
      </div>
    );
  }

  return (
    <ConversationView
      controller={controller}
      characterName={character?.name ?? characterId}
      characterHandle={character?.handle ?? characterId}
      avatar={character?.avatar ?? "/assets/legacy/img/portrait/futaba.png"}
      avatarAlt={character?.avatar_alt ?? "角色头像"}
      storyVersion={character?.story_version ?? "1.0.0"}
      limits={limits}
      linkSource={linkSource}
    />
  );
}
