/**
 * 从 `contracts/openapi.json` 生成前端类型。
 *
 * 契约（SHARED-CONTRACTS §2 / 01 §7）：`apps/web/lib/api/generated/` 由 T00 拥有，
 * **从已挂载后端生成，不手改类型**。手写字段映射正是要避免的漂移来源。
 *
 * 用法（apps/web 目录）：npm run gen:api
 * 前置：先在仓库根目录运行 apps/api/scripts/export_openapi.py。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(webDir, "..", "..");
const contractPath = resolve(repoRoot, "contracts", "openapi.json");
const outputPath = resolve(webDir, "lib", "api", "generated", "schema.ts");

const HEADER = `/**
 * 本文件由 \`npm run gen:api\` 生成，请勿手工修改。
 * 来源：contracts/openapi.json（apps/api/scripts/export_openapi.py 生成）。
 */

`;

async function main() {
  let contract;
  try {
    contract = await readFile(contractPath, "utf8");
  } catch {
    throw new Error(
      `找不到契约文件 ${contractPath}；请先在仓库根目录运行：\n` +
        "  uv run --project apps/api python apps/api/scripts/export_openapi.py",
    );
  }

  const ast = await openapiTS(JSON.parse(contract));
  const generated = astToString(ast);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, HEADER + generated, "utf8");
  console.log(`已生成 ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
