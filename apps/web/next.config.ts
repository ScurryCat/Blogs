import path from "node:path";

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

/**
 * 开发期转发（**仅当环境变量存在时生效，生产不受影响**）。
 *
 * 为什么需要：浏览器按设计只访问同源相对地址 `/api/v1`（01 §2 / 06 §3），而音乐按
 * 素材分层复用旧站静态路径 `/assets/music/`（见 features/legacy/music.ts）。在开发
 * 环境里 Next 独占一个端口，这两条路径都会 404 —— 于是「登录成功路径」与「音乐能否
 * 播放」在本地无法验证，只能靠组件测试代替，那不是浏览器证据。
 *
 * 生产环境由网关转发这两条路径（06 §1：只有网关对公网开放），因此这里的转发
 * **不是生产配置**，只是在本地复刻网关的行为。不设这两个变量 → 不生成任何规则。
 */
const devApiUrl = process.env.DEV_API_URL?.replace(/\/$/, "");
const devLegacyStaticUrl = process.env.DEV_LEGACY_STATIC_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  /**
   * 生产镜像用 standalone 输出（06 §2 要求；T10 的集成申请 §6.1）。
   *
   * `next start` 仍然可用（standalone 只是**额外**产出 `.next/standalone`），所以本地
   * 开发与 T02 的浏览器套件不受影响；生产镜像改用 `node server.js`，镜像更小。
   *
   * `outputFileTracingRoot` 锁定到仓库根：这是 monorepo，不锁定的话 standalone 的目录
   * 结构会随「锁文件在哪一层」漂移，runner 阶段的 COPY 路径就会失配。
   */
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return legacyRedirects;
  },
  async rewrites() {
    const rules: { source: string; destination: string }[] = [];
    if (devApiUrl) {
      rules.push({ source: "/api/v1/:path*", destination: `${devApiUrl}/api/v1/:path*` });
    }
    if (devLegacyStaticUrl) {
      rules.push({
        source: "/assets/music/:path*",
        destination: `${devLegacyStaticUrl}/assets/music/:path*`,
      });
    }
    return rules;
  },
};

export default nextConfig;
