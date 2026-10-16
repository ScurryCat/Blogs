"use client";

/**
 * 管理端技能列表 `/admin/skills`（T09）。
 *
 * 边界（01 §3、05 §7）：
 *  - 这里**不做访问控制**：隐藏入口不是安全边界，读写权限一律由 FastAPI 判断；
 *    未登录时显示明确的失败原因与登录入口，而不是假装没有技能；
 *  - 列表包含草稿（这是管理端点的用途），公开 `/api/v1/skills` 永远只返回已发布；
 *  - **不显示等级**（07 §6）：列表里的数字只有「关联作品 N 件」与 `version`，
 *    前者是实时关系计数，后者是并发控制版本号，都不是能力评分。
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import "@/features/velvet/velvet.css";
import { fetchAdminSkills } from "@/features/velvet/api";
import { adminSkillPagePath } from "@/features/velvet/paths";
import { ADMIN_SKILL_PAGE_SIZE, type AdminSkill } from "@/features/velvet/types";
import { SkillWorkspace } from "@/features/velvet/admin/skill-workspace";
import { useVelvetAdminSession } from "@/features/velvet/admin/session";

export default function AdminSkillsPage(): ReactNode {
  const { session, phase, message, describe, isConflict } = useVelvetAdminSession();
  const [skills, setSkills] = useState<readonly AdminSkill[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await fetchAdminSkills({ limit: ADMIN_SKILL_PAGE_SIZE }, signal);
        setSkills(page.items);
        setListError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setListError(describe(error));
      }
    },
    [describe],
  );

  useEffect(() => {
    if (phase !== "ready" || !session?.authenticated) return undefined;
    const controller = new AbortController();
    // 先 `await` 再 setState：effect 体里同步 setState 会触发级联渲染。
    void (async () => {
      await Promise.resolve();
      await load(controller.signal);
    })();
    return () => controller.abort();
  }, [load, phase, session]);

  if (phase === "loading") {
    return <p className="plv-hint">正在读取站主会话…</p>;
  }

  if (phase === "unavailable" || !session) {
    return (
      <section className="plv-room" role="alert">
        <p className="plv-kicker">NO SESSION</p>
        <h1 className="plv-title">无法读取会话</h1>
        <p className="plv-hint">{message ?? "服务暂时不可用。"}</p>
        <p className="plv-hint">
          请先到 <Link href="/admin/login">站主登录</Link> 建立会话。
        </p>
      </section>
    );
  }

  if (!session.authenticated) {
    return (
      <section className="plv-room" role="status">
        <p className="plv-kicker">SIGN IN</p>
        <h1 className="plv-title">需要站主登录</h1>
        <p className="plv-hint">
          管理接口只接受已登录的站主会话。请到 <Link href="/admin/login">站主登录</Link>，
          登录后回到本页。
        </p>
        <p className="plv-hint">
          说明：本页不做路由保护 —— 真正的权限判断在后端（01 §3）。
        </p>
      </section>
    );
  }

  return (
    <div className="plv-room">
      <header className="plv-bar">
        <div>
          <p className="plv-kicker">{"// ADMIN · SKILLS"}</p>
          <h1 className="plv-title">技能管理</h1>
          <p className="plv-lead">
            以 <strong>{session.user?.username}</strong> 登录 ·
            <Link href="/velvet"> 看公开技能全书</Link>
          </p>
        </div>
        <button
          className="plv-button"
          type="button"
          onClick={() => setCreating((value) => !value)}
          data-new-skill=""
        >
          {creating ? "收起新建表单" : "新建技能"}
        </button>
      </header>

      {creating ? (
        <section className="plv-section">
          <h2 className="plv-hint">新建技能（总是先建成草稿）</h2>
          <SkillWorkspace
            csrfToken={session.csrf_token}
            describeError={describe}
            isConflict={isConflict}
            createMode
            onSaved={() => {
              setCreating(false);
              void load();
            }}
          />
        </section>
      ) : null}

      {listError ? (
        <p className="plv-alert" role="alert">
          {listError}
        </p>
      ) : null}

      {skills.length === 0 && !listError ? (
        <p className="plv-hint">还没有技能。点上面的「新建技能」开始。</p>
      ) : (
        <table className="plv-table" data-admin-skills="">
          <caption className="plv-hint">
            按站主维护的展示顺序排列。公开技能全书只显示已发布且填写了证据的技能。
          </caption>
          <thead>
            <tr>
              <th scope="col">技能</th>
              <th scope="col">领域</th>
              <th scope="col">关联作品</th>
              <th scope="col">状态</th>
              <th scope="col">顺序</th>
              <th scope="col">编辑</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <tr key={skill.id} data-admin-skill={skill.slug}>
                <td>{skill.name}</td>
                <td>{skill.domain_label}</td>
                <td>
                  {skill.projects.length}
                  {skill.projects.some((relation) => relation.status !== "published") ? (
                    <strong> · 有草稿作品</strong>
                  ) : null}
                </td>
                <td>{skill.status === "published" ? "已发布" : "草稿"}</td>
                <td>{skill.position}</td>
                <td>
                  <Link href={adminSkillPagePath(skill.id)}>编辑</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
