import type { NextConfig } from "next";

/**
 * 前端边界（01 §2 / 06 §3）：
 *  - 浏览器只访问同源相对地址 `/api/v1`，不读环境变量里的 API 地址。
 *  - Next.js 服务端用仅服务端可见的 `API_INTERNAL_URL`（见 lib/api/server.ts）。
 *  - 前端不持有数据库凭据；密码与内部地址不放进 NEXT_PUBLIC_*。
 *
 * 旧 URL 兼容由 T00 集成（SHARED-CONTRACTS §2）。
 */

/**
 * 旧站入口 → 新路由（01 §5 的映射表）。
 *
 * 两条硬规则：
 *  1. **只对有效内容做永久重定向**；无效 slug 不在这里兜底 —— 请求会被转到
 *     `/posts/<slug>`，由该页面返回真正的 404。统一跳回首页会把错误掩盖掉。
 *  2. `index.html#posts` 这类锚点由浏览器自己保留（fragment 不发给服务端），
 *     所以不需要也不能在服务端处理 hash。
 */
const legacyRedirects = [
  { source: "/index.html", destination: "/", permanent: true },
  { source: "/about.html", destination: "/about", permanent: true },
  { source: "/map.html", destination: "/map", permanent: true },
  { source: "/weather.html", destination: "/weather", permanent: true },
  { source: "/guestbook.html", destination: "/guestbook", permanent: true },
  {
    // post.html?p=<slug> → /posts/<slug>：用 has 里的具名捕获组把查询参数带进目标路径，
    // 不丢失 slug。缺少 p 的 /post.html 不匹配任何规则，自然 404，不掩盖。
    source: "/post.html",
    has: [{ type: "query" as const, key: "p", value: "(?<slug>[^/?#]+)" }],
    destination: "/posts/:slug",
    permanent: true,
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return legacyRedirects;
  },
};

export default nextConfig;
