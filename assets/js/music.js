/* =====================================================================
   PHANTOM LOG · music.js —— 手机音乐播放器的曲目清单
   三首都是 Lyn 演唱的原曲，文件放在 assets/music/ 下（该目录被 .gitignore
   排除：版权音频不进公开仓库，clone 下来是空的，播放器会落到「还没有曲子」空态）。
   要换曲子：把文件丢进 assets/music/，改下面的 title / artist / src 三行。
   ===================================================================== */
window.PL_MUSIC = [
  { title: 'Beneath the Mask', artist: 'Lyn · ©ATLUS', src: 'assets/music/beneath-the-mask.mp3' },
  { title: 'Beneath the Mask -rain-', artist: 'Lyn · ©ATLUS', src: 'assets/music/beneath-the-mask-rain.mp3' },
  { title: '星と僕らと', artist: 'Lyn · ©ATLUS', src: 'assets/music/hoshi-to-bokura-to.mp3' }
];
