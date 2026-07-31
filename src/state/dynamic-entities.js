/**
 * 动态实体创建系统 v2
 *
 * 数值策略:
 *   1. 硬上限 — 无论 AI 或玩家怎么说, 绝不能超过
 *   2. 上下文调整 — AI 根据国库/时代/合理性在范围内调整
 *   3. 代价递增 — 创建越多, 后续越贵, 边际效用递减
 */
const { gameState } = require("./game-state");

// ========== 硬上限 (不可逾越) ==========
const LIMITS = {
  faction: { power: { min: 5, max: 50 }, loyalty: { min: 10, max: 80 }, cost: { min: 30000, max: 200000 } },
  npc:     { loyalty: { min: 10, max: 90 }, cost: { min: 5000, max: 50000 } },
  troop:   { attack: { min: 10, max: 80 }, defense: { min: 10, max: 80 }, morale: { min: 20, max: 90 }, size: { min: 500, max: 10000 }, cost: { min: 30000, max: 150000 } },
};

// 已创建计数 (防止无限堆叠)
let creationCounts = { faction: 0, npc: 0, troop: 0 };

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

// ========== 命令解析 ==========
function parseCreationCommands(edictText) {
  const commands = [];

  const factionMatch = edictText.match(/(创立|建立|组建|设置|新设|成立)(.{2,10})(衙|司|局|厂|卫|所|营|署|院|部|处|队)/);
  if (factionMatch) {
    commands.push({ type: "create_faction", action: factionMatch[1], name: factionMatch[2] + factionMatch[3] });
  }

  const npcMatch = edictText.match(/(招募|征召|聘请|延揽|起用)(.{2,4})(?:为|担任|出任)?(.{2,8})?/);
  if (npcMatch) {
    commands.push({ type: "recruit_npc", action: npcMatch[1], name: npcMatch[2], role: npcMatch[3] || "招募人员" });
  }

  const troopMatch = edictText.match(/(创建|组建|编练|训练|新建)(.{2,10})(军|营|队|兵|骑|炮|舰|船|舟)/);
  if (troopMatch) {
    commands.push({ type: "create_troop", action: troopMatch[1], name: troopMatch[2] + troopMatch[3] });
  }

  return commands;
}

// ========== 实体管理 ==========
class DynamicEntityManager {
  constructor() { this._ensureState(); }

  _ensureState() {
    const gs = gameState.getState();
    if (!gs.dynamicEntities) {
      gs.dynamicEntities = { factions: {}, npcs: {}, troops: {} };
    }
    return gs.dynamicEntities;
  }

  /**
   * 创建派系 — 数值受限于国库和合理性
   * @param {string} name
   * @param {object} requested — AI 建议的数值 (可被玩家诱导, 但我们做上限截断)
   */
  createFaction(name, requested = {}) {
    const de = this._ensureState();
    const id = `dyn_${name}`;
    const state = gameState.getState();
    const treasury = state.economy.treasury;

    // 成本: 基于国库~5-15%
    const baseCost = clamp(Math.floor(treasury * 0.08), LIMITS.faction.cost.min, LIMITS.faction.cost.max);
    // 递增: 每多创立一个, 成本+20%
    const multiplier = 1 + (creationCounts.faction * 0.2);
    const cost = Math.floor(baseCost * multiplier);

    // 权力: 国库充裕则初始权力略高, 但有上限
    const powerBase = treasury > 2000000 ? 30 : treasury > 500000 ? 20 : 12;
    const power = clamp(requested.power || powerBase, LIMITS.faction.power.min, LIMITS.faction.power.max);
    const loyalty = clamp(requested.loyalty || 50, LIMITS.faction.loyalty.min, LIMITS.faction.loyalty.max);

    de.factions[id] = {
      id, name, type: "custom_faction",
      power, loyalty,
      cost,
      createdAt: Date.now(), createdBy: "player_edict",
      description: `皇帝创立于${state.turn.display}, 初始势力${power}, 忠诚${loyalty}`,
    };

    creationCounts.faction++;
    return de.factions[id];
  }

  recruitNpc(name, role, requested = {}) {
    const de = this._ensureState();
    const id = `dyn_npc_${name}`;
    const state = gameState.getState();

    const baseCost = clamp(15000, LIMITS.npc.cost.min, LIMITS.npc.cost.max);
    const multiplier = 1 + (creationCounts.npc * 0.15);
    const cost = Math.floor(baseCost * multiplier);

    const loyalty = clamp(requested.loyalty || 55, LIMITS.npc.loyalty.min, LIMITS.npc.loyalty.max);

    de.npcs[id] = {
      id, name, role: role || "招募人员",
      faction: "neutral",
      personality: requested.personality || "有待观察",
      loyalty,
      cost,
      createdAt: Date.now(), createdBy: "player_edict",
    };

    creationCounts.npc++;
    return de.npcs[id];
  }

  createTroop(name, requested = {}) {
    const de = this._ensureState();
    const id = `dyn_troop_${name}`;
    const state = gameState.getState();

    const baseCost = clamp(60000, LIMITS.troop.cost.min, LIMITS.troop.cost.max);
    const multiplier = 1 + (creationCounts.troop * 0.25); // 兵种递增更陡
    const cost = Math.floor(baseCost * multiplier);

    const attack = clamp(requested.attack || 45, LIMITS.troop.attack.min, LIMITS.troop.attack.max);
    const defense = clamp(requested.defense || 40, LIMITS.troop.defense.min, LIMITS.troop.defense.max);
    const morale = clamp(requested.morale || 60, LIMITS.troop.morale.min, LIMITS.troop.morale.max);
    const size = clamp(requested.size || 3000, LIMITS.troop.size.min, LIMITS.troop.size.max);

    de.troops[id] = {
      id, name, category: "custom",
      attack, defense, morale, size, cost,
      createdAt: Date.now(), createdBy: "player_edict",
    };

    creationCounts.troop++;
    return de.troops[id];
  }

  processCommands(edictText) {
    const commands = parseCreationCommands(edictText);
    const results = [];

    for (const cmd of commands) {
      switch (cmd.type) {
        case "create_faction": {
          const f = this.createFaction(cmd.name);
          results.push({ ...cmd, id: f.id, cost: f.cost, power: f.power });
          break;
        }
        case "recruit_npc": {
          const n = this.recruitNpc(cmd.name, cmd.role);
          results.push({ ...cmd, id: n.id, cost: n.cost });
          break;
        }
        case "create_troop": {
          const t = this.createTroop(cmd.name);
          results.push({ ...cmd, id: t.id, cost: t.cost, attack: t.attack, defense: t.defense });
          break;
        }
      }
    }

    const totalCost = results.reduce((sum, r) => sum + (r.cost || 0), 0);
    if (totalCost > 0) {
      const gs = gameState.getState();
      if (gs.economy.treasury < totalCost) {
        results.forEach((r) => { r.status = "failed"; r.reason = "国库不足"; });
        return { commands: results, totalCost: 0, error: `国库不足: 需要 ${totalCost.toLocaleString()} 两, 当前 ${Math.floor(gs.economy.treasury).toLocaleString()} 两` };
      }
      gs.economy.treasury -= totalCost;
    }
    return { commands: results, totalCost };
  }

  // ========== 查询 ==========

  getPromptContext() {
    const de = this._ensureState();
    const parts = [];
    const factions = Object.values(de.factions);
    const npcs = Object.values(de.npcs);
    const troops = Object.values(de.troops);
    if (factions.length) parts.push("[Player-created institutions:]\n" + factions.map((f) => `  ${f.name} (power:${f.power}, loyalty:${f.loyalty}, cost:${f.cost.toLocaleString()}t)`).join("\n"));
    if (npcs.length) parts.push("[Player-recruited personnel:]\n" + npcs.map((n) => `  ${n.name} (${n.role}, loyalty:${n.loyalty})`).join("\n"));
    if (troops.length) parts.push("[Player-created troops:]\n" + troops.map((t) => `  ${t.name} [atk:${t.attack} def:${t.defense} morale:${t.morale} size:${t.size}]`).join("\n"));
    return parts.length > 0 ? parts.join("\n") + `\n[Limits: max ${LIMITS.troop.attack.max} atk, creation cost increases with each new entity]` : "";
  }

  getAll() {
    const de = this._ensureState();
    return { factions: Object.values(de.factions), npcs: Object.values(de.npcs), troops: Object.values(de.troops) };
  }

  reset() {
    const gs = gameState.getState();
    gs.dynamicEntities = { factions: {}, npcs: {}, troops: {} };
    creationCounts = { faction: 0, npc: 0, troop: 0 };
  }
}

const dynamicEntities = new DynamicEntityManager();

module.exports = { DynamicEntityManager, dynamicEntities, parseCreationCommands, LIMITS };
