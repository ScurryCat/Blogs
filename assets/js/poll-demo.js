(function () {
  'use strict';
  const PL = window.PL;
  PL.chrome('poll-demo');
  const page = document.querySelector('.poll-demo');
  if (!page) return;
  const output = page.querySelector('.poll-demo-output');
  const instances = new Map();
  let generation = '';
  const template = { title: '怪盗ch', questionHighlight: [],
    options: [{ value: 'yes', label: 'YES' }, { value: 'no', label: 'NO' }], main: 'yes' };
  function examples() {
    const mirror = { ...template, id: 'demo-mirror' + generation,
      question: '你会给同伴第二次机会吗？', questionHighlight: ['第二次机会'], base: { yes: 73, no: 927 },
      comment: { author: '路过的怪盗', text: '在任意一边投票，另一边会立即记住相同的选择。' } };
    return [
      ['zero', { ...template, id: 'demo-zero' + generation, question: '今晚准备开始行动吗？', questionHighlight: ['开始行动'], base: { yes: 0, no: 0 } }],
      ['full', { ...template, id: 'demo-full' + generation, question: '咖啡和咖喱是绝配吗？', questionHighlight: ['绝配'], base: { yes: 100, no: 0 },
        options: [{ value: 'yes', label: '赞成' }, { value: 'no', label: '再想想' }] }],
      ['long', { ...template, id: 'demo-long' + generation,
        question: '即使每个人都说事情已经无法改变，你是否仍愿意相信自己的判断，和伙伴一起迈出改变世界的第一步？',
        questionHighlight: ['相信自己的判断', '第一步'], base: { yes: 73, no: 927 },
        comment: { author: '匿名', text: '问题可以很长，评论也可以写下完整的想法。愿意认真想一想的人，就已经迈出了第一步。', highlight: ['第一步'] } }],
      ['mirror-a', mirror], ['mirror-b', mirror]
    ];
  }
  function destroyAll() { instances.forEach(instance => instance.destroy()); instances.clear(); }
  function createAll() {
    examples().forEach(([slot, config]) => {
      if (instances.has(slot)) return;
      const instance = PL.poll.create(config, { mode: 'inline', container: page.querySelector(`[data-slot="${slot}"]`) });
      instances.set(slot, instance); instance.show();
    });
  }
  function onClick(event) {
    const control = event.target.closest('button[data-action]');
    if (!control) return;
    switch (control.dataset.action) {
      case 'show-default': PL.poll.show(); output.textContent = '默认浮层已显示；重复显示不会增加实例。'; break;
      case 'close-default': PL.poll.close(); output.textContent = '默认浮层已关闭，没有增加投票。'; break;
      case 'reset-default': PL.poll.reset(); output.textContent = '默认问卷的本机记录已清除，示例题目不受影响。'; break;
      case 'reopen-default': PL.poll.close(); PL.poll.show(); output.textContent = '已在关闭动画期间重开默认浮层。'; break;
      case 'create-inline': createAll(); output.textContent = '内嵌实例已创建，已有实例不会重复挂载。'; break;
      case 'destroy-inline': destroyAll(); output.textContent = '内嵌实例已销毁，监听与订阅已释放。'; break;
      case 'recreate-inline': destroyAll(); createAll(); output.textContent = '内嵌实例已重建，已有选择仍保留。'; break;
      case 'fresh-inline': destroyAll(); generation = '-' + Date.now(); createAll(); output.textContent = '已使用新 ID 创建未投票的示例；原来的记录仍保留。'; break;
    }
  }
  page.addEventListener('click', onClick);
  PL.onLeave(() => { page.removeEventListener('click', onClick); destroyAll(); });
  createAll();
})();
