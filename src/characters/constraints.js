/**
 * 角色关系约束配置
 *
 * 每个 NPC 的关系边界由历史性格决定:
 * - 死忠 (diehard): 绝不叛变, 关系可达到+100
 * - 忠诚 (loyal): 不会叛变, 但可能因直言得罪皇帝
 * - 职业军人 (professional): 正常君臣关系, 极端情况下可能投降
 * - 自保 (self_preservation): 明哲保身, 危难时可能叛变
 * - 奸佞 (treacherous): 永远以自己的利益为先, 表面可以伪装忠诚
 */
const CONSTRAINTS = {
  "魏忠贤": {
    relMin: -100, relMax: 30,
    loyalty: "treacherous", canBetray: true,
    selfPerception: "老奴对陛下一片忠心。老奴所做的一切，都是为了陛下。",
    note: "天生奸臣。可以装出恭敬的样子（最高到+30），但绝不会真心为皇帝着想。关系降到-60以下时，会暗中使绊。降到底会主动谋害皇帝。",
  },
  "崔呈秀": {
    relMin: -100, relMax: 20,
    loyalty: "treacherous", canBetray: true,
    selfPerception: "下官对陛下忠心耿耿，天地可鉴。",
    note: "魏忠贤的附庸。没有自己的原则立场，谁得势就跟谁。可以伪装忠诚但上限极低（+20）。",
  },
  "袁崇焕": {
    relMin: -30, relMax: 95,
    loyalty: "loyal", canBetray: false,
    selfPerception: "臣一心报国，绝不辜负陛下信任。五年平辽，臣说到做到。",
    note: "赤胆忠心的将领。绝不会叛变——历史上被诬陷通敌是冤案。但性格刚直，可能因直言触怒皇帝（最低-30）。忠诚上限极高（+95），平辽成功后可达顶峰。",
  },
  "孙承宗": {
    relMin: -15, relMax: 100,
    loyalty: "diehard", canBetray: false,
    selfPerception: "老夫受国厚恩，唯有鞠躬尽瘁，死而后已。",
    note: "四朝老臣，德高望重。永远不会背叛。关系下降的唯一原因是皇帝不采纳他的建议。上限可达+100——真正死忠。",
  },
  "温体仁": {
    relMin: -70, relMax: 50,
    loyalty: "self_preservation", canBetray: true,
    selfPerception: "臣凡事只求稳妥，不偏不倚。陛下圣明，自有决断。",
    note: "精致的利己主义者。没有强烈的忠诚或背叛倾向，一切以自保为准。关系上限只有+50——他永远不会真正为你赴汤蹈火。危难时可能叛变。",
  },
  "洪承畴": {
    relMin: -80, relMax: 75,
    loyalty: "professional", canBetray: true,
    selfPerception: "臣以军人的职责行事。局势如此，只能尽力而为。",
    note: "职业军人，忠于职守但非愚忠。历史上确实投降了清朝。被围困、弹尽粮绝、朝廷不救时可能投降。忠诚上限+75，但投降门槛也低。",
  },
  "钱谦益": {
    relMin: -60, relMax: 65,
    loyalty: "self_preservation", canBetray: true,
    selfPerception: "臣以文人的风骨自持。天下兴亡，匹夫有责。",
    note: "文坛领袖，但性格软弱。历史上投降清朝后又想反正——两头不讨好。说自己有风骨，但关键时刻容易动摇。日常关系上限+65，危难时可能叛变。",
  },
  "徐光启": {
    relMin: -20, relMax: 85,
    loyalty: "loyal", canBetray: false,
    selfPerception: "臣以科学和事实为本。不涉党争，只为国家办实事。",
    note: "科学家学者，不参与党争。不会叛变——他的忠诚来自对国家和学问的热爱而非政治。关系不会降到很低（最低-20）。上限+85，但不是谄媚的忠诚。",
  },
  "房壮丽": {
    relMin: -5, relMax: 100,
    loyalty: "diehard", canBetray: false,
    selfPerception: "臣宁死不屈。奸佞当道时臣尚且不低头，何况如今陛下圣明。",
    note: "死不低头的清官。天启年间阉党当道时他闭门不出也不依附，做了四年冷板凳。崇祯即位后重用。关系几乎不会降（最低-5），上限+100。绝不可能叛变——历史上清兵破城时投井死节。",
  },
};

module.exports = { CONSTRAINTS };
