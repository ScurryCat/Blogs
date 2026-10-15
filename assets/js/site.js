/* =====================================================================
   PHANTOM LOG · site.js —— 站点配置（改这里就能变成你的博客）
   文章在 posts.js；这里放站点信息、关于页数据、说话人头像、分类→塔罗。
   ===================================================================== */
window.PL_SITE = {
  name: 'PHANTOM', nameB: 'LOG', nameCn: '怪盗手记',
  kicker: 'Take your time',
  lead: '白天是前端工程师，夜里写技术、旅途与游戏。这里没有 SOP，只有一个把想法偷出来的人。',
  author: 'JOKER', codeName: 'PHANTOM THIEF', role: '前端工程师 · 独立开发者', base: 'Tokyo / 你的城市',
  startYear: 2023,
  heroArt: 'assets/img/hero-joker.webp',
  logo: 'assets/img/logo-p5r.webp',
  ticker: ['TAKE YOUR TIME', '偷走你的心', 'LOOKING COOL, JOKER!', '写完再睡', 'SHOWTIME'],
  legal: '非商业个人站点。Persona 5 相关图像与字体素材版权归 <b>©ATLUS ©SEGA</b> 所有，仅作个人装饰使用。',
  copyright: '© 2023–2026 JOKER · 咖啡与深夜驱动',

  social: [
    { k: 'GitHub', v: '@yourname', url: 'https://github.com/' },
    { k: 'Mail', v: 'you@example.com', url: 'mailto:you@example.com' },
    { k: 'X / Twitter', v: '@yourname', url: 'https://x.com/' },
    { k: 'RSS', v: '订阅全部文章', url: 'index.html#archive' }
  ],

  /* 右下角问卷（poll.js）。票数是本地装饰：base 是设定值，访客那一票只在他自己
     浏览器里叠加 —— 和游戏里那个固定百分比一样是布景，不是真实统计。
     要接真实统计就把 poll.js 里的 tally() 换成一次 fetch。 */
  poll: {
    title: '怪盗ch',
    q: '你相信心灵怪盗吗？',
    qHtml: '你相信<em>心灵怪盗</em>吗？',
    options: { yes: 'YES', no: 'NO' },
    main: 'yes',                                  // 大号百分比显示哪一项
    base: { yes: 73, no: 927 },                   // 设定值，合起来正好 7.3%
    by: '匿名',
    commentHtml: '设网站的人根本<b>脑子有洞</b>',   // 用 <b> 标出要上红底的那截
    comment: '设网站的人根本脑子有洞'
  },

  /* 留言板（guestbook.js + guestbook-store.js）。
     store: 'local' = 留言只存在访客自己浏览器里（示例模式，换设备看不到）；
            改成 'remote' 并填 endpoint / key 就切到 Supabase，页面代码不用动。 */
  guestbook: {
    store: 'local',
    endpoint: '',            // 例：https://abcdefgh.supabase.co
    key: '',                 // Supabase 的 anon public key（公开的，权限靠 RLS）
    table: 'guestbook',
    greeting: '这里没有算法，只有人。想说什么都行——技术、旅途、游戏，或者只是路过。',
    maxName: 20, maxText: 500, cooldown: 30
  },

  /* 分类 → 塔罗大阿卡纳（文章页小卡片 & 列表编号用） */
  arcana: {
    LOG: ['0', 'FOOL'], TECH: ['I', 'MAGICIAN'], LIFE: ['XVII', 'STAR'], TOOL: ['IX', 'HERMIT'],
    GAME: ['XXI', 'WORLD'], BOOK: ['II', 'PRIESTESS'], INFO: ['XI', 'JUSTICE']
  },

  /* 正文 `> **名字**：台词` 的对话框立绘（照 p5-ui Notification 的整幅人物立绘，
     来自 p5-ui/src/assets/images/portraits；「我 / JOKER」用站内的怪盗装立绘，显示在右侧） */
  speakers: {
    '摩尔加纳': 'assets/img/portrait/mona.png', '双叶': 'assets/img/portrait/futaba.png',
    '真': 'assets/img/portrait/makoto.png', '龙司': 'assets/img/portrait/ryuji.png',
    '杏': 'assets/img/portrait/ann.png', '祐介': 'assets/img/portrait/yusuke.png',
    '春': 'assets/img/portrait/haru.png', '芳泽霞': 'assets/img/portrait/kasumi.png',
    /* 「我」用画集 p5artbook-020 右页的正面线稿（本地抠底，见 tools/portrait-crop/），
       和 p5-ui 那套彩色立绘不是同一画风，但黑白线稿压在这个黑底站上更干净 */
    '我': 'assets/img/portrait/joker-artbook.png', 'JOKER': 'assets/img/portrait/joker-artbook.png'
  },
  me: ['我', 'JOKER'],

  /* 天气页：默认城市（Open-Meteo，无需 API Key）。访客可以自己换城市或定位，选择记在浏览器里 */
  weather: { city: '东京', lat: 35.6764, lon: 139.65 },

  /* 东京地图：地点编号 → 目的地。没写的地点显示为「未开放」。
     post: 文章 slug（标题/日期自动取）；或 href + en + title + note */
  map: {
    18: { href: 'index.html', en: 'HIDEOUT', title: '据点 · 首页', note: '勒布朗二楼的阁楼。所有行动都从这里出发。' },
    12: { href: 'index.html#posts', en: 'PALACE', title: '宫殿索引 · 全部文章', note: '十字路口最热闹的地方，所有文章都在这里排队。' },
    8: { href: 'index.html#archive', en: 'ARCHIVE', title: '归档', note: '老街和老文章，按年份排好。' },
    9: { href: 'weather.html', en: 'FORECAST', title: '天气预报', note: '出门潜入之前，先看看明天会不会下雨。' },
    19: { href: 'about.html', en: 'CONFIDANT', title: '关于我', note: '五维、友链、履历，还有联络方式。' },
    10: { post: 'phantom-blog-launch' },
    4: { post: 'css-p5-menu' },
    2: { post: 'tokyo-ten-days' },
    7: { post: 'desk-setup-2026' },
    17: { post: 'p5r-platinum' },
    15: { post: 'snow-country-notes' },
    6: { post: 'a11y-checklist' },
    13: { post: 'assets-and-credits' }
  },

  about: {
    bg: 'assets/img/bg-leblanc.jpg', art: 'assets/img/joker-thief.webp',
    lead: '我写代码，也写点别的。白天把界面调到像素对齐，夜里在 Persona 5 的菜单里找灵感——这个博客就是两者的交集。',
    intro: [
      '做了六年 Web 前端，从切图到带小团队，最着迷的还是「一个界面如何让人想反复点开」。P5 的 UI 是我的长期教材：斜切、撕纸字、半调网点、每次切屏都砸你一下的转场——但它的信息层级始终清楚。',
      '所以这个站所有卡片、按钮、转场都是手写 CSS，没有 UI 框架，没有构建步骤。'
    ],
    /* 五维（P5 原作的五项人格能力），lv 1–5 */
    stats: [
      { en: 'KNOWLEDGE', cn: '知识', lv: 5, rank: 'Erudite', note: 'TypeScript、浏览器渲染原理、可访问性规范' },
      { en: 'GUTS', cn: '胆量', lv: 4, rank: 'Dauntless', note: '敢在周五下午上线，也敢回滚' },
      { en: 'PROFICIENCY', cn: '灵巧', lv: 5, rank: 'Transcendent', note: 'CSS 动效、SVG、设计系统落地' },
      { en: 'KINDNESS', cn: '温柔', lv: 3, rank: 'Considerate', note: '写文档、带新人、认真做 Code Review' },
      { en: 'CHARM', cn: '魅力', lv: 3, rank: 'Smooth', note: '技术分享 12 场，紧张程度逐年下降' }
    ],
    /* COOP：友链 / 常去的地方。rank 1–10 */
    coop: [
      { name: '摩尔加纳', arcana: ['I', 'MAGICIAN'], rank: 9, icon: 'assets/img/icon/morgana.webp', note: '每晚催我睡觉的猫，兼职代码审查', url: 'https://github.com/' },
      { name: '双叶的工具箱', arcana: ['IX', 'HERMIT'], rank: 7, icon: 'assets/img/icon/oracle.webp', note: '最好的前端调试技巧合集', url: 'https://github.com/' },
      { name: '祐介的画廊', arcana: ['IV', 'EMPEROR'], rank: 6, icon: 'assets/img/icon/fox.webp', note: '一个只发配色方案的独立博客', url: 'https://github.com/' },
      { name: '真的读书会', arcana: ['II', 'PRIESTESS'], rank: 8, icon: 'assets/img/icon/queen.webp', note: '每月一本，拒绝鸡汤', url: 'https://github.com/' },
      { name: '龙司的跑步群', arcana: ['VII', 'CHARIOT'], rank: 4, icon: 'assets/img/icon/skull.webp', note: '周末 10 公里，迟到请咖啡', url: 'https://github.com/' },
      { name: '春的菜园', arcana: ['III', 'EMPRESS'], rank: 5, icon: 'assets/img/icon/noir.webp', note: '屋顶种菜与慢生活', url: 'https://github.com/' }
    ],
    timeline: [
      { y: '2026', h: '把博客重做成怪盗手记', p: '纯手写静态站，零框架零构建，直接扔到 GitHub Pages。' },
      { y: '2024', h: '开始带小前端团队', p: '负责组件库与设计系统落地，写了三份被转发的规范。' },
      { y: '2023', h: '这个博客诞生', p: '最初的目的是逼自己把「看过」变成「写过」。' },
      { y: '2020', h: '第一次打开 Persona 5', p: '因为菜单太好看，去学了 CSS 变换与 clip-path。' }
    ]
  }
};
