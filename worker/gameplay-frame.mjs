export const GAMEPLAY_FRAME_RULES = `生成一张游戏运行时的完整玩法画面（in-game gameplay screenshot），不是氛围插画。
先根据玩法选择固定游戏镜头：俯视、等距、侧视或实际第一人称；镜头应让玩家看清并操作关卡，不做电影倾斜特写。
完整可操作区域必须占据主体：清晰呈现目标、障碍、可交互物体、玩家操作轨迹、动作前后的状态与机制反馈。
必要的游戏 HUD 可包含倒计时、目标数量、得分、连击、技能电量，信息少而可读；显示进行中的局面，不是标题页。
触摸操作用简洁的游戏内触点/滑动轨迹表示，不画真人手，不画现实手持产品、不拍摄手机屏幕、不加手机机身。
美术风格服务对象辨识与操作反馈；禁止宣传海报、产品照片、电影景深、夸张眩光、画面中央大特效遮挡目标。
禁止报告段落、广告标语、水印、炼金器 UI。可保留真实玩法需要的少量 HUD 数字和图标。`;

export function gameplayImagePrompt(report, size = '16:9') {
  const fields = [
    ['游戏', report.gameName], ['游戏类型', report.gameType], ['核心玩法', report.coreGameplay],
    ['玩家输入', report.control], ['主要动作', report.action], ['机制及反馈', report.mechanic],
    ['题材', report.topic], ['美术风格', report.artStyle],
  ].map(([label, value]) => `${label}：${String(value || '').trim().slice(0, 1600)}`).join('\n');
  return `${GAMEPLAY_FRAME_RULES}\n\n输出画幅：${size}，只输出一个完整游戏画面。\n${fields}\n\n验收：一眼能看出玩家在什么区域、对什么目标、怎样操作，以及该操作造成的玩法反馈。游戏场景、目标、操作指示和 HUD 必须清楚，不能只表达故事情绪。`;
}
