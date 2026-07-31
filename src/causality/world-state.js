/**
 * 动态世界状态与因果事件引擎
 *
 * 替代固定的"回合N触发事件X"模式, 改为:
 *   玩家行动 → 改变世界变量 → 满足条件 → 触发事件
 *
 * 世界变量:
 *   borderTension   边境紧张度 (0-100): >70触发边境危机, >90触发入侵
 *   famineIndex     饥荒指数 (0-100):   >50减产, >80大规模饥荒
 *   plagueLevel     瘟疫等级 (0-100):   >60局部疫情, >85大瘟疫
 *   factionStability 朝堂稳定 (-100~100): <0党争加剧, <-50政变风险
 *   rebelMomentum   农民军势头 (0-100):  >40流寇活跃, >70攻城略地
 *   qingAggression  清军侵略性 (0-100):  >60主动进攻, >90大举南下
 */
const { gameState } = require("../state/game-state");

class WorldState {
  constructor() {
    this.vars = {
      borderTension: 50,
      famineIndex: 25,
      plagueLevel: 15,
      factionStability: -10,
      rebelMomentum: 20,
      qingAggression: 45,
    };
    this.eventHistory = [];
    this.foreshadowing = [];       // 预兆列表
    this.eventChains = new Map();  // 事件链状态 (eventId → { triggered: bool, nextEvents: [...] })
    this.difficultyLevel = "normal"; // easy/normal/hard
  }

  /** 获取世界状态快照 */
  getState() {
    return { ...this.vars };
  }

  /** 修改世界变量 */
  modify(varName, delta) {
    if (this.vars[varName] !== undefined) {
      if (varName === "factionStability") {
        this.vars[varName] = Math.max(-100, Math.min(100, this.vars[varName] + delta));
      } else {
        this.vars[varName] = Math.max(0, Math.min(100, this.vars[varName] + delta));
      }
    }
  }

  /** 设置难度 */
  setDifficulty(level) {
    this.difficultyLevel = level;
  }

  /** 获取当前难度系数 */
  _getDifficultyMultiplier() {
    const turn = gameState.getTurn().number;

    // 基础难度系数
    const baseMultipliers = { easy: 0.7, normal: 1.0, hard: 1.4 };
    const base = baseMultipliers[this.difficultyLevel] || 1.0;

    // 回合缩放：后期更困难
    let phaseMultiplier;
    if (turn <= 12)       phaseMultiplier = 0.6;  // 前期 3 年：新手保护
    else if (turn <= 36)  phaseMultiplier = 1.0;  // 中期 4-9 年
    else if (turn <= 52)  phaseMultiplier = 1.4;  // 后期 10-13 年
    else                  phaseMultiplier = 1.8;  // 末期 14 年+

    return base * phaseMultiplier;
  }

  /** 每回合自动演进 (自然趋势) */
  tick() {
    const mult = this._getDifficultyMultiplier();
    const turn = gameState.getTurn().number;

    // 明末自然趋势: 一切都在恶化，速度随难度和回合数递增
    this.vars.borderTension += (0.5 + Math.random() * 1.0) * mult;
    this.vars.famineIndex += (0.2 + Math.random() * 0.5) * mult;
    this.vars.plagueLevel += (0.3 + Math.random() * 0.3) * mult;
    this.vars.factionStability -= (0.3 + Math.random() * 0.5) * mult;
    this.vars.rebelMomentum += (0.4 + Math.random() * 0.8) * mult;
    this.vars.qingAggression += (0.4 + Math.random() * 0.6) * mult;

    // 限制范围
    for (const key of Object.keys(this.vars)) {
      this.vars[key] = key === "factionStability"
        ? Math.max(-100, Math.min(100, this.vars[key]))
        : Math.max(0, Math.min(100, this.vars[key]));
    }

    // 更新预兆
    this._updateForeshadowing();
  }

  /** 更新预兆系统 */
  _updateForeshadowing() {
    this.foreshadowing = [];
    const v = this.vars;

    if (v.borderTension > 65 && v.borderTension < 85) {
      this.foreshadowing.push({
        var: "borderTension",
        level: v.borderTension > 78 ? "critical" : "warning",
        text: v.borderTension > 78
          ? "辽东急报频传，清军在边境集结兵力，大战一触即发。"
          : "边境烽火日频，兵部奏报辽东方向清军活动频繁。",
      });
    }
    if (v.famineIndex > 50 && v.famineIndex < 70) {
      this.foreshadowing.push({
        var: "famineIndex",
        level: "warning",
        text: "多地报粮价飞涨，百姓食不果腹。若不及时赈济，恐生大乱。",
      });
    }
    if (v.plagueLevel > 50 && v.plagueLevel < 75) {
      this.foreshadowing.push({
        var: "plagueLevel",
        level: "warning",
        text: "北方诸县有疫病蔓延之象，太医院奏请加强防疫。",
      });
    }
    if (v.factionStability < -35 && v.factionStability > -70) {
      this.foreshadowing.push({
        var: "factionStability",
        level: v.factionStability < -55 ? "critical" : "warning",
        text: "朝中党争日趋激烈，大臣们各怀鬼胎。陛下需早做防范。",
      });
    }
    if (v.rebelMomentum > 50 && v.rebelMomentum < 70) {
      this.foreshadowing.push({
        var: "rebelMomentum",
        level: "warning",
        text: "流寇四处劫掠，地方告急文书如雪片般飞来。",
      });
    }
    if (v.qingAggression > 55 && v.qingAggression < 70) {
      this.foreshadowing.push({
        var: "qingAggression",
        level: "warning",
        text: "探子回报，清廷正在加紧练兵备战，其志不在小。",
      });
    }
  }

  /** 获取当前预兆文本 */
  getForeshadowingText() {
    if (this.foreshadowing.length === 0) return "";
    const criticals = this.foreshadowing.filter(f => f.level === "critical");
    const warnings = this.foreshadowing.filter(f => f.level === "warning");

    const lines = ["[军机处预警]"];
    for (const f of criticals) lines.push(`  🔴 ${f.text}`);
    for (const f of warnings) lines.push(`  ⚠ ${f.text}`);
    return lines.join("\n");
  }

  /** 从诏书决策修正世界变量 */
  applyEdictEffects(decisions) {
    const changes = [];
    for (const d of decisions) {
      switch (d.type) {
        case "recruit":
        case "deployTroops":
          this.modify("borderTension", -3);
          this.modify("rebelMomentum", -5);
          changes.push("军事行动缓解了边境和叛乱压力");
          break;
        case "relief":
        case "appeaseRefugees":
          this.modify("famineIndex", -5);
          this.modify("rebelMomentum", -3);
          changes.push("赈灾安抚缓解了饥荒和民变压力");
          break;
        case "taxIncrease":
          this.modify("famineIndex", 3);
          this.modify("rebelMomentum", 4);
          changes.push("加税加重了百姓负担");
          break;
        case "taxDecrease":
          this.modify("famineIndex", -2);
          this.modify("rebelMomentum", -2);
          changes.push("减税减轻了百姓负担");
          break;
        case "peaceTalks":
          this.modify("borderTension", -10);
          this.modify("qingAggression", -5);
          changes.push("议和暂时缓解了边境局势");
          break;
        case "antiCorruption":
          this.modify("factionStability", -3);
          changes.push("反腐引发朝堂震动");
          break;
        case "fortify":
          this.modify("borderTension", -2);
          changes.push("加固城防增强了防御");
          break;
      }
    }
    return changes;
  }

  /** 检查是否触发事件 (返回触发的事件列表) */
  checkEvents() {
    const events = [];
    const v = this.vars;
    const turn = gameState.getTurn().number;
    const mult = this._getDifficultyMultiplier();

    // 难度影响阈值：越难越容易触发坏事
    const thresholdMod = (mult - 1.0) * -8; // 高难度降低阈值最多 ~6.4点

    // 事件链修正：已触发的事件会降低后续事件阈值
    const chainMod = this._getChainModifiers();

    // 清军入侵: borderTension极高 + qingAggression高
    // 事件链: 朝堂危机(+5 borderTension), 农民军势大(+3 qingAggression)
    const invasionThreshold = 85 + thresholdMod - (chainMod.qing_invasion || 0);
    if (v.borderTension > invasionThreshold && v.qingAggression > (70 + thresholdMod)) {
      events.push({
        id: "qing_invasion",
        name: "清军大举入侵",
        desc: "皇太极见明朝边防废弛，大举兴兵南下。京师震动，天下惊惶。",
        triggers: { borderTension: v.borderTension, qingAggression: v.qingAggression },
        effects: { imperialAuthority: -10, popularSupport: -5, treasury: -200000 },
        severity: "critical",
        chains: ["famine", "rebel_rising"], // 入侵后更容易发生饥荒和叛乱
      });
      this.modify("borderTension", -15);
      this._recordChain("qing_invasion");
    }

    // 大规模饥荒
    const famineThreshold = 70 + thresholdMod - (chainMod.famine || 0);
    if (v.famineIndex > famineThreshold) {
      events.push({
        id: "famine",
        name: "大规模饥荒",
        desc: "连年干旱和蝗灾导致粮食绝收。饥民遍地，易子而食的惨状屡见不鲜。",
        triggers: { famineIndex: v.famineIndex },
        effects: { popularSupport: -10, treasury: -100000, rebelMomentum: 10 },
        severity: "major",
        chains: ["rebel_rising", "plague"], // 饥荒→叛乱+瘟疫
      });
      this.modify("famineIndex", -10);
      this._recordChain("famine");
    }

    // 大瘟疫
    const plagueThreshold = 75 + thresholdMod - (chainMod.plague || 0);
    if (v.plagueLevel > plagueThreshold) {
      events.push({
        id: "plague",
        name: "鼠疫大爆发",
        desc: "鼠疫席卷华北，京城亦难幸免。死人枕藉，十室九空。军队减员严重，朝政几近瘫痪。",
        triggers: { plagueLevel: v.plagueLevel },
        effects: { popularSupport: -12, treasury: -150000 },
        severity: "critical",
        chains: ["famine", "rebel_rising"],
      });
      this.modify("plagueLevel", -15);
      this._recordChain("plague");
    }

    // 朝堂政变风险
    const coupThreshold = -70 + (mult - 1.0) * 5;
    if (v.factionStability < coupThreshold) {
      events.push({
        id: "coup_risk",
        name: "朝堂危机",
        desc: "派系斗争白热化。有大臣暗中串联，图谋不轨。朝政几乎无法正常运转。",
        triggers: { factionStability: v.factionStability },
        effects: { imperialAuthority: -8 },
        severity: "major",
        chains: ["qing_invasion", "rebel_rising"], // 内斗→外患
      });
      this.modify("factionStability", 10);
      this._recordChain("coup_risk");
    }

    // 农民军壮大
    const rebelThreshold = 70 + thresholdMod - (chainMod.rebel_rising || 0);
    if (v.rebelMomentum > rebelThreshold) {
      events.push({
        id: "rebel_rising",
        name: "农民军势大",
        desc: "李自成、张献忠等农民军攻州掠县，势如破竹。多省告急，朝廷剿不胜剿。",
        triggers: { rebelMomentum: v.rebelMomentum },
        effects: { popularSupport: -8, treasury: -250000, imperialAuthority: -5 },
        severity: "critical",
        chains: ["famine", "coup_risk"],
      });
      this.modify("rebelMomentum", -10);
      this._recordChain("rebel_rising");
    }

    // 同时处理固定的历史事件覆盖
    if (turn === 65) {
      events.push({
        id: "ming_fall",
        name: "李自成攻陷北京",
        desc: "大势已去。李自成攻破北京城。崇祯帝自缢煤山。大明覆亡。",
        triggers: {},
        effects: {},
        isEnding: true,
        severity: "fatal",
      });
    }

    this.eventHistory.push(...events);
    return events;
  }

  /** 记录事件链触发 */
  _recordChain(eventId) {
    this.eventChains.set(eventId, { triggered: true, turn: gameState.getTurn().number });
  }

  /** 获取事件链修正值 (已触发的连锁事件降低相关事件阈值) */
  _getChainModifiers() {
    const mods = {};
    for (const [id, chain] of this.eventChains) {
      if (!chain.triggered) continue;
      // 仅在触发后 3 回合内有效
      const age = gameState.getTurn().number - chain.turn;
      if (age > 3) continue;

      switch (id) {
        case "qing_invasion":
          mods.famine = (mods.famine || 0) + 8;
          mods.rebel_rising = (mods.rebel_rising || 0) + 3;
          break;
        case "famine":
          mods.rebel_rising = (mods.rebel_rising || 0) + 10;
          mods.plague = (mods.plague || 0) + 5;
          break;
        case "plague":
          mods.famine = (mods.famine || 0) + 3;
          mods.rebel_rising = (mods.rebel_rising || 0) + 5;
          break;
        case "coup_risk":
          mods.qing_invasion = (mods.qing_invasion || 0) + 5;
          mods.rebel_rising = (mods.rebel_rising || 0) + 3;
          break;
        case "rebel_rising":
          mods.famine = (mods.famine || 0) + 5;
          mods.coup_risk = (mods.coup_risk || 0) + 2;
          break;
      }
    }
    return mods;
  }

  /** 重置 */
  reset() {
    this.vars = {
      borderTension: 50, famineIndex: 25, plagueLevel: 15,
      factionStability: -10, rebelMomentum: 20, qingAggression: 45,
    };
    this.eventHistory = [];
    this.foreshadowing = [];
    this.eventChains = new Map();
    this.difficultyLevel = "normal";
  }

  /** 序列化 */
  toSnapshot() {
    return {
      vars: { ...this.vars },
      eventHistory: this.eventHistory.slice(-50),
      eventChains: Array.from(this.eventChains.entries()),
      difficultyLevel: this.difficultyLevel,
    };
  }

  /** 反序列化 */
  static fromSnapshot(data) {
    const ws = new WorldState();
    if (data && data.vars) {
      Object.assign(ws.vars, data.vars);
    }
    if (data && data.eventHistory) {
      ws.eventHistory = data.eventHistory;
    }
    if (data && data.eventChains) {
      ws.eventChains = new Map(data.eventChains);
    }
    if (data && data.difficultyLevel) {
      ws.difficultyLevel = data.difficultyLevel;
    }
    // 恢复后立即重算预警——读档时 foreshadowing 为空，
    // 要到下次 tick() 才填充，导致读档后立即查询预警为空白
    ws._recalcForeshadowing();
    return ws;
  }

  /** 根据当前世界状态重新计算预警文本 */
  _recalcForeshadowing() {
    this.foreshadowing = [];
    const v = this.vars;
    if (v.borderTension > 80) this.foreshadowing.push("边境危局：清军随时可能大举南侵。");
    if (v.famineIndex > 65) this.foreshadowing.push("饥荒蔓延：北方诸省粮食短缺，饿殍遍野。");
    if (v.plagueLevel > 70) this.foreshadowing.push("疫病扩散：瘟疫正在全国多地爆发，人口锐减。");
    if (v.factionStability < -65) this.foreshadowing.push("朝堂崩溃：党派斗争已到了撕裂朝廷的地步。");
    if (v.rebelMomentum > 65) this.foreshadowing.push("流寇四起：农民军已成燎原之势，诸城告急。");
    if (v.qingAggression > 70) this.foreshadowing.push("清军进逼：后金正集结重兵，大战一触即发。");
  }
}

module.exports = { WorldState };
