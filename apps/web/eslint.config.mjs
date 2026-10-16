/**
 * ESLint 扁平配置。
 *
 * 用 Next 官方的 core-web-vitals 规则集。**注意 TypeScript 版本上限**：
 * `eslint-config-next` 依赖的 typescript-eslint 不支持 TypeScript 7，
 * 因此 `typescript` 固定在 6.x（见 package.json 与交付单的版本表）。
 */

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // 由 npm run gen:api 生成，不手工修改，也不参与 lint。
      "lib/api/generated/**",
    ],
  },
  ...nextCoreWebVitals,
];

export default config;
