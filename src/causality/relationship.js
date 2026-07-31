/**
 * NPC 关系系统
 *
 * 跟踪玩家与每个 NPC 的动态关系, 受:
 * - 诏书决策影响 (反腐→得罪阉党, 赈灾→所有文官好感上升等)
 * - 对话内容影响 (侮辱/赞扬/信任)
 * - 世界事件影响 (派系斗争波及)
 *
 * 关系值 -100 到 +100:
 *   +80~+100: 死忠 (愿为陛下赴死)
 *   +40~+80:  信任 (主动提供帮助)
 *   0~+40:    恭敬 (正常的君臣关系)
 *   -40~0:    疏远 (消极应付)
 *   -80~-40:  敌对 (暗中阻挠)
 *   -100~-80: 叛意 (可能背叛/投敌)
 */
const { characterRegistry } = require("../characters/registry");

class RelationshipTracker {
  constructor() {
    this.relationships = new Map(); // npcName -> {score, history[], flags{}}
    this._initDefaults();
  }

  _initDefaults() {
    for (const name of characterRegistry.listNames()) {
      const char = characterRegistry.get(name);
      let base = 0;
      // 初始关系基于历史背景
      if (char.faction === "eunuch") base = -10; // 崇祯对宦官有戒心
      if (char.faction === "donglin") base = 5;   // 崇祯初年重用东林
      if (name === "袁崇焕") base = 20;            // 平台召对深受信任
      if (name === "魏忠贤") base = -40;           // 铲除阉党
      if (name === "房壮丽") base = 25;            // 协助铲除阉党有功

      this.relationships.set(name, {
        score: base,
        history: [{ turn: 0, event: "initial", delta: base, note: "初始关系" }],
        flags: {},
      });
    }
  }

  /** 获取单个 NPC 关系 */
  get(npcName) {
    return this.relationships.get(npcName) || { score: 0, history: [], flags: {} };
  }

  /** 获取关系等级描述 */
  getLevel(npcName) {
    const score = this.get(npcName).score;
    if (score >= 80) return { level: "loyal", label: "死忠", tone: "warm", willingToHelp: 0.9 };
    if (score >= 40) return { level: "trusted", label: "信任", tone: "respectful", willingToHelp: 0.7 };
    if (score >= 0)  return { level: "neutral", label: "恭敬", tone: "formal", willingToHelp: 0.5 };
    if (score >= -40) return { level: "distant", label: "疏远", tone: "cold", willingToHelp: 0.3 };
    if (score >= -80) return { level: "hostile", label: "敌对", tone: "threatening", willingToHelp: 0.1 };
    return { level: "treacherous", label: "叛意", tone: "deceptive", willingToHelp: 0 };
  }

  /** 修改关系 (受角色约束限制) */
  modify(npcName, delta, reason, turn) {
    let rel = this.relationships.get(npcName);
    if (!rel) {
      rel = { score: 0, history: [], flags: {} };
      this.relationships.set(npcName, rel);
    }
    // 获取角色约束
    const char = characterRegistry.get(npcName);
    const min = char ? char.relMin : -100;
    const max = char ? char.relMax : 100;

    rel.score = Math.max(min, Math.min(max, rel.score + delta));
    rel.history.push({ turn, event: reason, delta, note: `${delta >= 0 ? "+" : ""}${delta}: ${reason}` });
    return rel;
  }

  /** 从诏书决策批量更新关系 */
  applyEdictEffects(decisions, turn) {
    const changes = [];

    for (const d of decisions) {
      switch (d.type) {
        case "antiCorruption":
          // 反腐: 东林支持, 阉党反对
          changes.push(...this._applyFactionDelta("donglin", 5, "整顿吏治", turn));
          changes.push(...this._applyFactionDelta("eunuch", -8, "反腐调查", turn));
          break;
        case "taxIncrease":
          changes.push(...this._applyFactionDelta("donglin", -5, "加税伤民", turn));
          changes.push(...this._applyFactionDelta("eunuch", 3, "加税有利内廷", turn));
          break;
        case "taxDecrease":
          changes.push(...this._applyFactionDelta("donglin", 5, "减税养民", turn));
          changes.push(...this._applyFactionDelta("eunuch", -3, "减税减少收入", turn));
          break;
        case "recruit":
        case "deployTroops":
          changes.push(...this._applyFactionDelta("militaryGroup", 5, "扩充军力", turn));
          break;
        case "peaceTalks":
          changes.push(...this._applyFactionDelta("militaryGroup", -8, "议和有损军威", turn));
          changes.push(...this._applyFactionDelta("donglin", -3, "议和示弱", turn));
          break;
        case "reward":
          changes.push(...this._applyFactionDelta("eunuch", 5, "赏赐内廷", turn));
          changes.push(...this._applyFactionDelta("donglin", -2, "滥赏有损国库", turn));
          break;
      }
    }
    return changes;
  }

  _applyFactionDelta(faction, delta, reason, turn) {
    const changes = [];
    const chars = characterRegistry.getByFaction(faction);
    for (const char of chars) {
      this.modify(char.name, delta, reason, turn);
      changes.push({ npc: char.name, delta, reason });
    }
    return changes;
  }

  /** 检查是否有 NPC 即将叛变 */
  checkBetrayalRisk() {
    const risks = [];
    for (const [name, rel] of this.relationships) {
      if (rel.score <= -70 && !rel.flags.betrayalWarned) {
        risks.push({ npc: name, score: rel.score, risk: "high" });
        rel.flags.betrayalWarned = true;
      }
    }
    return risks;
  }

  /** 获取愿意提供帮助的 NPC 列表 */
  getWillingHelpers(minWillingness = 0.6) {
    const helpers = [];
    for (const [name] of this.relationships) {
      const level = this.getLevel(name);
      if (level.willingToHelp >= minWillingness) {
        helpers.push({ npc: name, level: level.label, willingness: level.willingToHelp });
      }
    }
    return helpers.sort((a, b) => b.willingness - a.willingness);
  }

  /** 重置 */
  reset() {
    this.relationships.clear();
    this._initDefaults();
  }

  /** 序列化 */
  toSnapshot() {
    return Array.from(this.relationships.entries()).map(([name, rel]) => ({
      name, score: rel.score, history: rel.history.slice(-20), flags: rel.flags,
    }));
  }

  /** 反序列化 */
  static fromSnapshot(data) {
    const tracker = new RelationshipTracker();
    if (Array.isArray(data)) {
      for (const entry of data) {
        tracker.relationships.set(entry.name, {
          score: entry.score, history: entry.history || [], flags: entry.flags || {},
        });
      }
    }
    return tracker;
  }
}

module.exports = { RelationshipTracker };
