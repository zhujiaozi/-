/**
 * AI 战略顾问
 *
 * 分析帝国整体状况，生成战略建议。
 * proxy 模式：LLM 深度分析
 * deterministic 模式：阈值模板分析
 */

const { gameState } = require("../state/game-state");
const { FACTIONS } = require("../causality/faction-engine");
const { characterRegistry } = require("../characters/registry");
const { proxyRequest } = require("../llm/proxy");

/**
 * 收集战略分析所需的全部上下文
 */
function buildContext(state, worldVars, factions, fates, relationships, retriever) {
  const e = state.economy;
  const m = state.military;
  const t = state.turn;
  const v = worldVars;

  // 党派分析
  const factionInfo = Object.entries(factions).map(([key, f]) => {
    const def = FACTIONS[key];
    const dominance = f.power > 80 ? "[DOMINANT]" : f.power > 60 ? "[RISING]" : "";
    const loyal = f.loyalty < 25 ? "[DISLOYAL]" : "";
    return `  ${def.name}: 势力${f.power} 影响${f.influence} 忠诚${f.loyalty} ${dominance}${loyal}`;
  }).join("\n");

  // NPC 状态摘要
  const npcSummary = [];
  for (const name of characterRegistry.listNames()) {
    const fate = fates.get(name);
    const rel = relationships.get(name);
    if (!fate || fate.status === "alive") continue;
    npcSummary.push(`  ${name}: ${fate.status} ${rel ? `(关系:${rel.score})` : ""}`);
  }

  // 趋势分析（基于历史回合）
  const trends = state.performanceHistory || [];

  return {
    turn: t,
    economy: {
      treasury: Math.floor(Number(e.treasury) || 0),
      privyPurse: Math.floor(Number(e.privyPurse) || 0),
      popularSupport: Number(e.popularSupport) || 0,
      corruption: Number(e.corruption) || 0,
      imperialAuthority: Number(e.imperialAuthority) || 0,
      currencySupply: Number(e.currencySupply) || 0,
    },
    military: {
      totalTroops: Number(m.totalTroops) || 0,
      morale: Number(m.morale) || 0,
      rebellionLevel: Number(m.rebellionLevel) || 0,
      borderStatus: m.borderStatus || "unknown",
    },
    world: {
      borderTension: Number(v.borderTension) || 0,
      famineIndex: Number(v.famineIndex) || 0,
      plagueLevel: Number(v.plagueLevel) || 0,
      factionStability: Number(v.factionStability) || 0,
      rebelMomentum: Number(v.rebelMomentum) || 0,
      qingAggression: Number(v.qingAggression) || 0,
    },
    factions: factionInfo,
    npcStatuses: npcSummary,
    recentEdicts: (state.edictHistory || []).slice(-3).map(h => h.content.slice(0, 80)),
    trends,
  };
}

/**
 * 评估整体状况等级
 */
function assessOverallStatus(ctx) {
  const e = ctx.economy;
  const m = ctx.military;
  const w = ctx.world;

  let dangerScore = 0;
  const ps = Number(e.popularSupport) || 0;
  const corr = Number(e.corruption) || 0;
  const ia = Number(e.imperialAuthority) || 0;
  const tr = Number(e.treasury) || 0;

  if (ps < 25) dangerScore += 3;
  else if (ps < 45) dangerScore += 1;

  if (corr > 70) dangerScore += 2;
  else if (corr > 55) dangerScore += 1;

  if (ia < 30) dangerScore += 3;
  else if (ia < 50) dangerScore += 1;

  if (tr < 300000) dangerScore += 2;
  else if (tr < 800000) dangerScore += 1;

  if (Number(m.rebellionLevel) > 60) dangerScore += 2;
  if (Number(w.borderTension) > 75) dangerScore += 2;
  if (Number(w.famineIndex) > 60) dangerScore += 1;
  if (Number(w.plagueLevel) > 65) dangerScore += 1;
  if (Number(w.factionStability) < -50) dangerScore += 2;
  if (Number(w.qingAggression) > 70) dangerScore += 1;

  if (dangerScore >= 10) return { level: "崩", label: "帝国危在旦夕", severity: "critical" };
  if (dangerScore >= 6) return { level: "危", label: "局势严峻，需立即行动", severity: "major" };
  if (dangerScore >= 3) return { level: "稳", label: "勉强维持，不可松懈", severity: "moderate" };
  return { level: "优", label: "局势尚可，当居安思危", severity: "stable" };
}

/**
 * 识别最危险的变量
 */
function findTopThreats(ctx) {
  const threats = [];
  const w = ctx.world;
  const e = ctx.economy;

  const bt = Number(w.borderTension) || 0;
  const rm = Number(w.rebelMomentum) || 0;
  const fi = Number(w.famineIndex) || 0;
  const pl = Number(w.plagueLevel) || 0;
  const fs = Number(w.factionStability) || 0;
  const ps = Number(e.popularSupport) || 0;
  const ia = Number(e.imperialAuthority) || 0;

  // 统一紧急度：越高越危险。
  // 高阈值变量（越高越糟）urgency = current/threshold；
  // 低阈值变量（民心/皇权，越低越糟）urgency = threshold/current；
  // 朝堂稳定是同号负数，current/threshold 本身就是递增的。
  if (bt > 65) {
    threats.push({
      var: "边境紧张度",
      current: bt,
      threshold: 85,
      urgency: bt / 85,
      warning: bt > 80 ? "清军随时可能大举入侵" : "边境局势持续恶化",
      suggestion: "加强边防或遣使议和",
    });
  }
  if (rm > 55) {
    threats.push({
      var: "农民军势头",
      current: rm,
      threshold: 70,
      urgency: rm / 70,
      warning: "流寇日益猖獗，威胁地方州县",
      suggestion: "赈灾安抚民心，或派兵进剿",
    });
  }
  if (fi > 50) {
    threats.push({
      var: "饥荒指数",
      current: fi,
      threshold: 70,
      urgency: fi / 70,
      warning: "粮食短缺引发社会动荡",
      suggestion: "开仓赈灾、推广甘薯等高产作物",
    });
  }
  if (pl > 55) {
    threats.push({
      var: "瘟疫等级",
      current: pl,
      threshold: 75,
      urgency: pl / 75,
      warning: "疫情可能爆发",
      suggestion: "加强防疫，准备医药",
    });
  }
  if (fs < -40) {
    threats.push({
      var: "朝堂稳定",
      current: fs,
      threshold: -70,
      urgency: fs / -70,
      warning: "党派斗争白热化，朝政难以运转",
      suggestion: "平衡各派势力，避免一家独大",
    });
  }
  if (ps < 40) {
    threats.push({
      var: "民心",
      current: ps,
      threshold: 25,
      urgency: ps > 0 ? 25 / ps : 99,
      warning: "民心不稳，民变风险增加",
      suggestion: "减税赈灾，争取民心",
    });
  }
  if (ia < 45) {
    threats.push({
      var: "皇权",
      current: ia,
      threshold: 30,
      urgency: ia > 0 ? 30 / ia : 99,
      warning: "皇帝权威下降，政令难行",
      suggestion: "打压过强的党派，收回权力",
    });
  }

  // 按紧急度降序，取最危急的三项（原为升序——留下的是离阈值最远的）
  return threats.sort((a, b) => b.urgency - a.urgency).slice(0, 3);
}

/**
 * Deterministic 模式：基于阈值模板生成分析
 */
function generateTemplateAnalysis(ctx) {
  const status = assessOverallStatus(ctx);
  const threats = findTopThreats(ctx);
  const e = ctx.economy;
  const m = ctx.military;
  const w = ctx.world;
  const t = ctx.turn;

  const treasury = Number(e.treasury) || 0;
  const popSupport = Number(e.popularSupport) || 0;
  const impAuth = Number(e.imperialAuthority) || 0;
  const corruption = Number(e.corruption) || 0;

  const lines = [
    `━━━ 帝国战略分析 ━━━`,
    `状况评估: 【${status.level}】${status.label}`,
    "",
  ];

  // 关键指标
  lines.push("【关键指标】");
  lines.push(`  国库: ${Math.floor(treasury).toLocaleString()} 两 ${treasury < 300000 ? "⚠ 严重不足" : treasury < 800000 ? "⚠ 偏低" : ""}`);
  lines.push(`  民心: ${popSupport.toFixed(1)}/100 ${popSupport < 35 ? "⚠ 危险" : ""}`);
  lines.push(`  皇权: ${impAuth.toFixed(1)}/100 ${impAuth < 45 ? "⚠ 削弱" : ""}`);
  lines.push(`  腐败: ${corruption.toFixed(1)}/100 ${corruption > 60 ? "⚠ 严重" : ""}`);
  lines.push("");

  // 威胁分析
  if (threats.length > 0) {
    lines.push("【主要威胁】");
    for (const threat of threats) {
      const pct = Math.round(threat.urgency * 100);
      lines.push(`  ${threat.var}: ${threat.current.toFixed(0)}（警戒 ${threat.threshold}，危急度 ${pct}%）→ ${threat.warning}`);
    }
    lines.push("");
  }

  // 党派分析
  lines.push("【朝堂局势】");
  if (typeof ctx.factions === "string") {
    lines.push(ctx.factions);
  }
  lines.push("");

  // 建议
  lines.push("【辅臣建言】");
  const suggestions = [];

  if (treasury < 300000) suggestions.push("国库空虚，当务之急是开源节流。可适当加税或裁减冗员。");
  if (corruption > 55) suggestions.push("吏治腐败已到非整治不可的地步。请下旨严查贪腐。");
  if (popSupport < 35) suggestions.push("民心不稳，请考虑减税、赈灾或大赦天下。");
  if (Number(m.rebellionLevel) > 40) suggestions.push("流寇势大，需派得力将领前往剿抚。");
  if (Number(w.borderTension) > 70) suggestions.push("边境危急，请加强边防并考虑与清军议和。");

  if (suggestions.length === 0) {
    suggestions.push("局势暂时平稳。建议继续巩固国力，未雨绸缪。");
  }

  if (Number(w.famineIndex) > 55) {
    suggestions.push("徐光启曾推广甘薯，亩产远高于传统作物。可下旨在北方各省推广种植。");
  }
  if (treasury < 500000 && corruption > 50) {
    suggestions.push("万历年间张居正的考成法曾有效提升税收效率，可参考推行。");
  }

  lines.push(...suggestions.map((s, i) => `  ${i + 1}. ${s}`));
  lines.push("");

  // 命运预警
  if (ctx.npcStatuses && ctx.npcStatuses.length > 0) {
    lines.push("【朝臣动态】");
    for (const s of ctx.npcStatuses) {
      lines.push(`  ${s}`);
    }
    lines.push("");
  }

  lines.push(`━━━ ${t.display} ━━━`);

  return lines.join("\n");
}

/**
 * Proxy 模式：LLM 深度战略分析
 */
async function generateLLMAnalysis(ctx) {
  const e = ctx.economy;
  const m = ctx.military;
  const w = ctx.world;
  const t = ctx.turn;

  const prompt = `[Strategic Analysis Task]
You are the Grand Secretary of the Ming Empire. Analyze the current state of the empire and provide strategic advice to the Chongzhen Emperor. Respond in Chinese.

Current Turn: ${t.display} (Turn ${t.number})

**Economy:**
- Treasury: ${Math.floor(e.treasury).toLocaleString()} taels
- Popular Support: ${e.popularSupport.toFixed(1)}/100
- Corruption: ${e.corruption.toFixed(1)}/100
- Imperial Authority: ${e.imperialAuthority.toFixed(1)}/100

**Military:**
- Troops: ${m.totalTroops.toLocaleString()}
- Morale: ${m.morale.toFixed(1)}/100
- Rebel Activity: ${m.rebellionLevel.toFixed(1)}/100

**World Situation:**
- Border Tension: ${w.borderTension.toFixed(0)}/100 (Invasion threshold: 85)
- Famine Index: ${w.famineIndex.toFixed(0)}/100 (Crisis threshold: 70)
- Plague Level: ${w.plagueLevel.toFixed(0)}/100 (Outbreak threshold: 75)
- Court Stability: ${w.factionStability.toFixed(0)}/100 (negative = unstable, coup risk at -70)
- Rebel Momentum: ${w.rebelMomentum.toFixed(0)}/100 (Critical at 70)
- Qing Aggression: ${w.qingAggression.toFixed(0)}/100 (Major offensive at 70)

**Faction Power:**
${ctx.factions || "No faction data"}

**Recent Edicts:**
${ctx.recentEdicts.length > 0 ? ctx.recentEdicts.map((h, i) => `${i + 1}. ${h}`).join("\n") : "None yet"}

**NPC Status Changes:**
${ctx.npcStatuses.length > 0 ? ctx.npcStatuses.join("\n") : "All NPCs are in normal status"}

**Instructions:**
1. Give an overall assessment in one sentence (use 优/稳/危/崩 scale).
2. Identify the 2 most critical threats facing the empire right now.
3. Provide 2-3 specific, actionable recommendations. Be concrete — mention specific policies, factions, or NPCs.
4. Keep the analysis concise (under 300 characters total).
5. Write in the voice of a loyal Ming dynasty grand secretary. Use classical Chinese court language.`;

  const messages = [
    { role: "system", content: "You are the Grand Secretary of the Ming Empire, advising the Chongzhen Emperor. Be historically accurate, concise, and specific. Respond in Chinese." },
    { role: "user", content: prompt },
  ];

  try {
    const result = await proxyRequest(messages, null, null, { maxToolRounds: 0 });
    if (result) return result;
  } catch (err) {
    console.log("[StrategicAdvisor] LLM analysis failed, using template:", err.message);
  }
  return null;
}

/**
 * 主入口：生成战略分析
 * @param {object} ctx - { gameState, worldState, factionEngine, fateEngine, relationshipTracker }
 * @returns {string} 分析文本
 */
async function generateStrategicAnalysis(ctx) {
  const state = gameState.getState();
  const worldVars = ctx.worldState.getState();
  const factions = ctx.factionEngine.getState();
  const fates = ctx.fateEngine;
  const relationships = ctx.relationshipTracker;

  const analysisCtx = buildContext(state, worldVars, factions, fates, relationships);

  // 尝试 LLM 分析
  const llmResult = await generateLLMAnalysis(analysisCtx);
  if (llmResult) {
    return `━━━ 内阁战略奏报 ━━━\n\n${llmResult}\n\n━━━ ${state.turn.display} ━━━`;
  }

  // Fallback 到模板
  return generateTemplateAnalysis(analysisCtx);
}

module.exports = { generateStrategicAnalysis, generateTemplateAnalysis, buildContext, assessOverallStatus, findTopThreats };
