import type { NextConfig } from "next";

/**
 * 前端边界（01 §2 / 06 §3）：
 *  - 浏览器只访问同源相对地址 `/api/v1`，不读环境变量里的 API 地址。
 *  - Next.js 服务端用仅服务端可见的 `API_INTERNAL_URL`（见 lib/api/server.ts）。
 *  - 前端不持有数据库凭据；密码与内部地址不放进 NEXT_PUBLIC_*。
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 旧站资源（assets/）由 T02 在迁移时决定如何托管；此阶段不接管旧目录。
};

export default nextConfig;
