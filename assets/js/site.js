/* =====================================================================
   PHANTOM LOG · site.js —— 站点配置（改这里就能变成你的博客）
   文章在 posts.js；这里放站点信息、关于页数据、说话人头像、分类→塔罗。
   ===================================================================== */
window.PL_SITE = {
  name: 'PHANTOM', nameB: 'LOG', nameCn: '怪盗手记',
  kicker: 'Take your time',
  lead: '信息工程专业大三在读，打过 ACM，喜欢琢磨问题，也喜欢动手折腾。这里是我的课后据点，记录技术学习，偶尔聊聊游戏与生活。',
  author: 'ScurryCat', codeName: 'PHANTOM THIEF', role: '信息工程专业 · 大三学生', base: '校园 / 课后据点',
  startYear: 2023,
  heroArt: 'assets/img/hero-joker.webp',
  logo: 'assets/img/logo-p5r.webp',
  ticker: ['TAKE YOUR TIME', '偷走你的心', 'LOOKING COOL, JOKER!', '写完再睡', 'SHOWTIME'],
  legal: '非商业个人站点。Persona 5 相关图像与字体素材版权归 <b>©ATLUS ©SEGA</b> 所有，仅作个人装饰使用。',
  copyright: '© 2023–2026 ScurryCat · 咖啡与深夜驱动',

  social: [
    { k: 'GitHub', v: '@ScurryCat', url: 'https://github.com/ScurryCat' },
    { k: 'Mail', v: 'you@example.com', url: 'mailto:you@example.com' },
    { k: 'X / Twitter', v: '@yourname', url: 'https://x.com/' },
    { k: 'RSS', v: '订阅全部文章', url: 'index.html#archive' }
  ],

  /* 右下角问卷（poll.js）。票数是本地装饰：base 是设定值，访客那一票只在他自己
     浏览器里叠加 —— 和游戏里那个固定百分比一样是布景，不是真实统计。
     配置与复用方式见 README；新增问题请换稳定 id。 */
  poll: {
    id: 'phantom-thieves-belief',
    title: '怪盗ch',
    question: '你相信心之怪盗吗？',
    questionHighlight: ['心之怪盗'],
    options: [{ value: 'yes', label: 'YES' }, { value: 'no', label: 'NO' }],
    main: 'yes',                                  // 大号百分比显示哪一项
    base: { yes: 73, no: 927 },                   // 设定值，合起来正好 7.3%
    comment: { author: '匿名', text: '设网站的人根本脑子有洞', highlight: ['脑子有洞'] }
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
    19: { href: 'about.html', en: 'CONFIDANT', title: '关于我', note: '五维、友链、学习足迹，还有联络方式。' },
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
    lead: '我是 ScurryCat，信息工程专业大三在读，有过 ACM 竞赛经历。',
    intro: [
      '平时和信号、电路、代码打交道。打比赛留下了一些习惯：卡住时拿小样例找思路，觉得没问题时，再检查一遍边界。让一个想法真正跑通，始终是件挺有意思的事。',
      '这个博客算是我的卢布朗。题解、技术笔记和项目记录都放在这里，偶尔也聊游戏，记一点大学生活。写下来，是为了把学过的东西理清楚，也方便以后回头看看，自己当时在折腾什么。',
      'Take Your Time. 欢迎来坐坐。'
    ],
    /* 五维（P5 原作的五项人格能力），lv 1–5 */
    stats: [
      { en: 'KNOWLEDGE', cn: '知识', lv: 5, rank: 'Erudite', note: '信号、电路与算法，学过的东西再理一遍' },
      { en: 'GUTS', cn: '胆量', lv: 4, rank: 'Dauntless', note: '题目卡住了，换个思路再试一次' },
      { en: 'PROFICIENCY', cn: '灵巧', lv: 5, rank: 'Transcendent', note: '拿小样例找思路，把边界条件查清楚' },
      { en: 'KINDNESS', cn: '温柔', lv: 3, rank: 'Considerate', note: '把题解和学习过程写清楚，方便交流' },
      { en: 'CHARM', cn: '魅力', lv: 3, rank: 'Smooth', note: '在自己的据点里聊技术，也聊游戏与生活' }
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
      { y: '现在', h: '搭建自己的课后据点', p: '把 Persona 5 的氛围带进博客，记录技术学习与大学生活。' },
      { y: '大三', h: '信息工程专业在读', p: '在信号、电路与代码之间切换，把学过的东西慢慢理清楚。' },
      { y: 'ACM', h: '算法竞赛经历', p: '和算法题较过劲，也把检查小样例与边界条件的习惯留了下来。' }
    ]
  }
};
