/**
 * 角色独特命运
 *
 * 每个人物有根据真实历史设计的独特命运路径,
 * 不再是通用的"叛变/下狱/升迁"模板。
 * 命运是否触发取决于玩家的选择和世界状态。
 */
const { characterRegistry } = require("../characters/registry");

const UNIQUE_FATES = {
  // ========== 魏忠贤 ==========
  "魏忠贤": {
    historicalFate: "崇祯即位后遭弹劾, 被贬往凤阳守陵, 途中自缢而死。死后被磔尸。",
    paths: [
      {
        id: "wei_exile_suicide",
        name: "贬谪自尽",
        trigger: { condition: "executed", byPlayer: true },
        narrative: `天启七年冬, 崇祯帝下旨将魏忠贤贬往凤阳。魏忠贤自知大势已去, 在途中自缢而死。临死前长叹:"老奴一生所谋, 不过为陛下守住这江山。"死后, 崇祯下令将其磔尸, 悬首示众。阉党随之瓦解。`,
        effects: { imperialAuthority: 10, popularSupport: 8 },
      },
      {
        id: "wei_purged_early",
        name: "提前铲除",
        trigger: { condition: "executed", byPlayer: true, beforeTurn: 3 },
        narrative: `崇祯帝雷厉风行, 即位不久便下令铲除魏忠贤。朝野震动, 百姓欢腾。此举虽震慑了阉党, 但也让朝中人人自危——皇帝如此决绝, 下一个会是谁?`,
        effects: { imperialAuthority: 15, popularSupport: 10 },
      },
      {
        id: "wei_spared",
        name: "留用制衡",
        trigger: { condition: "alive", minTurn: 10, scoreAbove: -30 },
        narrative: `魏忠贤在多次政治风暴中幸存下来。他变得更加谨慎, 但东厂的密探网络仍在为他服务。只要皇帝还需要制衡东林党, 魏忠贤就还有价值。`,
        effects: { imperialAuthority: -5 },
      },
    ],
  },

  // ========== 袁崇焕 ==========
  "袁崇焕": {
    historicalFate: "遭皇太极反间计, 被崇祯帝以通敌罪凌迟处死。临刑作诗: 一生事业总成空, 半世功名在梦中。",
    paths: [
      {
        id: "yuan_framed",
        name: "反间冤死",
        trigger: { condition: "turn", equals: 8, scoreBelow: 20 },
        narrative: `己巳之变后, 皇太极施反间计, 散布袁崇焕通敌的假消息。朝中阉党余孽趁机诬陷。崇祯帝中了离间之计, 下令将袁崇焕凌迟处死。行刑之日, 京城百姓不明真相, 争相购买从他身上割下的肉吞食。临刑前, 袁崇焕仰天长叹:"一生事业总成空, 半世功名在梦中。死后不愁无勇将, 忠魂依旧守辽东。"`,
        effects: { imperialAuthority: -10, popularSupport: -5, militaryMorale: -25, borderTension: 15 },
        irreversible: true,
      },
      {
        id: "yuan_saved",
        name: "帝信忠臣",
        trigger: { condition: "turn", equals: 8, scoreAbove: 40 },
        narrative: `己巳之变后, 反间计的谣言传到宫中。但崇祯帝深知袁崇焕的为人, 不仅没有问罪, 反而当众表示信任。袁崇焕感激涕零, 更加尽心守卫辽东。五年平辽的誓言虽未完全实现, 但他守住了防线, 没有让后金再进一步。`,
        effects: { imperialAuthority: 8, militaryMorale: 15, borderTension: -10 },
      },
      {
        id: "yuan_loyal_to_end",
        name: "战至最后",
        trigger: { condition: "turn", min: 60, status: "alive" },
        narrative: `国难当头, 袁崇焕始终坚守在辽东前线。当北京陷落的消息传来, 他面向南方跪拜, 然后率领残部向清军发起最后一次冲锋。后人评价: 如果崇祯没有杀袁崇焕, 明朝或许不会灭亡。`,
        effects: { popularSupport: 5 },
      },
    ],
  },

  // ========== 孙承宗 ==========
  "孙承宗": {
    historicalFate: "清兵攻陷高阳, 76岁的孙承宗率全家拒守, 城破被俘。拒绝投降, 自缢而死。全家百余口一同殉国。",
    paths: [
      {
        id: "sun_martyr",
        name: "举家殉国",
        trigger: { condition: "world", borderTension: 90, status: "alive" },
        narrative: `清军攻破高阳城。76岁的孙承宗对家人说:"我受国厚恩, 今日以死报之。"遂率全家拒守, 城破被俘。清将劝降, 孙承宗大骂不屈, 自缢而死。他的五个儿子、六个孙子、全家百余口一同殉国。高阳城内, 尸横遍地, 血染街巷。`,
        effects: { popularSupport: 10, imperialAuthority: 5 },
        irreversible: true,
      },
      {
        id: "sun_elder_statesman",
        name: "寿终正寝",
        trigger: { condition: "world", borderTension: 50, status: "alive", minTurn: 50 },
        narrative: `孙承宗年事已高, 在朝中安度晚年。他见证了崇祯帝的勤政, 也目睹了大明的艰难。临终前, 他对崇祯帝说:"老臣一生经历四朝, 从未见过像陛下这样勤勉的君主。可惜, 时也命也。"言毕而逝。`,
        effects: { popularSupport: 3 },
      },
      {
        id: "sun_imperial_tutor",
        name: "帝师辅政",
        trigger: { condition: "alive", minTurn: 5, scoreAbove: 60 },
        narrative: `孙承宗不仅是朝中重臣，更成了崇祯帝最信赖的导师。每当遇到难题，崇祯总是第一个想到孙承宗。在一次私下的谈话中，孙承宗对崇祯说:"陛下，老臣年轻时也以为天下事非黑即白。现在才明白，治理一个国家，最难的不是找到对的答案，而是提出对的问题。"`,
        effects: { imperialAuthority: 8, factionStability: 5 },
      },
    ],
  },

  // ========== 崔呈秀 ==========
  "崔呈秀": {
    historicalFate: "魏忠贤倒台后, 崔呈秀自知难逃, 在家中自缢而死。",
    paths: [
      {
        id: "cui_suicide_after_wei",
        name: "畏罪自尽",
        trigger: { condition: "linkedTo", npc: "魏忠贤", theirStatus: "executed" },
        narrative: `魏忠贤倒台的消息传来, 崔呈秀自知在劫难逃。他关闭府门, 遣散家人, 在书房中自缢而死。留下遗书:"罪臣崔呈秀, 一生依附权阉, 无颜面对陛下。"`,
        effects: { popularSupport: 2 },
        irreversible: true,
      },
      {
        id: "cui_dismissed",
        name: "罢官还乡",
        trigger: { condition: "disgraced", byPlayer: true },
        narrative: `崔呈秀被罢免一切官职, 贬为庶民。他灰溜溜地离开了京城, 从此再无声息。据说后来在乡间开了一家小酒馆, 了此残生。`,
        effects: { imperialAuthority: 3 },
      },
      {
        id: "cui_betrays_wei",
        name: "反水投诚",
        trigger: { condition: "alive", minTurn: 5, scoreAbove: 50 },
        narrative: `崔呈秀惊讶地发现，皇帝对他的态度远好于预期。精于投机的他立刻嗅到了风向的变化。在一个深夜，他秘密求见崇祯，呈上了一份长长的名单——上面记录了魏忠贤及其党羽的罪行和证据。他匍匐在地说:"陛下，臣这些年在阉党中忍辱负重，就是为了今天将这些罪证呈给陛下！"`,
        effects: { imperialAuthority: 8, popularSupport: 5 },
      },
    ],
  },

  // ========== 温体仁 ==========
  "温体仁": {
    historicalFate: "被弹劾罢免, 次年病死家中。他是崇祯朝任职最久的内阁首辅, 长达七年。",
    paths: [
      {
        id: "wen_dismissed_die",
        name: "罢相归乡",
        trigger: { condition: "disgraced", byPlayer: true },
        narrative: `温体仁被弹劾罢免, 黯然离开内阁。这位在崇祯朝任职最久(七年)的首辅, 最终以这种方式结束了他的政治生涯。次年, 他在家乡病逝。临死前对人说:"我这辈子, 不求有功, 但求无过。"`,
        effects: { imperialAuthority: 3 },
      },
      {
        id: "wen_retired",
        name: "平安归老",
        trigger: { condition: "retired" },
        narrative: `温体仁在朝堂风云变幻中始终保持着微妙的平衡。最终, 他选择了急流勇退, 告老还乡。他是崇祯朝少数得以善终的重臣之一。`,
        effects: { factionStability: 3 },
      },
      {
        id: "wen_seven_year_premier",
        name: "七载首辅",
        trigger: { condition: "alive", minTurn: 28, status: "alive" },
        narrative: `温体仁在首辅的位置上已经坐了七年。他目睹了一个又一个同僚倒下, 而自己始终屹立不倒。有人说他无能, 有人说他圆滑。但他自己心里清楚——在这个位置上, 活下来本身就是一种能力。崇祯帝在一次朝会后留下他, 问:"爱卿, 你究竟是怎么做到的?"温体仁想了想, 躬身回答:"陛下, 臣这辈子, 只做了一件事——就是让各方都觉得自己还有希望。"`,
        effects: { imperialAuthority: 4 },
      },
    ],
  },

  // ========== 洪承畴 ==========
  "洪承畴": {
    historicalFate: "松山兵败被俘, 绝食数日后投降清朝, 成为清朝征服中国的重要谋臣。被明朝视为大汉奸, 但在清朝位列三公。",
    paths: [
      {
        id: "hong_captured_surrender",
        name: "松山被俘降清",
        trigger: { condition: "world", borderTension: 85, qingAggression: 70, scoreBelow: -30 },
        narrative: `松山之战, 明军大败。洪承畴被清军俘虏。起初他绝食抗议, 数日不进水米。但皇太极派范文程前去游说, 晓以利害。在得知朝廷已将他列为"阵亡"且家属被问罪后, 洪承畴终于动摇了。他接受了清朝的招降, 剃发易服。后来成为清军南下最重要的谋臣之一。`,
        effects: { imperialAuthority: -15, militaryMorale: -20, popularSupport: -5 },
        irreversible: true,
      },
      {
        id: "hong_rescued",
        name: "朝廷救援",
        trigger: { condition: "world", borderTension: 85, qingAggression: 70, scoreAbove: 30 },
        narrative: `松山危急, 崇祯帝下令全力救援。援军及时赶到, 洪承畴得以突围。经此一役, 洪承畴对皇帝感恩戴德, 从此死心塌地为明朝尽忠。`,
        effects: { imperialAuthority: 5, militaryMorale: 10, borderTension: -5 },
      },
      {
        id: "hong_rebel_crusher",
        name: "剿寇功成",
        trigger: { condition: "alive", minTurn: 15, scoreAbove: 30, status: "alive" },
        narrative: `在洪承畴数年如一日的围剿下，西北流寇终于被压缩到几个山区。虽然未能彻底根除，但已不再对朝廷构成致命威胁。崇祯帝在廷议上公开表彰洪承畴:"若无洪卿，西北已非大明之土。"洪承畴跪谢天恩，但心里清楚——只要饥荒和贫困还在，新的流寇随时会出现。`,
        effects: { imperialAuthority: 7, militaryMorale: 12, rebelMomentum: -20 },
      },
    ],
  },

  // ========== 钱谦益 ==========
  "钱谦益": {
    historicalFate: `清兵南下, 其妾柳如是劝他一同投水殉国。钱谦益试了试水, 说:"水太冷, 不能下。"最终剃发降清。柳如是独自投水, 被救起。`,
    paths: [
      {
        id: "qian_water_too_cold",
        name: "水太冷",
        trigger: { condition: "world", qingAggression: 80, scoreBelow: -10 },
        narrative: `清兵南下, 大势已去。柳如是拉着钱谦益的手说:"夫君, 你我一同投水殉国吧。"钱谦益走到池边, 伸手试了试水温, 迟疑地说:"水太冷, 不能下。"柳如是失望地看着他, 独自投入水中——后被救起。钱谦益最终剃发降清。后世提起钱谦益, 总不忘那句"水太冷"。`,
        effects: { imperialAuthority: -8, popularSupport: -3 },
        irreversible: true,
      },
      {
        id: "qian_dies_with_dignity",
        name: "殉国明志",
        trigger: { condition: "world", qingAggression: 80, scoreAbove: 50 },
        narrative: `清兵南下。这一次, 钱谦益没有退缩。他对柳如是说:"这些年读书养志, 今日正是报国之时。"两人一同投水殉国。消息传开, 江南士林震动。这位曾经摇摆不定的文坛领袖, 最终用生命换来了一世清名。`,
        effects: { popularSupport: 8, imperialAuthority: 5 },
        irreversible: true,
      },
      {
        id: "qian_literary_legacy",
        name: "文坛宗主",
        trigger: { condition: "alive", minTurn: 20, scoreAbove: 40, status: "alive" },
        narrative: `钱谦益主持编修的大型文集终于完成。这部汇集了明初以来诗文精华的巨著，被士林誉为"一代之盛事"。江南的读书人纷纷抄录传阅，钱谦益的文坛地位如日中天。他对弟子们说:"文章者，经国之大业，不朽之盛事。吾辈以文报国，不负此生。"`,
        effects: { popularSupport: 5, imperialAuthority: 3 },
      },
    ],
  },

  // ========== 徐光启 ==========
  "徐光启": {
    historicalFate: "在崇祯六年(1633年)病逝于任上, 享年71岁。他主持修订的《崇祯历书》成为后世历法的基础。",
    paths: [
      {
        id: "xu_legacy",
        name: "科学遗产",
        trigger: { condition: "turn", min: 30, status: "alive" },
        narrative: `徐光启的晚年致力于推广甘薯种植和修订历法。他引进的西方科学知识, 在不知不觉中改变着这个古老帝国。崇祯帝在一次朝会上感叹:"满朝文武, 只有徐光启是真正在为百姓做实事。"`,
        effects: { popularSupport: 3, famineIndex: -5 },
      },
      {
        id: "xu_peaceful_death",
        name: "鞠躬尽瘁",
        trigger: { condition: "turn", min: 32, status: "alive" },
        narrative: `徐光启病倒了。多年的辛劳耗尽了他的精力。临终前, 他还在修改《农政全书》的手稿。他对弟子说:"我做了一辈子学问, 最遗憾的, 是没能看到陛下用这些学问拯救天下苍生。"他留下的天文历法、农业著作和军事技术, 成为后世宝贵遗产。`,
        effects: { popularSupport: 3 },
        irreversible: true,
      },
      {
        id: "xu_cannon_master",
        name: "火器革新",
        trigger: { condition: "alive", minTurn: 6, scoreAbove: 35, status: "alive" },
        narrative: `在徐光启的主持下，澳门葡萄牙人的新式火炮技术被成功引进。第一批仿制的红衣大炮在辽东前线投入使用，效果惊人——一炮轰塌了后金的攻城器械。袁崇焕从前线发来捷报:"徐公之炮，胜过雄兵十万！"徐光启在朝堂上听到奏报，热泪盈眶。`,
        effects: { militaryMorale: 12, borderTension: -8 },
      },
    ],
  },

  // ========== 房壮丽 ==========
  "房壮丽": {
    historicalFate: "清兵破安州城, 76岁的房壮丽投井而死。崇祯闻讯, 追赠太保。",
    paths: [
      {
        id: "fang_well_death",
        name: "投井死节",
        trigger: { condition: "world", borderTension: 85, status: "alive" },
        narrative: `清兵攻破安州城。76岁的房壮丽整理好官服, 对家人说:"我一生清正, 今日当以死报国。"言毕, 从容投井而死。崇祯帝闻讯, 泪流满面, 追赠太保, 谥号"忠烈"。朝中大臣无不动容——当年阉党当道时他尚且不低头, 如今国难当头, 他宁死不屈。`,
        effects: { popularSupport: 8, imperialAuthority: 6 },
        irreversible: true,
      },
      {
        id: "fang_survives",
        name: "幸存守节",
        trigger: { condition: "turn", min: 50, status: "alive" },
        narrative: `房壮丽在乱世中艰难地活了下来。年事已高的他无法再冲锋陷阵, 但他的存在本身就是一面旗帜——提醒着所有人, 什么叫气节。崇祯帝常常对人说:"房壮丽在, 朕心里就踏实。"`,
        effects: { imperialAuthority: 3 },
      },
      {
        id: "fang_clean_house",
        name: "整肃吏治",
        trigger: { condition: "alive", minTurn: 8, scoreAbove: 45, status: "alive" },
        narrative: `在房壮丽雷厉风行的整顿下，朝中风气为之一新。几十名贪腐官员被革职查办，数百桩冤案得到平反。百姓在街头巷尾议论:"房青天来了！"崇祯帝感叹——若满朝文武都像房壮丽，何愁大明不兴？`,
        effects: { imperialAuthority: 10, popularSupport: 6, corruption: -8 },
      },
    ],
  },
};

module.exports = { UNIQUE_FATES };
