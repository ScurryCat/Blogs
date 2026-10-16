"use client";

/**
 * 页头日历：`new Date()` 在服务端与客户端会得到不同时间，
 * 因此在**挂载后的第一帧**才渲染，避免水合不一致（旧站是纯客户端插入，没有这个问题）。
 *
 * 用 `requestAnimationFrame` 而不是在 effect 里同步 `setState`：
 * 后者会触发级联渲染（React Compiler 的 react-hooks/set-state-in-effect）。
 */

import { useEffect, useState, type ReactNode } from "react";

import { Calendar } from "@/features/legacy/text/calendar";

export function HeaderCalendar(): ReactNode {
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => {
    let frame = 0;
    let timer = 0;
    const read = () => setToday(new Date());
    frame = window.requestAnimationFrame(read);
    timer = window.setInterval(read, 60_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);

  if (!today) return <div className="hud-cal" aria-hidden="true" />;
  return (
    <div className="hud-cal">
      <Calendar date={today} />
    </div>
  );
}
