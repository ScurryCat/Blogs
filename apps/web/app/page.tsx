/**
 * 首页占位。
 *
 * ⚠️ 所有权：**T02**（SHARED-CONTRACTS §2）。T00 只提供能让工程编译与构建通过的最小页面。
 * 旧站 `index.html` + `assets/js/home.js` 仍是当前正式首页，本轮**没有**改动它
 * （06 §10：本次不变更正在运行的服务器，保留 8000 静态预览作对照）。
 */

export default function HomePage() {
  return (
    <main>
      <h1>PHANTOM LOG</h1>
      <p>
        工程骨架已建立，业务页面尚未迁移。当前正式站点仍由仓库根目录的静态站提供，
        旧站预览（端口 8000）未受影响。
      </p>
    </main>
  );
}
