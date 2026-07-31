/**
 * 党派竞争与政令执行引擎
 *
 * 核心机制:
 *   1. 政令由党派执行 — 高影响力党派执行效果更好
 *   2. 执行政令 → 党派影响力上升 → 皇帝话语权下降
 *   3. 玩家需要在效率与控制之间做权衡
 *
 * 三派:
 *   东林党: 擅长反腐/赈灾/减税/水利/科举
 *   阉党:   擅长加税/情报/赏赐/戒严
 *   武将:   擅长募兵/调兵/筑城/镇压
 */
const { gameState } = require("../state/game-state");

// 党派定义
const FACTIONS = {
  donglin: {
    name: "东林党",
    strengths: ["antiCorruption", "relief", "taxDecrease", "irrigation", "roadMaintenance", "appeaseRefugees"],
    weaknesses: ["taxIncrease", "reward", "martialLaw"],
    description: "儒家学者集团, 以清廉和民生为本",
  },
  eunuch: {
    name: "阉党",
    strengths: ["taxIncrease", "reward", "martialLaw", "currency"],
    weaknesses: ["antiCorruption", "taxDecrease", "irrigation"],
    description: "以内廷宦官为核心的权力集团, 善于征税和情报收集",
  },
  militaryGroup: {
    name: "武将集团",
    strengths: ["recruit", "deployTroops", "fortify", "peaceTalks"],
    weaknesses: ["taxDecrease", "antiCorruption", "relief"],
    description: "军队将领组成的势力, 专注于边防和军事",
  },
};

// 党派初始状态
const DEFAULT_FACTION_STATE = {
  donglin:       { power: 45, influence: 40, loyalty: 60, lastAction: null },
  eunuch:        { power: 35, influence: 45, loyalty: 30, lastAction: null },
  militaryGroup: { power: 20, influence: 25, loyalty: 50, lastAction: null },
};

class FactionEngine {
  constructor() {
    this.factions = JSON.parse(JSON.stringify(DEFAULT_FACTION_STATE));
    this.actionLog = [];
  }

  getState() { return this.factions; }

  get(factionKey) { return this.factions[factionKey]; }

  /**
   * 为核心决策选择执行党派
   * 优先从诏书文本中解析玩家指定, 否则按匹配度自动分配
   */
  assignFaction(decisionType, edictText) {
    // 1. 玩家明确指定?
    const specified = this._parseFactionPreference(edictText);
    if (specified && this.factions[specified]) {
      return specified;
    }

    // 2. 自动匹配: 选择该决策类型匹配度最高的党派
    let bestFaction = null;
    let bestScore = -Infinity;

    for (const [key, faction] of Object.entries(FACTIONS)) {
      let score = 0;
      if (faction.strengths.includes(decisionType)) score += 10;
      if (faction.weaknesses.includes(decisionType)) score -= 10;
      // 势力越大的党派越倾向于抢政令
      score += this.factions[key].power / 20;
      if (score > bestScore) {
        bestScore = score;
        bestFaction = key;
      }
    }

    return bestFaction || "donglin";
  }

  /**
   * 计算执行效果修正
   * @returns { multiplier, description }
   */
  calculateExecutionBonus(decisionType, factionKey) {
    const faction = this.factions[factionKey];
    const factionDef = FACTIONS[factionKey];
    if (!faction || !factionDef) return { multiplier: 1.0, desc: "" };

    const power = faction.power;

    if (factionDef.strengths.includes(decisionType)) {
      // 擅长: 势力越高加成越大
      const bonus = 1 + (power / 200); // 最大+50%
      return {
        multiplier: bonus,
        desc: `${factionDef.name}擅长此类政务, 执行效率提升 ${Math.round((bonus - 1) * 100)}%`,
      };
    }

    if (factionDef.weaknesses.includes(decisionType)) {
      // 不擅长: 势力越大反而阻碍越多
      const penalty = 1 - (power / 300); // 最大-33%
      return {
        multiplier: Math.max(0.67, penalty),
        desc: `${factionDef.name}不善于此类政务, 执行效果打了折扣`,
      };
    }

    // 中性
    return { multiplier: 1.0, desc: `${factionDef.name}执行此类政务效果一般` };
  }

  /**
   * 执行后的党派影响变化
   */
  applyExecutionEffects(factionKey, decisionType, executionMultiplier) {
    const faction = this.factions[factionKey];
    if (!faction) return [];

    const changes = [];

    // 党派影响力上升
    const powerGain = 2 + Math.round(Math.random() * 2); // 2-4 per edict
    faction.power = Math.min(100, faction.power + powerGain);
    faction.influence = Math.min(100, faction.influence + 1);
    faction.lastAction = decisionType;
    changes.push(`${FACTIONS[factionKey].name}影响力 +${powerGain} (当前: ${faction.power})`);

    // 皇帝话语权下降
    const state = gameState.getState();
    const authorityLoss = 1 + (faction.power > 60 ? 1 : 0) + (faction.power > 80 ? 1 : 0);
    state.economy.imperialAuthority = Math.max(0, state.economy.imperialAuthority - authorityLoss);
    changes.push(`皇帝权威 -${authorityLoss} (当前: ${state.economy.imperialAuthority.toFixed(1)})`);

    // 其他党派反应
    for (const [key, other] of Object.entries(this.factions)) {
      if (key === factionKey) continue;
      // 其他党派相对势力微降
      const rivalLoss = Math.round(powerGain / 3);
      other.power = Math.max(5, other.power - rivalLoss);
    }

    // 党派过强警告
    if (faction.power > 80 && !faction._warnedDominance) {
      faction._warnedDominance = true;
      changes.push(`[WARNING] ${FACTIONS[factionKey].name}势力已超80, 开始对政令阳奉阴违。`);
    }
    if (faction.power > 90) {
      changes.push(`[CRITICAL] ${FACTIONS[factionKey].name}权倾朝野, 皇帝已难以有效控制。`);
    }

    this.actionLog.push({
      faction: factionKey, decision: decisionType, powerGain, authorityLoss,
      turn: gameState.getTurn().number,
    });

    return changes;
  }

  /**
   * 当党派权力过高时, 对其不擅长的政令产生抗拒
   * @returns {boolean} 是否被拒绝
   */
  checkRefusal(factionKey, decisionType) {
    const faction = this.factions[factionKey];
    const factionDef = FACTIONS[factionKey];
    if (!faction) return false;

    // 权力>85 的党派会拒绝其弱项政令
    if (faction.power > 85 && factionDef.weaknesses.includes(decisionType)) {
      return Math.random() < (faction.power - 85) / 20; // 最多75%概率拒绝
    }
    return false;
  }

  /**
   * 玩家主动打压派系
   */
  suppressFaction(factionKey, amount = 10) {
    const faction = this.factions[factionKey];
    if (!faction) return null;
    faction.power = Math.max(5, faction.power - amount);
    faction._warnedDominance = false;
    const state = gameState.getState();
    state.economy.imperialAuthority = Math.min(100, state.economy.imperialAuthority + 5);
    return `${FACTIONS[factionKey].name}势力 -${amount} (当前: ${faction.power}), 皇帝权威 +5`;
  }

  /** 从诏书文本中解析党派偏好 */
  _parseFactionPreference(text) {
    if (!text) return null;
    if (text.includes("东林") || text.includes("东林党")) return "donglin";
    if (text.includes("阉党") || text.includes("内廷") || text.includes("司礼监") || text.includes("厂卫")) return "eunuch";
    if (text.includes("武将") || text.includes("兵部") || text.includes("五军都督府") || text.includes("军中")) return "militaryGroup";
    return null;
  }

  /** 获取党派对比报告 */
  getReport() {
    const state = gameState.getState();
    return {
      factions: Object.entries(this.factions).map(([key, f]) => ({
        key,
        name: FACTIONS[key].name,
        power: f.power,
        influence: f.influence,
        loyalty: f.loyalty,
        strengths: FACTIONS[key].strengths,
        weaknesses: FACTIONS[key].weaknesses,
        isDominant: f.power > 80,
        dominanceWarning: f.power > 85 ? `${FACTIONS[key].name}权势过重, 已威胁皇权` : null,
      })),
      imperialAuthority: state.economy.imperialAuthority,
      recommendation: this._generateRecommendation(),
    };
  }

  _generateRecommendation() {
    const maxPower = Math.max(...Object.values(this.factions).map((f) => f.power));
    const dominantFaction = Object.entries(this.factions).find(([, f]) => f.power === maxPower);

    if (maxPower > 85) {
      const other = Object.entries(FACTIONS)
        .filter(([k]) => k !== dominantFaction[0])
        .map(([, f]) => f.name)
        .join("和");
      return `[URGENT] ${dominantFaction[1] ? FACTIONS[dominantFaction[0]].name : '某派'}已权倾朝野。建议将政令分配给${other}以制衡。或在诏书中直接下令打压。`;
    }
    if (maxPower > 60) {
      return `${dominantFaction[1] ? FACTIONS[dominantFaction[0]].name : '某派'}势力渐长。建议适当扶持其他党派以维持平衡。`;
    }
    return "朝堂各派势力均衡。可视需要任用最擅长该政务的党派。";
  }

  reset() {
    this.factions = JSON.parse(JSON.stringify(DEFAULT_FACTION_STATE));
    this.actionLog = [];
  }

  toSnapshot() {
    return {
      factions: JSON.parse(JSON.stringify(this.factions)),
      actionLog: this.actionLog.slice(-50),
    };
  }

  static fromSnapshot(data) {
    const engine = new FactionEngine();
    if (data && data.factions) {
      engine.factions = JSON.parse(JSON.stringify(data.factions));
    }
    if (data && data.actionLog) {
      engine.actionLog = data.actionLog;
    }
    return engine;
  }
}

module.exports = { FactionEngine, FACTIONS };
