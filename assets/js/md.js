/* =====================================================================
   PHANTOM LOG · md.js —— 小型 Markdown 渲染器（无依赖）
   支持：## / ### 标题 · 段落 · **粗** *斜* `代码` [链接](url) · - 列表 · 1. 列表
        ``` 代码块 · | 表格 | · --- 分隔线 · ![说明](图 "图注")
        > **名字**：台词（多行 = 对话框） · !!! 提示框
   对话框卡片与预告信标题的样式按 p5-ui（Vue 组件库）的方案手写在 post.css / core.js 里
   ===================================================================== */
(function () {
  const { esc, rnName } = window.PL;
  const S = window.PL_SITE;
  const safe = (u) => (/^\s*(javascript|data|vbscript):/i.test(u) ? '#' : u);

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, a, u) => `<img src="${safe(u)}" alt="${a}" loading="lazy">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${safe(u)}"${/^https?:/.test(u) ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }

  /* 引用：每行都是「**名字**：台词」或「名字：台词」时，渲染成 P5 对话框
     （卡片样式在 post.css：框体图来自 p5-ui 的 notification.png，立绘 + 斜置署名） */
  function quote(lines) {
    const said = lines.map((l) => l.match(/^(?:\*\*([^*]+)\*\*|([^：:]{1,8}))\s*[：:]\s*(.+)$/));
    if (said.every((m) => m && S.speakers[(m[1] || m[2]).trim()])) {
      return `<div class="talk">${said.map((m) => {
        const who = (m[1] || m[2]).trim();
        const me = S.me.includes(who);
        return `<div class="say${me ? ' me' : ''}"><img class="face" src="${S.speakers[who]}" alt="" loading="lazy">` +
          `<div class="say-b"><span class="say-n">${rnName(who)}</span><p>${inline(m[3])}</p></div></div>`;
      }).join('')}</div>`;
    }
    return `<blockquote>${lines.map((l) => `<p>${inline(l)}</p>`).join('')}</blockquote>`;
  }

  function table(rows) {
    const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    return `<div class="tbl"><table><thead><tr>${head.map((h) => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead>` +
      `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function render(src) {
    const L = src.replace(/\r/g, '').split('\n');
    const out = []; const toc = [];
    let i = 0; let h2n = 0;
    const take = (re) => { const b = []; while (i < L.length && re.test(L[i])) b.push(L[i++]); return b; };
    while (i < L.length) {
      const l = L[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = l.match(/^```\s*(\w*)/))) {
        const lang = m[1]; const b = []; i++;
        while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]);
        i++;
        out.push(`<div class="code">${lang ? `<span class="lang">${esc(lang)}</span>` : ''}<pre><code>${esc(b.join('\n'))}</code></pre></div>`);
      } else if ((m = l.match(/^(#{2,3})\s+(.+)/))) {
        const lv = m[1].length; const id = `s-${toc.length + 1}`; i++;
        toc.push({ id, lv, t: window.PL.strip(m[2]) });
        out.push(lv === 2
          ? `<h2 id="${id}"><span class="n">${String(++h2n).padStart(2, '0')}</span>${inline(m[2])}</h2>`
          : `<h3 id="${id}">${inline(m[2])}</h3>`);
      } else if (/^-{3,}\s*$/.test(l)) { out.push('<hr>'); i++; }
      else if ((m = l.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/))) {
        i++;
        out.push(`<figure><img src="${esc(safe(m[2]))}" alt="${esc(m[1])}" loading="lazy">${m[3] ? `<figcaption>${esc(m[3])}</figcaption>` : ''}</figure>`);
      } else if (/^!!!\s/.test(l)) {
        out.push(`<aside class="note" role="note">${take(/^!!!\s/).map((x) => inline(x.replace(/^!!!\s/, ''))).join(' ')}</aside>`);
      } else if (/^>\s?/.test(l)) out.push(quote(take(/^>\s?/).map((x) => x.replace(/^>\s?/, ''))));
      else if (/^\|/.test(l) && /^\|?\s*:?-{3,}/.test(L[i + 1] || '')) out.push(table(take(/^\|/)));
      else if (/^[-*]\s/.test(l)) out.push(`<ul>${take(/^[-*]\s/).map((x) => `<li>${inline(x.replace(/^[-*]\s/, ''))}</li>`).join('')}</ul>`);
      else if (/^\d+\.\s/.test(l)) out.push(`<ol>${take(/^\d+\.\s/).map((x) => `<li>${inline(x.replace(/^\d+\.\s/, ''))}</li>`).join('')}</ol>`);
      else {
        const b = [];
        while (i < L.length && L[i].trim() && !/^(```|#{2,3}\s|>|\||!!!\s|[-*]\s|\d+\.\s|-{3,}\s*$)/.test(L[i])) b.push(L[i++]);
        if (!b.length) b.push(L[i++]);
        out.push(`<p>${inline(b.join(' '))}</p>`);
      }
    }
    return { html: out.join('\n'), toc };
  }

  window.PL.md = render;
})();
