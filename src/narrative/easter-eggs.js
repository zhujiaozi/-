/**
 * 风味彩蛋系统
 *
 * 为游戏添加历史沉浸感和意外惊喜。
 * 所有彩蛋在 proxy 和 deterministic 模式下均生效。
 */

const { gameState } = require("../state/game-state");
const { characterRegistry } = require("../characters/registry");

// ========== 历史名句 ==========

const HISTORICAL_QUOTES = {
  "袁崇焕": [
    { trigger: { status: "executed" }, quote: "一生事业总成空，半世功名在梦中。死后不愁无勇将，忠魂依旧守辽东。" },
    { trigger: { status: "alive", relAbove: 50 }, quote: "陛下信臣，臣敢不效死？五年平辽，非虚言也。" },
    { trigger: { status: "alive", borderTensionAbove: 80 }, quote: "抚我则后，虐我则仇。建虏跳梁，臣请以头颅试之。" },
  ],
  "魏忠贤": [
    { trigger: { status: "executed" }, quote: "老奴一生所谋，不过为陛下守住这江山。到头来，竟落得如此下场……" },
    { trigger: { status: "alive", relBelow: -50 }, quote: "陛下可知，这紫禁城里，有多少双眼睛在看着您的一举一动？" },
  ],
  "孙承宗": [
    { trigger: { status: "dead", reason: "battle" }, quote: "吾受国厚恩，今日以死报之。尔等愿从我死乎？" },
    { trigger: { status: "alive", turnAbove: 40 }, quote: "老臣经历四朝，从未见过像陛下这样勤勉的君主。可惜，时也命也。" },
  ],
  "洪承畴": [
    { trigger: { status: "betrayed" }, quote: "我既已降，便无回头之路。但愿后人能理解我的苦衷……" },
  ],
  "钱谦益": [
    { trigger: { status: "betrayed" }, quote: "水太冷，不能下。" },
  ],
  "徐光启": [
    { trigger: { status: "alive", relAbove: 30 }, quote: "泰西之学，非奇技淫巧也。其算学格物，皆有益于世道人心。" },
  ],
  "房壮丽": [
    { trigger: { status: "dead", reason: "suicide" }, quote: "吾一生清正，今日当以死报国。" },
    { trigger: { status: "alive", relAbove: 40 }, quote: "陛下，气节二字，乃为臣者立身之本。臣宁可饿死，不受嗟来之食。" },
  ],
  "温体仁": [
    { trigger: { status: "alive", corrAbove: 70 }, quote: "老臣在朝这么多年，学到的最重要一件事就是——凡事不可操之过急。" },
  ],
  "崔呈秀": [
    { trigger: { status: "executed" }, quote: "罪臣一生依附权阉，无颜面对陛下。若真有来世，臣愿做一介布衣。" },
  ],
};

/**
 * 检查是否触发历史名句
 */
function checkHistoricalQuote(npcName, ctx) {
  const quotes = HISTORICAL_QUOTES[npcName];
  if (!quotes) return null;

  for (const q of quotes) {
    const t = q.trigger;
    // 状态匹配
    if (t.status && ctx.fateStatus !== t.status) continue;
    // 关系匹配
    if (t.relAbove !== undefined && (ctx.relScore === undefined || ctx.relScore <= t.relAbove)) continue;
    if (t.relBelow !== undefined && (ctx.relScore === undefined || ctx.relScore >= t.relBelow)) continue;
    // 世界变量匹配
    if (t.borderTensionAbove !== undefined && (ctx.borderTension === undefined || ctx.borderTension <= t.borderTensionAbove)) continue;
    // 回合匹配
    if (t.turnAbove !== undefined && (ctx.turn === undefined || ctx.turn <= t.turnAbove)) continue;
    // 腐败匹配
    if (t.corrAbove !== undefined && (ctx.corruption === undefined || ctx.corruption <= t.corrAbove)) continue;

    return q.quote;
  }
  return null;
}

// ========== 隐藏对话 (极端关系) ==========

const HIDDEN_DIALOGUES = {
  "魏忠贤": {
    loyal: { min: 25, max: 30, text: "（低声）陛下，老奴跟您说句掏心窝子的话。这满朝文武，真正为陛下着想的，不超过五个人。剩下的，都在为自己打算。老奴虽然名声不好，但老奴对陛下的心，是真的。" },
    hostile: { min: -100, max: -80, text: "（冷笑）陛下要杀老奴，一道旨意就够了，何必费这么多周章？但老奴死后，陛下就会知道——没有老奴，谁来替陛下盯着那些阳奉阴违的大臣？" },
  },
  "袁崇焕": {
    loyal: { min: 80, max: 100, text: "（热泪盈眶）陛下，臣在辽东每夜都在想——若不能平定辽东，臣有何面目回来见陛下？臣不怕死，只怕负了陛下的信任。" },
    hostile: { min: -100, max: -60, text: "（面色铁青）陛下既然不信臣，又何必问臣？将臣撤职查办便是。臣只求一件事——不要因为臣的罪责牵连辽东将士。" },
  },
  "孙承宗": {
    loyal: { min: 70, max: 100, text: "（深深一拜）陛下，老臣年事已高，来日无多。有句话藏在心里很久了——陛下太累了。有时候，治国如持满，握得太紧反而洒得更多。" },
  },
  "温体仁": {
    loyal: { min: 40, max: 60, text: "（难得认真地）陛下，老臣一向不愿表态。但今日……老臣要说，阉党之患，必须根除。老臣这些年不说，是不敢说。今日说了，是因为陛下值得老臣赌一次。" },
    hostile: { min: -100, max: -50, text: "（脸色苍白）陛下疑心老臣，老臣无话可说。但老臣在朝三十年，从未做过一件对不起大明的事。从未。" },
  },
  "钱谦益": {
    loyal: { min: 60, max: 100, text: "（激动）陛下！柳如是常说臣优柔寡断。但今日臣要请陛下下旨——臣愿领兵出征！哪怕战死沙场，也好过在书房里空谈气节。" },
    hostile: { min: -100, max: -40, text: "（低头，良久不语）陛下责备得对。臣……确实是个懦夫。陛下要杀要贬，臣绝无怨言。只求陛下不要为难柳如是。" },
  },
  "徐光启": {
    loyal: { min: 50, max: 100, text: "（目光炯炯）陛下，臣有一个大胆的设想——在京城设立一所'格物院'，专研天文、算学、农学、火器。请耶稣会士来讲学。不出十年，大明将拥有世界上最先进的科技。" },
  },
  "房壮丽": {
    loyal: { min: 60, max: 100, text: "（罕见地露出了笑容）陛下这般信任老臣，老臣……受之有愧。不过陛下放心，那些贪官污吏，老臣一个也不会放过。一个也不会。" },
  },
};

/**
 * 检查是否触发隐藏对话
 */
function checkHiddenDialogue(npcName, relScore) {
  const dialogues = HIDDEN_DIALOGUES[npcName];
  if (!dialogues) return null;

  for (const [, d] of Object.entries(dialogues)) {
    if (relScore >= d.min && relScore <= d.max) {
      return d.text;
    }
  }
  return null;
}

// ========== 季节风味 ==========

const SEASONAL_FLAVOR = {
  "春": [
    "京城柳絮纷飞，宫墙外隐隐传来孩童的欢笑声。",
    "春雨绵绵，太和殿的琉璃瓦上水珠串串。",
    "御花园里的桃花开了。崇祯帝经过时，想起了童年时母亲带他赏花的往事。",
    "春寒料峭。乾清宫的太监们往炭盆里又添了些银骨炭。",
  ],
  "夏": [
    "京城的夏天闷热难耐。宫里的冰鉴早早地摆了出来。",
    "蝉鸣阵阵。崇祯帝在批阅奏章，额上渗出了细密的汗珠。",
    "一场雷雨浇透了紫禁城。雨后，宫墙上的琉璃瓦在阳光下闪闪发光。",
  ],
  "秋": [
    "秋风起，京城街头的梧桐叶落了满地。",
    "御花园的桂花开了，香气飘进乾清宫。崇祯帝停下笔，深深吸了一口气。",
    "秋高气爽，正是围猎的好季节。但今年，崇祯帝没有出猎的兴致。",
    "中秋节。宫里摆了月饼和瓜果，但崇祯帝只是看了几眼，又继续批阅奏章。",
  ],
  "冬": [
    "北风呼啸。宫里的太监们缩着脖子，在廊下跺脚取暖。",
    "一场大雪覆盖了紫禁城。乾清宫的灯火在雪夜中显得格外孤寂。",
    "年关将近。崇祯帝想起小时候过年时宫里张灯结彩的景象，恍如隔世。",
    "冬至。按例皇帝应到天坛祭天。但今年，崇祯帝在祭文中多加了一句——'祈愿天下百姓，不再受饥寒之苦。'",
  ],
};

/**
 * 获取当前季节的风味描述
 */
function getSeasonalFlavor() {
  const state = gameState.getState();
  const season = state.turn.season;
  const flavors = SEASONAL_FLAVOR[season] || SEASONAL_FLAVOR["春"];
  // 基于回合号做伪随机选择（不用 Math.random，确保同回合重试一致）
  const idx = state.turn.number % flavors.length;
  return flavors[idx];
}

// ========== 稀有随机事件 ==========

const RARE_EVENTS = [
  {
    id: "telescope",
    title: "泰西奇物",
    text: "徐光启兴冲冲地进宫，手里捧着一个黄铜筒状物。'陛下！这就是臣说的望远镜。用它看月亮，能看到上面的环形山！'崇祯帝将信将疑地凑过去……",
    weight: 2,
    condition: (s) => s.turn.number > 4 && s.turn.number < 40,
  },
  {
    id: "liuru",
    title: "柳如是求见",
    text: "一个女子求见陛下。她自称钱谦益的妾室，名叫柳如是。'陛下，民女有一言，关乎社稷安危。'她的眼神坚定，不像寻常女子。",
    weight: 1,
    condition: (s) => s.turn.number > 8,
  },
  {
    id: "wen_leak",
    title: "温体仁说漏嘴",
    text: "今日不知怎地，一向说话滴水不漏的温体仁竟然在廷议上脱口而出：'其实阉党那边……'话说到一半，他突然意识到失言，脸色煞白。满朝文武齐刷刷地看向他。",
    weight: 1,
    condition: () => true,
  },
  {
    id: "foreign",
    title: "西洋使节",
    text: "一个金发碧眼的西洋人来到京城，自称是耶稣会传教士，带来了全新的世界地图。'陛下，世界比你们想象的大得多。在这片大陆的西边，还有无数国家。'",
    weight: 1,
    condition: (s) => s.turn.number > 12 && s.turn.number < 50,
  },
  {
    id: "weapon_test",
    title: "火器试射",
    text: "徐光启邀请陛下观看新式火炮试射。一声巨响后，三百步外的城墙靶被炸出一个大洞。'陛下，若将此炮装备边军，何惧建虏骑兵！'在场的武将们面面相觑——他们第一次感受到了火器的威力。",
    weight: 2,
    condition: (s) => s.turn.number > 6 && s.turn.number < 45,
  },
  {
    id: "eunuch_plot",
    title: "东厂密报",
    text: "魏忠贤呈上一份东厂密报，上面列着十几个朝臣的名字。'陛下，这些人……私下议论朝政，散布不满。老奴以为，该查一查了。'名单上第一个名字，赫然是袁崇焕。",
    weight: 1,
    condition: (s) => s.turn.number > 2 && s.turn.number < 30,
  },
  {
    id: "famine_report",
    title: "灾民入京",
    text: "河南来的灾民已经涌到了京城城外。京兆尹急报：城外聚集的灾民已逾三万，每日饿死数十人。要开仓放粮还是要驱赶？这是一个两难的选择。",
    weight: 2,
    condition: (s) => s.economy.popularSupport < 45,
  },
  {
    id: "general_duel",
    title: "武将对峙",
    text: "朝会上，袁崇焕和魏忠贤的支持者发生了激烈的争吵。一名武将甚至拔出了佩剑——在大殿之上！'陛下面前，谁敢放肆！'房壮丽厉声呵斥。殿中鸦雀无声。",
    weight: 1,
    condition: () => true,
  },
];

/**
 * 基于权重和回合号选择随机事件
 * 使用回合号做伪随机，确保同回合重试一致
 */
function getRandomEvent() {
  const state = gameState.getState();
  const eligible = RARE_EVENTS.filter(e => e.condition(state));
  if (eligible.length === 0) return null;

  // 伪随机：基于回合号决定是否触发 (每回合约 8% 概率)
  const roll = (state.turn.number * 13 + 7) % 100;
  if (roll >= 8) return null;

  // 基于回合号选择事件
  const totalWeight = eligible.reduce((s, e) => s + e.weight, 0);
  let pick = state.turn.number % totalWeight;
  for (const event of eligible) {
    pick -= event.weight;
    if (pick < 0) return event;
  }
  return eligible[0];
}

// ========== 皇帝梦 ==========

const EMPEROR_DREAMS = [
  {
    id: "zhu_yuanzhang",
    figure: "太祖高皇帝朱元璋",
    text: "崇祯帝做了一个梦。梦中他跪在太庙前，一个穿着破旧龙袍的老人从阴影中走出。'你是谁？''朕是朱元璋。'老人打量着华丽的宫殿，摇了摇头。'咱当年立国的时候，可不是这个样子。你看看这些绫罗绸缎、这些奇珍异宝——咱当年可是穿着补丁衣裳上朝的。'他凑近了崇祯，一字一顿地说：'江山，是打下来的。不是守出来的。记住了吗？'说完，梦醒了。乾清宫的烛火在黑暗中摇曳。",
    condition: (s) => s.economy.imperialAuthority < 40 && s.turn.number > 20,
  },
  {
    id: "wanli",
    figure: "神宗显皇帝万历",
    text: "崇祯帝梦到了万历皇帝——那个在位四十八年，却有三十年不上朝的祖父。梦中，万历躺在寝宫的软榻上，身边堆满了珍奇异宝。看到崇祯进来，他懒洋洋地说：'你来了？朕听说你很勤政？何必呢。朕三十年不上朝，不也过来了？'崇祯想反驳，却发现自己说不出话。万历笑了笑：'不过你比朕强。朕当年也被言官骂，朕就不理他们。你至少还在批奏章。'梦醒后，崇祯帝在乾清宫坐了整整一夜。",
    condition: (s) => s.economy.corruption > 60 && s.turn.number > 30,
  },
  {
    id: "chongzhen_mirror",
    figure: "镜中的自己",
    text: "崇祯帝梦见自己站在煤山上，望着山下的北京城。城中火光冲天。一个和他一模一样的人站在身边。'你是谁？''我是你。十年后的你。'那人指着山下的火光说：'看到了吗？这就是朕的结局。不，是你的结局——如果你再不做点什么的话。'崇祯惊醒，发现自己趴在奏章上睡着了，桌上还摊着袁崇焕的军报。窗外，天快亮了。",
    condition: (s) => s.turn.number > 40 && s.turn.number < 64,
  },
  {
    id: "mother_dream",
    figure: "母亲",
    text: "崇祯帝梦见了母亲——那个在他五岁时就去世的女人。她的面容如此清晰，仿佛从未离开过。'皇儿，你累了吗？'她轻轻摸着崇祯的头，就像他小时候那样。'累了就歇歇。不要把自己逼得太紧。'崇祯想说话，却发现自己已经是成年人的模样，而母亲还是那么年轻。'母亲……''别怕。不管发生什么，母亲都看着你。'梦醒后，崇祯发现脸上有泪。太监们装作没看见。",
    condition: (s) => s.economy.popularSupport < 30 || s.turn.number > 50,
  },
];

/**
 * 检查是否触发皇帝梦 (极低概率，约 1%)
 */
function checkEmperorDream() {
  const state = gameState.getState();
  // ~1% 每回合概率（原为 (n*97+31)%100===0 的哈希，仅当 n≡77 时命中，
  // 而游戏 65 回合就结束了——永远不会触发。改回真随机。）
  if (Math.random() >= 0.01) return null;

  const eligible = EMPEROR_DREAMS.filter(d => d.condition(state));
  if (eligible.length === 0) return null;

  const idx = state.turn.number % eligible.length;
  return eligible[idx];
}

// ========== 统一彩蛋检查 ==========

/**
 * 为 NPC 对话场景注入彩蛋
 * @returns {string} 彩蛋文本，或空字符串
 */
function injectNpcEasterEgg(npcName, ctx) {
  const char = characterRegistry.get(npcName);
  if (!char) return "";

  const parts = [];

  // 1. 历史名句
  const quote = checkHistoricalQuote(npcName, ctx);
  if (quote) {
    parts.push(`\n[史载名句]\n${npcName}曾言："${quote}"`);
  }

  // 2. 隐藏对话
  const hidden = checkHiddenDialogue(npcName, ctx.relScore);
  if (hidden) {
    parts.push(`\n[肺腑之言]\n${hidden}`);
  }

  return parts.join("\n");
}

/**
 * 为回合报告注入季节风味 + 随机事件 + 梦
 * @returns {string}
 */
function injectReportFlavor() {
  const parts = [];

  // 1. 季节风味
  const flavor = getSeasonalFlavor();
  if (flavor) parts.push(flavor);

  // 2. 随机事件
  const event = getRandomEvent();
  if (event) {
    parts.push(`\n【${event.title}】\n${event.text}`);
  }

  // 3. 皇帝梦
  const dream = checkEmperorDream();
  if (dream) {
    parts.push(`\n【梦境】\n${dream.text}`);
  }

  return parts.join("\n");
}

module.exports = {
  injectNpcEasterEgg,
  injectReportFlavor,
  checkHistoricalQuote,
  checkHiddenDialogue,
  getSeasonalFlavor,
  getRandomEvent,
  checkEmperorDream,
};
