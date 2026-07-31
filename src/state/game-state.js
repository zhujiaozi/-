/**
 * 游戏状态机
 *
 * 维护游戏世界的实时状态。状态可以从以下来源更新:
 * 1. 游戏请求中的上下文信息 (从 messages 中解析)
 * 2. MCP 工具执行后的效果应用
 * 3. 回合推进后的自动衰减
 */
const config = require("../config");

/** 解析中文年份数字（支持 一~十、十一~九十九、阿拉伯数字） */
function parseChineseYear(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === "十") return 10;
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? digits[m[1]] : 1) * 10 + (m[2] ? digits[m[2]] : 0);
  return digits[s] || null;
}

class GameState {
  constructor() {
    this.reset();
  }

  /** 获取完整状态 */
  getState() {
    return this.state;
  }

  /** 获取经济指标 */
  getEconomy() {
    return this.state.economy;
  }

  /** 获取军事信息 */
  getMilitary() {
    return this.state.military;
  }

  /** 获取回合信息 */
  getTurn() {
    return this.state.turn;
  }

  /** 获取派系 */
  getFactions() {
    return this.state.factions;
  }

  /** 获取单个省份 */
  getProvince(codeName) {
    return this.state.provinces[codeName] || null;
  }

  /** 获取所有省份 */
  getAllProvinces() {
    return this.state.provinces;
  }

  /** 修改经济指标 (delta) */
  modifyEconomy(deltas) {
    const e = this.state.economy;
    for (const [key, delta] of Object.entries(deltas)) {
      if (key === "treasury" || key === "privyPurse") {
        e[key] = Math.max(0, (e[key] || 0) + delta);
      } else if (Number.isFinite(e[key])) {
        e[key] = Math.max(0, Math.min(100, (e[key] || 0) + delta));
      }
    }
    return this.state.economy;
  }

  /** 修改军事指标 */
  modifyMilitary(deltas) {
    const m = this.state.military;
    for (const [key, delta] of Object.entries(deltas)) {
      if (key === "totalTroops") {
        m[key] = Math.max(0, (m[key] || 0) + delta);
      } else if (Number.isFinite(m[key]) && typeof m[key] === "number") {
        m[key] = Math.max(0, Math.min(100, (m[key] || 0) + delta));
      } else if (key === "borderStatus") {
        m[key] = delta;
      }
    }
    return this.state.military;
  }

  /** 修改派系 */
  modifyFaction(factionKey, deltas) {
    const f = this.state.factions[factionKey];
    if (!f) return null;
    for (const [key, delta] of Object.entries(deltas)) {
      if (key === "attitude") {
        f[key] = delta;
      } else if (Number.isFinite(f[key])) {
        f[key] = Math.max(0, Math.min(100, (f[key] || 0) + delta));
      }
    }
    return f;
  }

  /** 推进回合 (春夏秋冬四季循环) */
  advanceTurn() {
    const t = this.state.turn;
    const seasons = ["春", "夏", "秋", "冬"];
    const idx = seasons.indexOf(t.season);
    const nextIdx = (idx + 1) % 4;
    t.season = seasons[nextIdx];
    if (nextIdx === 0) t.year++;
    t.number++;
    t.display = `${t.era}${t.year}年${t.season}`;
    this._applyDecay();
    return t;
  }

  /** 自然衰退 (每回合自动衰减) */
  _applyDecay() {
    const e = this.state.economy;
    // 腐败自然增长
    e.corruption = Math.min(100, e.corruption + 0.3);
    // 民心自然下降
    e.popularSupport = Math.max(0, e.popularSupport - 0.2);
    // 货币流通缓慢萎缩
    e.currencySupply = Math.max(0, e.currencySupply - 0.1);
    // 军队自然消耗
    const m = this.state.military;
    m.morale = Math.max(0, m.morale - 0.5);
    m.supply = Math.max(0, m.supply - 0.3);
  }

  /** 记录诏书 */
  recordEdict(content) {
    this.state.edictHistory.push({
      turn: this.state.turn.number,
      display: this.state.turn.display,
      content: (content || "").slice(0, 300),
      timestamp: Date.now(),
    });
  }

  /** 检查关键历史事件 */
  checkKeyEvent() {
    const turnNum = this.state.turn.number;
    const keyEvents = {
      8:  { name: "己巳之变", desc: "后金皇太极率军突破长城防线，直逼北京城下。京师震动，天下惊惶。", severity: "critical" },
      18: { name: "后金远征林丹汗", desc: "后金出兵远征蒙古林丹汗，北方草原格局剧变。", severity: "major" },
      21: { name: "明末大鼠疫", desc: "大规模鼠疫爆发，席卷华北。人口锐减，经济遭受重创。", severity: "critical" },
      34: { name: "皇太极称帝", desc: "皇太极于盛京称帝，改国号为大清。明朝面临前所未有的威胁。", severity: "critical" },
      53: { name: "农民军攻克洛阳开封", desc: "李自成农民军势如破竹，连克洛阳、开封等重镇。中原震动。", severity: "critical" },
      65: { name: "李自成攻陷北京", desc: "李自成攻破北京城。崇祯帝自缢煤山，留下'诸臣误我'的遗言。吴三桂引清兵入关，大明覆亡。", severity: "fatal" },
    };
    return keyEvents[turnNum] || null;
  }

  /** 从请求消息中尝试提取游戏上下文 (用于同步状态) */
  extractFromMessages(messages) {
    const allText = messages.map((m) => m.content || "").join("\n");

    // 尝试解析回合信息: 崇祯X年X季
    const turnMatch = allText.match(/(崇祯)(\d+|[一二三四五六七八九十]+)年(春|夏|秋|冬)/);
    if (turnMatch) {
      const y = turnMatch[2];
      const year = parseChineseYear(y) || this.state.turn.year;
      this.state.turn.era = turnMatch[1];
      this.state.turn.year = year;
      this.state.turn.season = turnMatch[3];
      this.state.turn.display = `${this.state.turn.era}${year}年${this.state.turn.season}`;
    }
  }

  /** 重置状态到初始值 */
  reset() {
    this.state = JSON.parse(JSON.stringify(config.defaultGameState));
    this.state.provinces = {};
    this.state.activePolicies = [];
    this.state.triggeredEvents = [];
    this.state.edictHistory = [];
    this.state.seasonalFocus = [];
    this.state.skillPoints = { finance: 0, management: 0, military: 0, knowledge: 0 };
  }
}

// 全局单例
const gameState = new GameState();

module.exports = { GameState, gameState };
