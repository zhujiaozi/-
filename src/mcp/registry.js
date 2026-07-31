/**
 * MCP 工具注册中心
 */
const { getGameState, getProvince, getEconomy, getMilitary } = require("./tools/game-state");
const { calculateEdictEffect, formatEdictResult } = require("./tools/edict");
const { getNpcProfile, getNpcList, getNpcByFaction } = require("./tools/npc");
const { simulateEconomy, projectRevenue } = require("./tools/economy");
const { evaluateFactionReaction, predictRebellion } = require("./tools/faction");
const { checkHistoricalEvent, getEventTimeline } = require("./tools/history");

// 依赖注入 (运行时由 server.js 设置)
let deps = {};

function injectDependencies(d) { Object.assign(deps, d); }

/** RAG 检索处理器 (延迟绑定) */
async function searchHistoryHandler(args = {}) {
  if (!deps.retriever) return { error: "RAG retriever not initialized", results: [] };
  const results = await deps.retriever.search(args.query || "", args.topK || 5);
  return { query: args.query, results };
}

/** 关系查询处理器 */
async function getRelationshipsHandler(_args = {}) {
  if (!deps.relationshipTracker) return { error: "Relationship tracker not available" };
  const report = [];
  for (const name of deps.characterRegistry.listNames()) {
    const rel = deps.relationshipTracker.get(name);
    const level = deps.relationshipTracker.getLevel(name);
    report.push({ npc: name, score: rel.score, level: level.label, willingToHelp: level.willingToHelp });
  }
  return report;
}

/** 世界状态查询 */
async function getWorldStateHandler(_args = {}) {
  if (!deps.worldState) return { error: "World state not available" };
  return deps.worldState.getState();
}

/** 命运查询 */
async function getFatesHandler(_args = {}) {
  if (!deps.fateEngine) return { error: "Fate engine not available" };
  return deps.fateEngine.getReport();
}

/** 党派查询 */
async function getFactionsHandler(_args = {}) {
  if (!deps.factionEngine) return { error: "Faction engine not available" };
  return deps.factionEngine.getReport();
}

const TOOLS = [
  { name: "getGameState", description: "获取当前完整游戏状态（回合/国库/民心/腐败/皇权/军队/派系）", parameters: { type: "object", properties: {}, required: [] }, handler: getGameState },
  { name: "getEconomy", description: "获取经济数据（国库/内帑/民心/腐败/皇权/通货）", parameters: { type: "object", properties: {}, required: [] }, handler: getEconomy },
  { name: "getProvince", description: "获取省份详情。codeName如'1001_beijing'", parameters: { type: "object", properties: { codeName: { type: "string", description: "省份代码" } }, required: ["codeName"] }, handler: getProvince },
  { name: "getMilitary", description: "获取军事状态（兵力/士气/补给/边境/叛军）", parameters: { type: "object", properties: {}, required: [] }, handler: getMilitary },
  { name: "calculateEdictEffect", description: "计算诏书效果。decisions: [{type, intensity:low|normal|high}]。type: relief/taxIncrease/taxDecrease/antiCorruption/recruit/deployTroops/irrigation/fortify/peaceTalks/appeaseRefugees/roadMaintenance/currency/reward/martialLaw", parameters: { type: "object", properties: { decisions: { type: "array", items: { type: "object", properties: { type: { type: "string" }, intensity: { type: "string", enum: ["low", "normal", "high"] } }, required: ["type"] } } }, required: ["decisions"] }, handler: calculateEdictEffect },
  { name: "simulateEconomy", description: "模拟未来N回合经济走势。turns: 1-20", parameters: { type: "object", properties: { turns: { type: "number", minimum: 1, maximum: 20 } }, required: ["turns"] }, handler: simulateEconomy },
  { name: "evaluateFactionReaction", description: "评估东林党/阉党/武将对政策的反应。action: 政策描述", parameters: { type: "object", properties: { action: { type: "string" } }, required: ["action"] }, handler: evaluateFactionReaction },
  { name: "getNpcProfile", description: "获取NPC档案。可用: 魏忠贤/袁崇焕/孙承宗/崔呈秀/温体仁/洪承畴/钱谦益/徐光启/房壮丽", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, handler: getNpcProfile },
  { name: "checkHistoricalEvent", description: "检查当前回合关键历史事件", parameters: { type: "object", properties: {}, required: [] }, handler: checkHistoricalEvent },
  { name: "searchHistory", description: "从明史知识库检索历史背景。query: 查询文本, topK: 1-10", parameters: { type: "object", properties: { query: { type: "string" }, topK: { type: "number", minimum: 1, maximum: 10 } }, required: ["query"] }, handler: searchHistoryHandler },
  { name: "getRelationships", description: "查询所有NPC与皇帝的关系值和等级", parameters: { type: "object", properties: {}, required: [] }, handler: getRelationshipsHandler },
  { name: "getWorldState", description: "查询世界变量（边境紧张/饥荒/瘟疫/朝堂稳定/农民军/清军侵略）", parameters: { type: "object", properties: {}, required: [] }, handler: getWorldStateHandler },
  { name: "getFates", description: "查询NPC命运状态和已触发事件", parameters: { type: "object", properties: {}, required: [] }, handler: getFatesHandler },
  { name: "getFactionReport", description: "查询党派竞争状态和执政建议", parameters: { type: "object", properties: {}, required: [] }, handler: getFactionsHandler },
];

class ToolRegistry {
  constructor() { this.tools = new Map(); TOOLS.forEach((t) => this.tools.set(t.name, t)); }

  register(name, def) { this.tools.set(name, { ...this.tools.get(name), ...def }); }
  get(name) { return this.tools.get(name) || null; }
  listNames() { return Array.from(this.tools.keys()); }

  toOpenAIFunctions() {
    return Array.from(this.tools.values()).map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  toPromptDescription() {
    return Array.from(this.tools.values())
      .map((t) => {
        const params = t.parameters.properties
          ? Object.entries(t.parameters.properties).map(([k, v]) => `${k}(${v.type})`).join(",")
          : "";
        return `- ${t.name}${params ? "(" + params + ")" : ""}: ${t.description.slice(0, 60)}`;
      })
      .join("\n");
  }

  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    if (!tool.handler) throw new Error(`Tool "${name}" has no handler`);
    return await tool.handler(args || {});
  }
}

const registry = new ToolRegistry();

module.exports = { registry, TOOLS, injectDependencies };
