/**
 * 游戏结构化输出的确定性参数合成器
 *
 * 游戏的 BYOK 流程 (奏折生成 / 任命指令解析 / 廷议总结等) 通过
 * function calling 要求 LLM 以工具参数形式返回结构化数据。
 * proxy 模式下这些参数由上游 LLM 生成；deterministic 模式下
 * 本模块根据工具参数的 JSON Schema + 请求文本合成一份合理参数，
 * 保证游戏端能解析出有效内容（不再返回空 {}）。
 */

const { characterRegistry } = require("../characters/registry");
const { gameState } = require("../state/game-state");

// 明代常见官职（用于从文本中识别任命目标职位）
const POSITION_KEYWORDS = [
  "内阁首辅", "内阁大学士", "大学士",
  "吏部尚书", "户部尚书", "兵部尚书", "礼部尚书", "刑部尚书", "工部尚书",
  "左都御史", "右都御史", "都御史",
  "蓟辽总督", "三边总督", "总督", "巡抚", "总兵", "将军",
  "锦衣卫指挥使", "东厂提督", "司礼监秉笔太监",
  "尚书", "侍郎", "御史",
];

const COMMAND_PATTERNS = [
  { re: /罢免|革职|撤职|削职|夺职/, command: "dismiss" },
  { re: /诛杀|处死|斩|赐死|正法/, command: "execute" },
  { re: /任命|提拔|授予|拜|升任|擢升|起用|征召/, command: "appoint" },
];

/**
 * 从文本中找出提到的大臣姓名（优先角色卡里的知名 NPC）
 */
function findMinisterNames(text) {
  const names = [];
  for (const name of characterRegistry.listNames()) {
    if (text.includes(name)) names.push(name);
  }
  return names;
}

function findPosition(text) {
  for (const pos of POSITION_KEYWORDS) {
    if (text.includes(pos)) return pos;
  }
  return null;
}

function detectCommand(text) {
  for (const { re, command } of COMMAND_PATTERNS) {
    if (re.test(text)) return command;
  }
  return "appoint";
}

/**
 * 生成一段奏折/汇报风格的中文文本（基于当前游戏状态）
 */
function generateReportText(text) {
  const state = gameState.getState();
  const e = state.economy;
  const m = state.military;
  const t = state.turn;

  const lines = [];
  lines.push(`${t.display}，各地奏报汇总如下：`);
  lines.push(`户部报：国库存银约${Math.floor(e.treasury / 10000)}万两，民心${e.popularSupport.toFixed(0)}，吏治贪腐指数${e.corruption.toFixed(0)}。`);
  if (m.rebellionLevel > 40) lines.push(`兵部急报：流寇声势渐盛（叛乱指数${m.rebellionLevel.toFixed(0)}），请陛下早作绸缪。`);
  else lines.push(`兵部报：各地兵马合计${Math.floor(m.totalTroops / 10000)}万余，士气${m.morale.toFixed(0)}，边境${m.borderStatus === "Alert" ? "戒备中" : "暂无大战"}。`);
  if (e.treasury < 500000) lines.push("国库空虚，诸臣恳请陛下开源节流，以度时艰。");
  else lines.push("朝政大体平稳，诸务按部就班。");
  lines.push("以上各节，伏惟陛下圣裁。");
  return lines.join("\n");
}

/**
 * 按属性名/描述推断字符串取值
 */
function synthString(key, propSchema, ctx) {
  const k = key.toLowerCase();
  const desc = `${propSchema?.description || ""} ${propSchema?.title || ""}`;

  if (propSchema?.enum && propSchema.enum.length > 0) return propSchema.enum[0];

  if (/command$|^command/.test(k)) return detectCommand(ctx.text);
  if (/target_type/.test(k)) return "minister";
  if (/target_name|minister|name|姓名|大臣/.test(k + desc)) {
    return findMinisterNames(ctx.text)[0] || "";
  }
  if (/value_name|position|官职|官位|职位/.test(k + desc)) {
    return findPosition(ctx.text) || "内阁大学士";
  }
  if (/unit/.test(k)) return "";
  if (/title|标题/.test(k + desc)) return "奏报";
  if (/content|text|summary|report|memorial|result|描述|内容|奏|汇报|description/.test(k + desc)) {
    return generateReportText(ctx.text);
  }
  if (/id$|_id/.test(k)) return "1";
  return "无";
}

function synthNumber(key) {
  const k = key.toLowerCase();
  if (/turn/.test(k)) return gameState.getTurn().number;
  if (/influence|power|loyalty|score|count/.test(k)) return 50;
  return 0;
}

/**
 * 解析文本中的任命/罢免指令，填充到 command 列表项 schema
 */
function fillCommandItem(itemSchema, ctx) {
  const command = detectCommand(ctx.text);
  const names = findMinisterNames(ctx.text);
  const position = findPosition(ctx.text) || "内阁大学士";
  const base = {
    command,
    command_name: command === "appoint" ? "任命大臣" : command === "dismiss" ? "罢免大臣" : "处置大臣",
    target_type: "minister",
    target_name: names[0] || "",
    value_name: command === "appoint" ? position : "",
    value: command === "appoint" ? position : "",
    unit: "",
  };
  return fillFromSchema(itemSchema, ctx, base);
}

/**
 * 按 schema 生成一个对象；presets 中的值优先使用
 */
function fillFromSchema(schema, ctx, presets = {}) {
  if (!schema || typeof schema !== "object") return {};
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];

  const type = schema.type || (schema.properties ? "object" : Array.isArray(schema.enum) ? "string" : undefined);

  if (type === "object" || schema.properties) {
    const out = {};
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in presets) { out[key] = presets[key]; continue; }
      out[key] = fillValue(key, propSchema, ctx, required.has(key));
    }
    // required 但 properties 中未声明的字段，给一个空字符串兜底
    for (const key of required) {
      if (!(key in out)) out[key] = "";
    }
    return out;
  }

  return fillValue("value", schema, ctx, false);
}

function fillValue(key, propSchema, ctx, isRequired) {
  if (!propSchema || typeof propSchema !== "object") return "";
  if (propSchema.enum && propSchema.enum.length > 0) return propSchema.enum[0];
  if (propSchema.const !== undefined) return propSchema.const;
  if (propSchema.default !== undefined) return propSchema.default;

  const type = Array.isArray(propSchema.type) ? propSchema.type[0] : propSchema.type;

  switch (type) {
    case "string":
      return synthString(key, propSchema, ctx);
    case "integer":
    case "number":
      return synthNumber(key);
    case "boolean":
      return false;
    case "array": {
      const items = propSchema.items || {};
      const itemProps = items.properties || {};
      // 指令列表（含 command 字段）→ 从文本解析任命/罢免指令
      if ("command" in itemProps) {
        return [fillCommandItem(items, ctx)];
      }
      if (items.type === "object" || items.properties) {
        return [fillFromSchema(items, ctx)];
      }
      return [];
    }
    case "object":
      return fillFromSchema(propSchema, ctx);
    default:
      // 未声明类型：有 properties 按对象处理，否则按字符串
      if (propSchema.properties) return fillFromSchema(propSchema, ctx);
      return isRequired ? synthString(key, propSchema, ctx) : "";
  }
}

/**
 * 主入口：为游戏的 tool 定义合成参数
 *
 * @param {Object} toolDef — OpenAI function 定义 { name, description, parameters }
 * @param {Array} messages — 游戏发来的消息列表
 * @returns {Object} 合成后的参数对象
 */
function synthesizeToolArguments(toolDef, messages) {
  const text = (messages || [])
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  const ctx = { text };
  const params = toolDef?.parameters || {};
  const args = fillFromSchema(params, ctx);
  return args;
}

module.exports = { synthesizeToolArguments, generateReportText };
