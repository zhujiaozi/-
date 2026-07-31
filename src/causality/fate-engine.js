/**
 * NPC 命运引擎 v2
 *
 * 三种驱动:
 *   1. 可逆命运: DISGRACED/IMPRISONED/EXILED 可被玩家赦免/起复
 *   2. 玩家主动操作: 诏书中明确下令 → 直接改变命运
 *   3. 派系集体命运: 一人荣辱影响全派系
 *
 * 状态流转:
 *   ALIVE ──→ DISGRACED ──→ RESTORED (→ ALIVE)
 *   ALIVE ──→ IMPRISONED ──→ PARDONED (→ ALIVE) / EXECUTED (→ DEAD)
 *   ALIVE ──→ EXILED ──→ RECALLED (→ ALIVE)
 *   ALIVE ──→ DEAD (战死/殉国/处决, 不可逆)
 *   ALIVE ──→ BETRAYED (不可逆)
 *   ALIVE ──→ RETIRED ──→ RECALLED (→ ALIVE)
 *   ALIVE ──→ PROMOTED (正向, 不可逆升级)
 */
const { characterRegistry } = require("../characters/registry");
const { UNIQUE_FATES } = require("./unique-fates");

// 状态定义: name, reversible (是否可逆), description
const STATUS = {
  ALIVE:      { name: "alive",      reversible: true,  label: "在职" },
  DISGRACED:  { name: "disgraced",  reversible: true,  label: "失宠" },
  IMPRISONED: { name: "imprisoned", reversible: true,  label: "下狱" },
  EXILED:     { name: "exiled",     reversible: true,  label: "流放" },
  PARDONED:   { name: "pardoned",   reversible: true,  label: "赦免" },
  RESTORED:   { name: "restored",   reversible: true,  label: "起复" },
  RECALLED:   { name: "recalled",   reversible: true,  label: "召还" },
  PROMOTED:   { name: "promoted",   reversible: false, label: "升迁" },
  RETIRED:    { name: "retired",    reversible: true,  label: "隐退" },
  EXECUTED:   { name: "executed",   reversible: false, label: "处决" },
  DEAD:       { name: "dead",       reversible: false, label: "死亡" },
  BETRAYED:   { name: "betrayed",   reversible: false, label: "叛变" },
};

/**
 * 从诏书文本中解析玩家对 NPC 的明确指令
 */
function parsePlayerActions(text) {
  const actions = [];
  const names = characterRegistry.listNames();

  for (const name of names) {
    // 处决类
    if (text.match(new RegExp(`(处死|诛杀|凌迟|斩首|赐死).{0,4}${name}`))) {
      actions.push({ target: name, action: "execute", source: "player" });
    }
    // 下狱类
    else if (text.match(new RegExp(`(下狱|逮捕|拿下|收监|打入天牢).{0,4}${name}`))) {
      actions.push({ target: name, action: "imprison", source: "player" });
    }
    // 罢免/革职
    else if (text.match(new RegExp(`(罢免|革职|免去|撤职|罢黜).{0,4}${name}`))) {
      actions.push({ target: name, action: "disgrace", source: "player" });
    }
    // 流放
    else if (text.match(new RegExp(`(流放|发配|充军).{0,4}${name}`))) {
      actions.push({ target: name, action: "exile", source: "player" });
    }
    // 赦免/起复/释放
    else if (text.match(new RegExp(`(赦免|释放|起复|召回|官复原职).{0,4}${name}`))) {
      actions.push({ target: name, action: "pardon", source: "player" });
    }
    // 提拔/升迁
    else if (text.match(new RegExp(`(提拔|升迁|擢升|加封|晋封).{0,4}${name}`))) {
      actions.push({ target: name, action: "promote", source: "player" });
    }
  }

  // 派系级别指令
  if (text.includes("清洗阉党") || text.includes("铲除阉党") || text.includes("清除阉党")) {
    actions.push({ target: "eunuch", action: "faction_purge", source: "player" });
  }
  if (text.includes("打压东林") || text.includes("遏制东林")) {
    actions.push({ target: "donglin", action: "faction_suppress", source: "player" });
  }

  return actions;
}

class FateEngine {
  constructor() {
    this.fates = new Map();
    this._initDefaults();
  }

  _initDefaults() {
    for (const name of characterRegistry.listNames()) {
      const char = characterRegistry.get(name);
      this.fates.set(name, {
        status: "alive",
        statusHistory: [{ status: "alive", turn: 0, reason: "initial" }],
        role: char.role,
        events: [],
        promotions: 0,
      });
    }
  }

  get(npcName) {
    return this.fates.get(npcName) || { status: "alive", statusHistory: [] };
  }

  /** 核心方法: 每回合检查命运事件 */
  checkFates(relationships, worldState, edictText, turn) {
    const events = [];
    const gs = require("../state/game-state").gameState.getState();

    // 1. 先处理玩家主动指令
    const playerActions = parsePlayerActions(edictText || "");
    for (const act of playerActions) {
      const evt = this._applyPlayerAction(act, turn, { relationships, worldState, edictText });
      // 派系级指令 (_purgeFaction/_suppressFaction) 返回的是事件数组，需展开
      if (evt) events.push(...(Array.isArray(evt) ? evt : [evt]));
    }

    // 2. 自动命运检查
    for (const [name, fate] of this.fates) {
      const char = characterRegistry.get(name);
      if (!char) continue;

      // 不可逆状态跳过
      if (["dead", "executed", "betrayed"].includes(fate.status)) continue;

      const rel = relationships.get(name);
      const relScore = rel ? rel.score : 0;
      let event = null;

      // 2a. 升迁: 关系极好 + 未被升迁过
      if (!event && fate.status === "alive" && relScore >= 75 && !fate.flags?.promoted) {
        event = this._makeEvent(name, "promoted", turn, `${name}因深得圣心，被提拔至更重要的职位。`, { imperialAuthority: 5 });
        if (!fate.flags) fate.flags = {};
        fate.flags.promoted = true;
        fate.promotions = (fate.promotions || 0) + 1;
      }

      // 2d. 隐退: 关系冷淡 + 朝堂不稳
      if (!event && fate.status === "alive" && relScore > -40 && relScore < 15 && worldState.vars.factionStability < -55) {
        if (!fate.flags?.retired) {
          event = this._makeEvent(name, "retired", turn, `${name}心力交瘁，上书告老还乡。`, { factionStability: 3 });
          if (!fate.flags) fate.flags = {};
          fate.flags.retired = true;
        }
      }

      // 2e. 战死: 武将 + 边境危机 + 概率
      if (!event && fate.status === "alive" && char.faction === "militaryGroup" && worldState.vars.borderTension > 75) {
        if (Math.random() < 0.12 && !fate.flags?.diedInBattle) {
          event = this._makeEvent(name, "dead", turn, `${name}亲临前线督战，不幸战死沙场。`, { militaryMorale: -10, popularSupport: -2 });
          if (!fate.flags) fate.flags = {};
          fate.flags.diedInBattle = true;
        }
      }

      if (event) {
        fate.events.push(event);
        events.push(event);
      }
    }

    // 3. 角色独特命运 (优先级最高, 替代通用命运)
    for (const [name, fate] of this.fates) {
      const uniqueFateDefs = UNIQUE_FATES[name];
      if (!uniqueFateDefs) continue;
      if (["dead", "executed", "betrayed"].includes(fate.status)) continue;

      const char = characterRegistry.get(name);
      const rel = relationships.get(name);
      const relScore = rel ? rel.score : 0;

      for (const path of uniqueFateDefs.paths) {
        if (fate.flags?.[`unique_${path.id}`]) continue; // 已触发过

        if (this._checkUniqueTrigger(path.trigger, { name, relScore, fate, char, relationships, worldState, turn, edictText })) {
          const event = {
            type: "unique_fate",
            name: path.name,
            desc: path.narrative,
            effects: path.effects || {},
            isUnique: true,
            historicalNote: uniqueFateDefs.historicalFate,
          };
          if (path.irreversible) fate.status = "dead";
          if (!fate.flags) fate.flags = {};
          fate.flags[`unique_${path.id}`] = true;
          fate.events.push(event);
          events.push(event);
          break; // 每回合最多触发一个独特命运
        }
      }
    }

    // 4. 派系集体效应
    const factionEvents = this._applyFactionEffects(playerActions, relationships, events, turn);
    events.push(...factionEvents);

    return events;
  }

  /** 应用玩家主动指令 */
  _applyPlayerAction(act, turn, ctx = {}) {
    // 派系级别
    if (act.action === "faction_purge") {
      return this._purgeFaction(act.target, turn);
    }
    if (act.action === "faction_suppress") {
      return this._suppressFaction(act.target, turn);
    }

    // 个人级别：优先匹配角色独特命运（如魏忠贤被处死 → "贬谪自尽"，
    // 而不是通用处死文案）。必须在通用状态变更之前检查——一旦 status
    // 变成 executed，步骤 3 的独特命运循环就会永远跳过。
    const uniqueEvt = this._tryUniqueFateForAction(act, turn, ctx);
    if (uniqueEvt) return uniqueEvt;

    const fate = this.fates.get(act.target);
    if (!fate) return null;

    const char = characterRegistry.get(act.target);
    const name = act.target;

    switch (act.action) {
      case "execute":
        if (!["alive", "disgraced", "imprisoned", "exiled"].includes(fate.status)) return null;
        return this._makeEvent(name, "executed", turn, `${name}被下旨处死。一代权臣就此殒命。`, { imperialAuthority: 8, popularSupport: name === "魏忠贤" ? 10 : 0 });

      case "imprison":
        if (fate.status !== "alive") return null;
        return this._makeEvent(name, "imprisoned", turn, `${name}被下旨逮捕，打入天牢。`, { imperialAuthority: 3 });

      case "disgrace":
        if (fate.status !== "alive") return null;
        return this._makeEvent(name, "disgraced", turn, `${name}被罢免官职，贬为庶民。`, { imperialAuthority: 4 });

      case "exile":
        if (!["alive", "imprisoned"].includes(fate.status)) return null;
        return this._makeEvent(name, "exiled", turn, `${name}被流放边疆，永不许回京。`, {});

      case "pardon":
        if (!["imprisoned", "disgraced", "exiled", "retired"].includes(fate.status)) return null;
        const prevStatus = fate.status;
        // 恢复为 alive
        fate.status = "alive";
        fate.statusHistory.push({ status: "alive", turn, reason: `pardoned from ${prevStatus}` });
        // 清除相关标记
        if (fate.flags) {
          delete fate.flags.autoImprisoned;
          delete fate.flags.retired;
        }
        return {
          type: "pardoned",
          name: `${name}获得赦免`,
          desc: `${name}蒙陛下恩准，被赦免了${STATUS[prevStatus.toUpperCase()]?.label || prevStatus}之罚，恢复原职。`,
          effects: { imperialAuthority: 2 },
        };

      case "promote":
        if (fate.status !== "alive") return null;
        return this._makeEvent(name, "promoted", turn, `陛下亲自下旨提拔${name}。其在朝中地位大幅提升。`, { imperialAuthority: 5 });

      default:
        return null;
    }
  }

  /**
   * 玩家指令命中角色独特命运时，用独特命运替代通用处置
   * (如"处死魏忠贤"→ wei_exile_suicide / wei_purged_early)
   */
  _tryUniqueFateForAction(act, turn, ctx) {
    const uniqueFateDefs = UNIQUE_FATES[act.target];
    if (!uniqueFateDefs) return null;
    const fate = this.fates.get(act.target);
    if (!fate || ["dead", "executed", "betrayed"].includes(fate.status)) return null;

    const actionConditionMap = { execute: "executed", disgrace: "disgraced" };
    const wanted = actionConditionMap[act.action];
    if (!wanted) return null;

    // 匹配由玩家驱动且与当前动作一致的路径；有 beforeTurn 限制的优先
    const matches = [];
    for (const path of uniqueFateDefs.paths) {
      const t = path.trigger || {};
      if (!t.byPlayer || t.condition !== wanted) continue;
      if (fate.flags?.[`unique_${path.id}`]) continue;
      matches.push(path);
    }
    if (matches.length === 0) return null;
    const path = matches.find((p) => p.trigger.beforeTurn && turn < p.trigger.beforeTurn)
              || matches.find((p) => !p.trigger.beforeTurn);
    if (!path) return null;

    if (!fate.flags) fate.flags = {};
    fate.flags[`unique_${path.id}`] = true;
    const finalStatus = act.action === "execute" ? "executed" : "disgraced";
    fate.status = finalStatus;
    fate.statusHistory.push({ status: finalStatus, turn, reason: `unique fate: ${path.id}` });

    const event = {
      type: "unique_fate",
      name: path.name,
      desc: path.narrative,
      effects: path.effects || {},
      isUnique: true,
      historicalNote: uniqueFateDefs.historicalFate,
    };
    fate.events.push(event);
    return event;
  }

  /** 清洗派系 */
  _purgeFaction(faction, turn) {
    const events = [];
    const chars = characterRegistry.getByFaction(faction);
    for (const char of chars) {
      const fate = this.fates.get(char.name);
      if (!fate || !["alive", "disgraced"].includes(fate.status)) continue;
      if (!char.canBetray) continue; // 清洗只影响可被弹劾的

      const evt = this._makeEvent(char.name, "imprisoned", turn,
        `清洗${faction === "eunuch" ? "阉党" : faction}行动中，${char.name}被株连下狱。`, {});
      fate.events.push(evt);
      events.push(evt);
    }
    return events;
  }

  /** 打压派系 */
  _suppressFaction(faction, turn) {
    const events = [];
    const chars = characterRegistry.getByFaction(faction);
    for (const char of chars) {
      const fate = this.fates.get(char.name);
      if (!fate || fate.status !== "alive") continue;
      const evt = this._makeEvent(char.name, "disgraced", turn,
        `${char.name}因${faction === "donglin" ? "东林党" : faction}受打压而被贬谪外放。`, {});
      fate.events.push(evt);
      events.push(evt);
    }
    return events;
  }

  /** 派系集体效应 */
  _applyFactionEffects(playerActions, relationships, events, turn) {
    const factionEvents = [];
    const factionMap = { eunuch: "阉党", donglin: "东林党", militaryGroup: "武将" };

    // 检查是否有派系成员被处决/叛变——影响同派系其他人
    for (const evt of events) {
      if (!["executed", "betrayed", "imprisoned"].includes(evt.type)) continue;
      const victimName = evt.name;
      const victimChar = characterRegistry.get(victimName);
      if (!victimChar) continue;

      const faction = victimChar.faction;
      const delta = evt.type === "executed" ? -12 : evt.type === "betrayed" ? -10 : -5;

      // 影响同派系成员关系
      const peers = characterRegistry.getByFaction(faction);
      for (const peer of peers) {
        if (peer.name === victimName) continue;
        const rel = relationships.get(peer.name);
        if (rel) {
          rel.score = Math.max(peer.relMin, rel.score + delta);
          rel.history.push({ turn, event: `faction_fallout:${victimName}`, delta, note: `受${victimName}之事牵连` });
        }
      }

      factionEvents.push({
        type: "faction_effect",
        name: `${factionMap[faction] || faction}受到冲击`,
        desc: `${victimName}之事震惊朝野。${factionMap[faction] || faction}其他成员人人自危。`,
        effects: {},
      });
    }

    return factionEvents;
  }

  /** 生成命运事件并更新状态 */
  _makeEvent(name, newStatus, turn, desc, effects) {
    const fate = this.fates.get(name);
    if (!fate) return null;

    const prevStatus = fate.status;
    fate.status = newStatus;
    fate.statusHistory.push({ status: newStatus, turn, reason: desc });

    return {
      type: newStatus,
      name,
      desc,
      effects,
      prevStatus,
      turn,
    };
  }

  /** 检查独特命运的触发条件 */
  _checkUniqueTrigger(trigger, ctx) {
    const { relScore, fate, char, relationships, worldState, turn, edictText } = ctx;

    // condition: "executed" by player → check edict text
    if (trigger.condition === "executed" && trigger.byPlayer) {
      if (!edictText) return false;
      const name = char.name;
      if (trigger.beforeTurn && turn >= trigger.beforeTurn) return false;
      return new RegExp(`(处死|诛杀|凌迟|斩首|赐死).{0,4}${name}`).test(edictText || "");
    }

    // condition: "disgraced" by player
    if (trigger.condition === "disgraced" && trigger.byPlayer) {
      if (!edictText) return false;
      return new RegExp(`(罢免|革职|免去|撤职).{0,4}${char.name}`).test(edictText || "");
    }

    // condition: "turn" equals
    if (trigger.condition === "turn" && trigger.equals) {
      if (turn !== trigger.equals) return false;
      if (trigger.scoreAbove !== undefined && relScore <= trigger.scoreAbove) return false;
      if (trigger.scoreBelow !== undefined && relScore >= trigger.scoreBelow) return false;
      return true;
    }

    // condition: "turn" min
    if (trigger.condition === "turn" && trigger.min) {
      if (turn < trigger.min) return false;
      if (trigger.status && fate.status !== trigger.status) return false;
      if (trigger.scoreAbove !== undefined && relScore <= trigger.scoreAbove) return false;
      return true;
    }

    // condition: "world" thresholds
    if (trigger.condition === "world") {
      const v = worldState.vars;
      if (trigger.borderTension !== undefined && v.borderTension < trigger.borderTension) return false;
      if (trigger.qingAggression !== undefined && v.qingAggression < trigger.qingAggression) return false;
      if (trigger.scoreAbove !== undefined && relScore <= trigger.scoreAbove) return false;
      if (trigger.scoreBelow !== undefined && relScore >= trigger.scoreBelow) return false;
      if (trigger.status && fate.status !== trigger.status) return false;
      if (trigger.minTurn && turn < trigger.minTurn) return false;
      return true;
    }

    // condition: "linkedTo" another NPC
    if (trigger.condition === "linkedTo") {
      const otherFate = this.fates.get(trigger.npc);
      if (!otherFate) return false;
      if (otherFate.status !== trigger.theirStatus) return false;
      return true;
    }

    // condition: "retired"
    if (trigger.condition === "retired") {
      return fate.status === "retired";
    }

    // condition: "alive" with score/turn constraints
    if (trigger.condition === "alive") {
      if (fate.status !== "alive") return false;
      if (trigger.minTurn && turn < trigger.minTurn) return false;
      if (trigger.scoreAbove !== undefined && relScore <= trigger.scoreAbove) return false;
      return true;
    }

    return false;
  }

  getReport() {
    return Array.from(this.fates.entries()).map(([name, fate]) => {
      const char = characterRegistry.get(name);
      const statusInfo = STATUS[fate.status.toUpperCase()] || { label: fate.status };
      return {
        npc: name,
        faction: char?.faction || "unknown",
        status: fate.status,
        statusLabel: statusInfo.label,
        reversible: statusInfo.reversible !== false,
        promotions: fate.promotions || 0,
        recentEvents: (fate.events || []).slice(-3).map((e) => e.name || e.type),
        statusHistory: (fate.statusHistory || []).slice(-5).map((h) => `${h.status}@turn${h.turn}`),
      };
    });
  }

  reset() { this.fates.clear(); this._initDefaults(); }

  toSnapshot() {
    return Array.from(this.fates.entries()).map(([name, fate]) => ({
      name, status: fate.status, role: fate.role,
      statusHistory: (fate.statusHistory || []).slice(-20),
      events: (fate.events || []).slice(-20),
      flags: fate.flags || {}, promotions: fate.promotions || 0,
    }));
  }

  static fromSnapshot(data) {
    const engine = new FateEngine();
    if (Array.isArray(data)) {
      for (const entry of data) {
        engine.fates.set(entry.name, {
          status: entry.status, role: entry.role,
          statusHistory: entry.statusHistory || [],
          events: entry.events || [],
          flags: entry.flags || {},
          promotions: entry.promotions || 0,
        });
      }
    }
    return engine;
  }
}

module.exports = { FateEngine, parsePlayerActions };
