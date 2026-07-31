/** 提取消息文本（兼容 OpenAI 多模态 content 数组格式） */
function textOf(m) {
  if (!m || m.content == null) return "";
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("\n");
  }
  return "";
}

function scoreText(text, model = "") {
  const edictKW = ["诏书", "奉天承运", "颁布", "赈灾", "拨款", "加征", "加税", "加饷", "辽饷", "剿饷", "练饷", "募兵", "调兵", "水利", "城防", "戒严", "反腐", "吏治", "流民", "议和", "币制", "诛杀", "处死", "下狱", "罢免", "流放", "赦免", "提拔", "清洗", "铲除", "朕决定"];
  const courtKW = ["廷议", "朝议", "爱卿", "诸卿", "众卿", "内阁会议", "议政", "朝堂", "廷对", "集议", "廷辩", "奏对", "朝会", "会推"];
  const npcKW = ["魏忠贤", "崔呈秀", "袁崇焕", "孙承宗", "温体仁", "洪承畴", "钱谦益", "徐光启", "房壮丽", "大学士", "尚书", "总督", "巡抚", "将军", "臣以为"];
  // 注意：不要放"司礼监/秉笔"——那是魏忠贤的职位，会把 NPC 对话误判成润色
  const refineKW = ["润色", "拟旨", "起草", "奉天承运皇帝诏曰", "敕曰"];
  // Endgame keywords
  const endgameKW = ["结局", "末年", "国破", "殉国", "覆亡", "煤山", "遗诏", "罪己诏"];

  const scores = {
    edict: edictKW.filter((k) => text.includes(k)).length,
    court: courtKW.filter((k) => text.includes(k)).length,
    npc: npcKW.filter((k) => text.includes(k)).length,
    refine: refineKW.filter((k) => text.includes(k)).length,
    endgame: endgameKW.filter((k) => text.includes(k)).length,
    simulation: 0,
  };

  // Prioritize refine/endgame over edict when both match
  if (scores.refine > 0) scores.refine += 3;
  if (scores.endgame > 0) scores.endgame += 3;
  // Model hint: boost matching model role
  if (model === "cz-npc" && scores.npc > 0) scores.npc += 2;
  if (model === "cz-court" && scores.court > 0) scores.court += 2;
  if (model === "cz-edict" && scores.edict > 0) scores.edict += 2;

  const specificScore = scores.edict + scores.court + scores.npc;
  scores.simulation = specificScore === 0 ? 1 : 0;
  // 游戏推演请求用 cz-simulate 模型，文本常无关键词——给它额外权重，
  // 防止兜底计分被历史消息里的诏书关键词带偏
  if (model === "cz-simulate" && scores.simulation > 0) scores.simulation += 2;

  const max = Math.max(...Object.values(scores));
  const scenario = Object.entries(scores).find(([, s]) => s === max)?.[0] || "simulation";
  return { scenario, scores, max };
}

function identifyScenario(messages, model = "") {
  // 主计分：只对最后一条 user 消息——避免历史对话里的关键词
  // (司礼监、殉国、结局等) 永久累积污染路由
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const primaryText = textOf(lastUser);

  let { scenario, scores, max } = scoreText(primaryText, model);

  // 兜底：最后一条 user 消息没有任何关键词时，才对全部消息计分
  // (有些请求把场景上下文放在 system/assistant 消息里)
  if (max === 0 || (scenario === "simulation" && scores.simulation === 1)) {
    const allText = messages.map(textOf).join("\n");
    const fallback = scoreText(allText, model);
    if (fallback.max > 0 && fallback.scenario !== "simulation") {
      scenario = fallback.scenario;
      scores = fallback.scores;
      max = fallback.max;
    }
  }

  // cz-simulate 模型只绑定 simulate_model 角色，是最可靠的路由信号。
  // 推演 prompt 里满是官职词（尚书/总督，易被误判 npc）和引用的诏书原文
  // （"奉天承运皇帝诏曰"，易被误判 refine）——此时信任模型而非关键词。
  // endgame 保留关键词优先（结局模板输出差异太大，不能误强制）。
  if (model === "cz-simulate" && scenario !== "endgame" && scenario !== "simulation") {
    console.log(`  [router] model override: ${scenario} → simulation (${model})`);
    scenario = "simulation";
  }

  if (max > 0) {
    console.log(`  [router] ${scenario} (e:${scores.edict} c:${scores.court} n:${scores.npc} s:${scores.simulation})`);
  }

  return scenario;
}

module.exports = { identifyScenario };
