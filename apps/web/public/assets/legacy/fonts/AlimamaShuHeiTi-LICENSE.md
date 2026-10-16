阿里妈妈数黑体 Bold (Alimama ShuHeiTi Bold)
=============================================

用途：文章正文对话框的「说话人署名」（assets/css/post.css 的 .say-n）。
来源：p5-ui 的 P5Title 组件（title/title.vue 的 p5-font mixin）指定的就是这套字体。

字体：Alimama ShuHeiTi Bold ｜ 版权 (c) 2022 阿里巴巴（中国）有限公司
官方地址：https://fonts.alibabagroup.com/#/more
下载来源：https://fonts.alibabadesign.com/AlimamaShuHeiTi/AlimamaShuHeiTi-Bold/AlimamaShuHeiTi-Bold.woff2

授权要点（官方原文摘要）：
- 永久免费正版商用，个人与企业均可直接使用，无需额外授权。
- 不得用于商标注册，不得对字体本身二次创作。
- 可以嵌入 App / 网站使用，但不得就字体本身向用户或会员收费。
- 本文件为官方发行的 .woff2 原样副本，未做任何修改或拆分。

如需替换成别的字体，只改 base.css 里的 `--f-name` 一个变量即可。

已知缺字
--------
这套字库只收了 7029 个字形，站内说话人名里 **「祐」（U+7950）不在其中**。
所以给「祐介」写台词时，那一个字会回落到字体栈的下一位（Noto Sans SC 900），
字形和其他字会有点不一致。「祐介」目前没有出现在任何文章里，暂不影响。
其余姓名（摩尔加纳 / 双叶 / 真 / 龙司 / 杏 / 春 / 芳泽霞 / 我 / JOKER）全部覆盖。
