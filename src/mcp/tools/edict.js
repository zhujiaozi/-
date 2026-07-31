/**
 * 圣旨效果计算工具
 *
 * 核心机制: 每个决策类型有基础效果矩阵,
 * 强度档位(intensity)乘以系数, 效果含 +/-15% 随机波动
 */
const { gameState } = require("../../state/game-state");

/**
 * 单决策效果矩阵
 * key: 决策类型
 * value: { treasury, popularSupport, corruption, imperialAuthority, currencySupply, troops, morale }
 * 正数=增加, 负数=减少
 */
const EFFECT_MATRIX = {
  relief: {
    label: "赈灾",
    base: { treasury: -80000, popularSupport: 4, corruption: -2 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
  taxIncrease: {
    label: "加征税饷",
    base: { treasury: 120000, popularSupport: -7, corruption: 2, imperialAuthority: -1 },
    intensity: { low: 0.5, normal: 1.0, high: 1.8 },
  },
  taxDecrease: {
    label: "减免税赋",
    base: { treasury: -60000, popularSupport: 6, corruption: -1 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
  antiCorruption: {
    label: "整顿吏治",
    base: { treasury: -10000, corruption: -8, imperialAuthority: -3, popularSupport: 1 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
  recruit: {
    label: "招募兵员",
    base: { treasury: -100000, troops: 5000, popularSupport: -2, morale: -5 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
  deployTroops: {
    label: "出兵征讨",
    base: { treasury: -60000, morale: 5, popularSupport: -1, rebellionLevel: -8 },
    intensity: { low: 0.5, normal: 1.0, high: 1.8 },
  },
  irrigation: {
    label: "兴修水利",
    base: { treasury: -45000, popularSupport: 2 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
  fortify: {
    label: "加固城防",
    base: { treasury: -55000 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
  peaceTalks: {
    label: "议和",
    base: { treasury: 30000, imperialAuthority: -3, popularSupport: -1 },
    intensity: { low: 0.5, normal: 1.0, high: 1.5 },
  },
  appeaseRefugees: {
    label: "安抚流民",
    base: { treasury: -40000, popularSupport: 5, rebellionLevel: -5 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
  roadMaintenance: {
    label: "维护道路",
    base: { treasury: -25000, popularSupport: 1 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
  currency: {
    label: "币制改革",
    base: { treasury: -50000, currencySupply: 8, corruption: -1 },
    intensity: { low: 0.5, normal: 1.0, high: 1.5 },
  },
  reward: {
    label: "赏赐笼络",
    base: { privyPurse: -30000, imperialAuthority: 3 },
    intensity: { low: 0.5, normal: 1.0, high: 3.0 },
  },
  martialLaw: {
    label: "执行戒严",
    base: { popularSupport: -4, corruption: -2, rebellionLevel: -10 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
  routine: {
    label: "例行政务",
    base: { treasury: -5000 },
    intensity: { low: 0.5, normal: 1.0, high: 1.0 },
  },
  clearEunuchs: {
    label: "清洗阉党",
    base: { treasury: -30000, corruption: -10, imperialAuthority: 8, popularSupport: 5 },
    intensity: { low: 0.3, normal: 1.0, high: 2.5 },
  },
  militaryReform: {
    label: "军事改革",
    base: { treasury: -120000, troops: -3000, morale: 10, corruption: -5, rebellionLevel: 3 },
    intensity: { low: 0.5, normal: 1.0, high: 2.0 },
  },
};

/**
 * 计算圣旨决策效果
 */
async function calculateEdictEffect(args = {}) {
  const decisions = args.decisions || [];
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return { error: "请提供至少一个决策", example: [{ type: "relief", intensity: "normal" }] };
  }

  const summary = {
    treasury: 0, privyPurse: 0, popularSupport: 0,
    corruption: 0, imperialAuthority: 0, currencySupply: 0,
    troops: 0, morale: 0, rebellionLevel: 0,
  };

  const detailResults = [];
  const warnings = [];

  for (const decision of decisions) {
    const matrix = EFFECT_MATRIX[decision.type];
    if (!matrix) {
      warnings.push(`未知决策类型: "${decision.type}"，已跳过`);
      continue;
    }

    const intensity = decision.intensity || "normal";
    const multiplier = matrix.intensity[intensity] || 1.0;
    const effects = {};

    for (const [key, baseValue] of Object.entries(matrix.base)) {
      const actualValue = Math.round(baseValue * multiplier * (1 + (Math.random() - 0.5) * 0.3)); // +/-15% 随机波动
      effects[key] = actualValue;
      if (summary[key] !== undefined) {
        summary[key] += actualValue;
      }
    }

    detailResults.push({
      type: decision.type,
      label: matrix.label,
      intensity,
      multiplier,
      effects,
    });
  }

  // 财政预警
  const state = gameState.getState();

  // 国库不足警告
  if (state.economy.treasury + summary.treasury < 0) {
    warnings.push(`[财政警告] 国库资金不足以支持全部支出: 当前国库 ${Math.floor(state.economy.treasury).toLocaleString()} 两，总支出 ${Math.floor(-summary.treasury).toLocaleString()} 两，差额部分将无法执行。`);
  }

  return {
    summary,
    details: detailResults,
    warnings,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 将圣旨效果格式化为游戏文本报告
 */
async function formatEdictResult(args = {}) {
  const { effects } = args;
  if (!effects || !effects.summary) {
    return { error: "无效的效果数据" };
  }

  const s = effects.summary;
  const lines = [];

  lines.push("## 圣旨执行效果报告\n");

  // 经济
  const econChanges = [];
  if (s.treasury !== 0) econChanges.push(`国库 ${s.treasury >= 0 ? "+" : ""}${Math.floor(s.treasury).toLocaleString()} 两`);
  if (s.privyPurse !== 0) econChanges.push(`内帑 ${s.privyPurse >= 0 ? "+" : ""}${Math.floor(s.privyPurse).toLocaleString()} 两`);
  if (s.currencySupply !== 0) econChanges.push(`货币 ${s.currencySupply >= 0 ? "+" : ""}${s.currencySupply.toFixed(1)}`);
  if (econChanges.length > 0) lines.push(`【经济影响】 ${econChanges.join("，")}`);

  // 政治
  const polChanges = [];
  if (s.popularSupport !== 0) polChanges.push(`民心 ${s.popularSupport >= 0 ? "+" : ""}${s.popularSupport.toFixed(1)}`);
  if (s.corruption !== 0) polChanges.push(`腐败 ${s.corruption >= 0 ? "+" : ""}${s.corruption.toFixed(1)}`);
  if (s.imperialAuthority !== 0) polChanges.push(`皇权 ${s.imperialAuthority >= 0 ? "+" : ""}${s.imperialAuthority.toFixed(1)}`);
  if (polChanges.length > 0) lines.push(`【政治影响】 ${polChanges.join("，")}`);

  // 军事
  const milChanges = [];
  if (s.troops !== 0) milChanges.push(`兵力 ${s.troops >= 0 ? "+" : ""}${s.troops.toLocaleString()} 人`);
  if (s.morale !== 0) milChanges.push(`士气 ${s.morale >= 0 ? "+" : ""}${s.morale.toFixed(1)}`);
  if (s.rebellionLevel !== 0) milChanges.push(`叛乱活跃度 ${s.rebellionLevel >= 0 ? "+" : ""}${s.rebellionLevel.toFixed(1)}`);
  if (milChanges.length > 0) lines.push(`【军事影响】 ${milChanges.join("，")}`);

  if (effects.details) {
    lines.push("\n### 逐项效果明细");
    for (const d of effects.details) {
      const effStrs = Object.entries(d.effects)
        .filter(([, v]) => v !== 0)
        .map(([k, v]) => `${k}: ${v >= 0 ? "+" : ""}${typeof v === "number" ? v.toFixed ? v.toFixed(1) : v : v}`);
      lines.push(`- **${d.label}** (${d.intensity === "high" ? "强力" : d.intensity === "low" ? "轻度" : "标准"}): ${effStrs.join(", ") || "无明显影响"}`);
    }
  }

  if (effects.warnings && effects.warnings.length > 0) {
    lines.push("\n### [警告]");
    for (const w of effects.warnings) lines.push(`- ${w}`);
  }

  return { formattedText: lines.join("\n"), rawSummary: s };
}

module.exports = { calculateEdictEffect, formatEdictResult, EFFECT_MATRIX };
