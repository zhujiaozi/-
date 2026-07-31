require("./env-loader").load();

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const config = require("./config");
const { registry, injectDependencies: injectMcpDeps } = require("./mcp/registry");
const { getFilteredOpenAIFunctions, getVisibleTools, generateGuardrailPrompt, sanitizeUserInput } = require("./mcp/permissions");
const { retriever } = require("./rag/retriever");
const { characterRegistry } = require("./characters/registry");
const { gameState } = require("./state/game-state");
const { identifyScenario } = require("./router");
const { sessionManager } = require("./memory/session-manager");
const { archiveManager } = require("./archive/archive-manager");
const { RelationshipTracker } = require("./causality/relationship");
const { WorldState } = require("./causality/world-state");
const { FateEngine } = require("./causality/fate-engine");
const { FactionEngine, FACTIONS } = require("./causality/faction-engine");
const { generateFateContext } = require("./causality/fate-context");
const { proxyRequest } = require("./llm/proxy");
const { generateStrategicAnalysis } = require("./analysis/strategic-advisor");
const { generateAgenda, getRelevantWorldVars } = require("./characters/npc-agenda");
const { getStats, resetStats, estimateTokens, optimizeSystemPrompt } = require("./llm/token-budget");
const { injectNpcEasterEgg, injectReportFlavor } = require("./narrative/easter-eggs");

// 全局因果关系系统
const relationshipTracker = new RelationshipTracker();
const worldState = new WorldState();
const fateEngine = new FateEngine();
const factionEngine = new FactionEngine();

const { Persistence } = require("./state/persistence");
const { dynamicEntities } = require("./state/dynamic-entities");

// Wire dependencies into MCP registry
injectMcpDeps({
  retriever, relationshipTracker, worldState, fateEngine, factionEngine,
  characterRegistry,
});

// Init persistence (auto-restore on startup, auto-save on change)
const persistence = new Persistence({
  sessionManager, gameState, relationshipTracker, worldState, fateEngine, factionEngine,
});

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.text({ type: "text/*", limit: "2mb" }));

app.use((req, res, next) => {
  if (req.path !== "/health") {
    const ts = new Date().toISOString().split("T")[1].slice(0, 12);
    console.log(`[${ts}] ${req.method} ${req.path}`);
  }
  next();
});

app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "cz-rules-v1", object: "model", created: 1728000000, owned_by: "cz-rules-engine" },
      { id: "cz-edict", object: "model", created: 1728000000, owned_by: "cz-rules-engine" },
      { id: "cz-npc", object: "model", created: 1728000000, owned_by: "cz-rules-engine" },
      { id: "cz-court", object: "model", created: 1728000000, owned_by: "cz-rules-engine" },
      { id: "cz-simulate", object: "model", created: 1728000000, owned_by: "cz-rules-engine" },
    ],
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", engine: "cz-rules-engine", version: "2.1.0", uptime: process.uptime() });
});

// Token budget & cost tracking
app.get("/v1/token-stats", (_req, res) => {
  const stats = getStats();
  res.json(stats);
});

app.post("/v1/token-reset", (_req, res) => {
  resetStats();
  res.json({ reset: true });
});

app.post("/v1/chat/completions", async (req, res) => {
  const rid = uuidv4().slice(0, 8);
  const { model = "cz-rules-v1", messages = [], stream = false, tool_choice, tools: requestTools } = req.body;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`[${rid}] ${model} | ${messages.length}msg | stream:${stream} | tool_choice:${tool_choice || "none"}`);

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    console.log(`[${rid}] user: ${lastUser.content.slice(0, 150)}`);
  }

  try {
    gameState.extractFromMessages(messages);
    const scenario = identifyScenario(messages, model);

    const historyContext = await retriever.getContextForPrompt(
      messages.map((m) => m.content || "").join(" "), 2
    );

    // Input sanitization — detect injection attempts
    const lastMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastMsg) {
      lastMsg.content = sanitizeUserInput(lastMsg.content);
    }

    // MCP tools: unified (cache-friendly) or scenario-filtered (token-saving)
    const useUnifiedTools = process.env.CZ_CACHE_MODE === "unified";
    const mcpToolDefs = useUnifiedTools
      ? registry.toOpenAIFunctions().filter(t => getVisibleTools("edict").includes(t.function.name))
      : getFilteredOpenAIFunctions(scenario, registry);
    const mcpToolPrompt = registry.toPromptDescription();
    const guardrailPrompt = generateGuardrailPrompt(scenario);

    // Pre-fetch RAG for entities mentioned in user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    const userText = lastUserMsg?.content || "";

    // Fix RAG prefetch: only match 2-4 char Chinese names followed by title keywords
    const entityMatches = userText.match(/([一-鿿]{2,4})(先生|大儒|尚书|总督|巡抚|将军|名士)/g) || [];
    // 剥掉动词前缀（"为山海关巡抚"→"山海关巡抚"），过滤纯官职碎片
    const entities = [...new Set(entityMatches)]
      .map((e) => e.replace(/^(?:为|任|授|兼|领|拜|命|当前|着|令)/, ""))
      .filter((e) => {
        const namePart = e.replace(/(先生|大儒|尚书|总督|巡抚|将军|名士)$/, "");
        return namePart.length >= 2 && !/^(兵部|户部|吏部|礼部|刑部|工部|三省|山海关|辽东|陕西)$/.test(namePart);
      })
      .slice(0, 3);
    let preFetchedRag = "";
    for (const e of entities) {
      const r = await retriever.getContextForPrompt(`${e} 明朝 生平 事迹`, 1);
      if (r) preFetchedRag += r + "\n";
    }
    if (preFetchedRag) console.log(`[${rid}] RAG prefetch: ${entities.join(", ")}`);

    // Fix: strip incomplete tool_call history (DeepSeek rejects orphaned tool_calls)
    let cleanMessages = [...messages];
    let stripped = 0;
    for (let i = 0; i < cleanMessages.length; i++) {
      if (cleanMessages[i].role === "assistant" && cleanMessages[i].tool_calls) {
        const hasResult = cleanMessages.slice(i + 1).some(m => m.role === "tool");
        if (!hasResult) {
          cleanMessages = cleanMessages.slice(0, i);
          stripped = messages.length - cleanMessages.length;
        }
      }
    }
    if (stripped > 0) console.log(`[${rid}] Stripped ${stripped} orphaned tool call msgs`);

    let characterContext = "";
    const allText = messages.map((m) => m.content || "").join("");
    for (const name of characterRegistry.listNames()) {
      if (allText.includes(name)) {
        // NPC 对话用完整角色卡（含 mood/quirks/示例对话），
        // 其他场景用精简版（~200 chars，省 token）
        const char = characterRegistry.get(name);
        if (char) {
          characterContext = scenario === "npc" ? char.toSystemPrompt() : char.toCompactPrompt();
        }
        break;
      }
    }

    // ===== Scenario-specific context injection (works in BOTH proxy and deterministic) =====
    let scenarioContext = "";

    // NPC: inject mood + agenda + fate trajectory + speech quirks
    if (scenario === "npc") {
      let npcName = "Minister";
      for (const name of characterRegistry.listNames()) {
        if (allText.includes(name)) { npcName = name; break; }
      }
      const char = characterRegistry.get(npcName);
      // Mood — based on relationship score and fate status
      if (char) {
        const rel = relationshipTracker.get(npcName);
        const relScore = rel?.score || 0;
        const fate = fateEngine.get(npcName);
        let mood = "";
        if (relScore >= 70) mood = `心情极佳，对皇帝格外亲切热情`;
        else if (relScore >= 40) mood = `心情不错，态度友好恭敬`;
        else if (relScore <= -60) mood = `心情恶劣，对皇帝充满敌意和轻蔑`;
        else if (relScore <= -30) mood = `心绪不宁，态度冷淡疏远`;
        else if (fate.status !== "alive" && fate.status !== "promoted") mood = `心事重重，为自己的命运担忧`;
        if (mood) scenarioContext += `\n[Mood: ${mood}]`;
        if (char.speechQuirks?.length) {
          scenarioContext += `\n[Speech quirks: ${char.speechQuirks.slice(0, 3).join("; ")}]`;
        }
      }
      const agenda = generateAgenda(npcName, { worldState, relationshipTracker, fateEngine, factionEngine, npcMemory: null });
      if (agenda.length > 0) {
        scenarioContext += `\n[Current concerns]\n${agenda.map(a => `- ${a.topic}`).join("\n")}`;
      }
      const fateCtx = generateFateContext(npcName, relationshipTracker.get(npcName), worldState, null, gameState.getState());
      if (fateCtx) scenarioContext += `\n\n${fateCtx}`;
    }

    // Court: inject topic analysis + faction stances
    if (scenario === "court") {
      const topicMap = [
        { kw: "税|饷|赋|财|银|钱|国库", topic: "财政税赋" },
        { kw: "兵|辽东|边关|清军|后金|战|征讨", topic: "军事边防" },
        { kw: "贪|贿|吏治|考成|御史|弹劾", topic: "吏治反腐" },
        { kw: "灾|荒|饥|赈|粮|水利|河|漕运|农", topic: "民生赈济" },
        { kw: "党争|东林|阉党|宦官|厂卫", topic: "朝堂党争" },
        { kw: "科举|取士|书院|翰林|学政", topic: "科举取士" },
        { kw: "火器|火炮|历法|西学|洋", topic: "技术引进" },
        { kw: "盐|铁|茶|马|市舶|海禁|贸易|商", topic: "盐铁贸易" },
      ];
      let bestTopic = null, bestScore = 0;
      for (const t of topicMap) {
        const score = (allText.match(new RegExp(t.kw, "g")) || []).length;
        if (score > bestScore) { bestScore = score; bestTopic = t; }
      }
      if (bestTopic) {
        scenarioContext += `\n[Court topic: ${bestTopic.topic}]`;
        const factionReport = factionEngine.getReport();
        scenarioContext += `\n[Faction power]: 东林${factionReport.factions.find(f=>f.key==='donglin')?.power||45} 阉党${factionReport.factions.find(f=>f.key==='eunuch')?.power||35} 武将${factionReport.factions.find(f=>f.key==='militaryGroup')?.power||20}`;
        if (factionReport.recommendation) scenarioContext += `\n[Advisory]: ${factionReport.recommendation}`;
      }
    }

    // Fate warnings for any scenario involving NPCs
    const fateWarnings = [];
    for (const name of characterRegistry.listNames()) {
      if (allText.includes(name)) {
        const fate = fateEngine.get(name);
        if (fate && fate.status !== "alive") {
          fateWarnings.push(`${name}: ${fate.status}`);
        }
      }
    }
    if (fateWarnings.length > 0) {
      scenarioContext += `\n[NPC status]: ${fateWarnings.join(", ")}`;
    }

    // Simulate: inject world state + foreshadowing for LLM narration
    if (scenario === "simulate") {
      const wv = worldState.getState();
      scenarioContext += `\n\n[帝国态势 — 阈值供参考]
  边境紧张: ${wv.borderTension.toFixed(0)}/100(>85 入侵风险)
  饥荒指数: ${wv.famineIndex.toFixed(0)}/100(>70 饥荒危机)
  瘟疫等级: ${wv.plagueLevel.toFixed(0)}/100(>75 疫情爆发)
  朝堂安定: ${wv.factionStability.toFixed(0)}/100(<-70 政变风险)
  流寇势头: ${wv.rebelMomentum.toFixed(0)}/100(>70 大规模起义)
  清军威胁: ${wv.qingAggression.toFixed(0)}/100(>70 大规模进攻)
  [叙事引导] 以明代宫廷史官的笔法，用文言白话混合体撰写奏报。既要可观的数据，也要生动的叙事。像《万历野获编》的文风：平实中见机锋，琐细中见大局。`;
      // Add foreshadowing
      const foreshadowing = worldState.getForeshadowingText();
      if (foreshadowing) {
        scenarioContext += `\n\n[⚠ 当前预警]\n${foreshadowing}`;
      }
    }

    // Try LLM proxy first, fall back to deterministic
    let content;
    const state = gameState.getState();
    const stateContext = `[State] Turn:${state.turn.display} T:${Math.floor(state.economy.treasury).toLocaleString()}t PS:${state.economy.popularSupport.toFixed(0)} C:${state.economy.corruption.toFixed(0)} IA:${state.economy.imperialAuthority.toFixed(0)} Tr:${state.military.totalTroops.toLocaleString()} Reb:${state.military.rebellionLevel.toFixed(0)}`;

    let llmResponse = null;

    // Standard LLM path for all scenarios in proxy mode
    const promptParts = [
      guardrailPrompt,
      mcpToolPrompt ? `Tools:\n${mcpToolPrompt}` : "",
      dynamicEntities.getPromptContext() || "",
      `Scenario: ${scenario}. ${stateContext}`,
      characterContext || "",
      scenarioContext || "",
      historyContext || "",
      preFetchedRag || "",
      "Chinese response. Be historically accurate.",
    ];
    const systemPrompt = promptParts.filter(Boolean).join("\n\n");

    const estPromptTokens = estimateTokens(systemPrompt) + estimateTokens(cleanMessages);
    console.log(`[${rid}] Est prompt tokens: ${estPromptTokens} | scenario: ${scenario}`);

    const llmMessages = [
      { role: "system", content: systemPrompt },
      ...cleanMessages,
    ];

    // ===== 游戏自带工具的请求：纯透传 =====
    // 游戏的结构化流程（阶段二"落库"的 apply_* 工具、奏折生成、任命
    // 指令解析等）会在请求里携带自己的 tools。这些 tool_calls 必须
    // 原样回到游戏客户端，由客户端转发给官方后端执行——绝不能用
    // 我们的 MCP 工具替换，也不能在本地执行，否则游戏数据库永远
    // 收不到改动（这就是"内阁全部换掉但实际没生效"的原因）。
    const hasGameTools = requestTools && requestTools.length > 0 && tool_choice !== "none";
    if (hasGameTools) {
      const handled = await respondWithGameToolCall({
        res, rid, model, stream, toolChoice: tool_choice, requestTools,
        messages: cleanMessages, rawMessages: messages,
      });
      if (handled) return;
    }

    llmResponse = await proxyRequest(llmMessages, mcpToolDefs, registry, { maxToolRounds: 2 });

    if (llmResponse) {
      content = llmResponse;
      console.log(`[${rid}] LLM proxy response (${llmResponse.length} chars)`);
    } else {
      // Fallback to deterministic mode
      switch (scenario) {
        case "edict":
          content = await handleEdictScenario(messages, historyContext, rid);
          break;
        case "refine":
          content = await handleRefineScenario(messages, historyContext, rid);
          break;
        case "endgame":
          content = await handleEndgameScenario(messages, historyContext, rid);
          break;
        case "npc":
          content = await handleNpcScenario(messages, historyContext, rid);
          break;
        case "court":
          content = await handleCourtScenario(messages, historyContext, rid);
          break;
        default:
          content = await handleSimulateScenario(messages, historyContext, rid);
      }
    }

    const responseText = content;
    const promptTokens = messages.reduce((s, m) => s + (m.content?.length || 0), 0);

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const chunkId = `chatcmpl-${rid}`;
      const ts = Math.floor(Date.now() / 1000);
      let offset = 0;
      const chunkSize = 6;

      const sendChunk = () => {
        const chunk = responseText.slice(offset, offset + chunkSize);
        offset += chunkSize;
        const done = offset >= responseText.length;

        res.write(`data: ${JSON.stringify({
          id: chunkId, object: "chat.completion.chunk", created: ts, model,
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: done ? "stop" : null }],
        })}\n\n`);

        if (done) {
          res.write(`data: ${JSON.stringify({
            id: chunkId, object: "chat.completion.chunk", created: ts, model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: promptTokens, completion_tokens: responseText.length, total_tokens: promptTokens + responseText.length },
          })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          console.log(`[${rid}] SSE done (${responseText.length} chars)`);
        } else {
          setTimeout(sendChunk, 25 + Math.random() * 15);
        }
      };
      sendChunk();
    } else {
      res.json({
        id: `chatcmpl-${rid}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop" }],
        usage: { prompt_tokens: promptTokens, completion_tokens: responseText.length, total_tokens: promptTokens + responseText.length },
        // MCP metadata: scenario-filtered tools + guardrails
        mcp: {
          scenario,
          tools: mcpToolDefs.map((t) => t.function.name),
          toolDefinitions: mcpToolDefs,
          guardrail: guardrailPrompt,
        },
      });
      console.log(`[${rid}] JSON done (${responseText.length} chars)`);
    }
  } catch (err) {
    console.error(`[${rid}] error:`, err.message);
    res.status(500).json({ error: { message: "Internal rules engine error", type: "server_error" } });
  }
});

/**
 * 处理携带游戏自有工具的请求（纯透传）
 *
 * 游戏的两类结构化流程都会在请求里带 tools：
 *   1. tool_choice:"required"/指定函数 —— 奏折生成、任命指令解析等
 *      （客户端把 tool_calls 回传官方后端 finalize）
 *   2. tool_choice:"auto" —— 三阶段推演的"落库"阶段（apply_* 工具，
 *      客户端把 tool_calls 回传后端执行数据库变更）
 *
 * 无论哪类，tool_calls 都必须原样回到游戏客户端。本函数：
 *   1. proxy 模式：消息和游戏工具原样发给上游 LLM，其 tool_calls / content
 *      原样返回（绝不在本地执行游戏工具）
 *   2. deterministic 模式：仅强制 tool_choice 时按 schema 合成参数兜底；
 *      auto 时返回 false 走正常本地流程
 *
 * @returns {boolean} 是否已处理并发送响应
 */
async function respondWithGameToolCall({ res, rid, model, stream, toolChoice, requestTools, messages, rawMessages }) {
  const forced = toolChoice && toolChoice !== "none" && toolChoice !== "auto";
  const forcedName = typeof toolChoice === "object" ? toolChoice?.function?.name : null;
  const targetTool = (forcedName ? requestTools.find((t) => t.function?.name === forcedName) : null) || requestTools[0];
  const promptTokens = rawMessages.reduce((s, m) => s + (m.content?.length || 0), 0);

  const normalize = (tcs) => tcs.map((tc, i) => ({
    id: tc.id || `call_${rid}_${i}`,
    type: "function",
    function: {
      name: tc.function.name,
      arguments: typeof tc.function.arguments === "string"
        ? tc.function.arguments
        : JSON.stringify(tc.function.arguments ?? {}),
    },
  }));

  const sendToolCalls = (toolCalls) => {
    res.json({
      id: `chatcmpl-${rid}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: null, tool_calls: toolCalls },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: promptTokens, completion_tokens: 50, total_tokens: promptTokens + 50 },
    });
    console.log(`[${rid}] Tool call response: ${toolCalls.map((t) => t.function.name).join(", ")}`);
  };

  // 1) proxy 模式：纯透传给上游 LLM
  try {
    const { callLLM, resolveProvider } = require("./llm/proxy");
    if (resolveProvider()) {
      const resp = await callLLM(messages, requestTools, {
        toolChoice: toolChoice === true ? "required" : toolChoice || undefined,
        maxTokens: 8000,
        timeout: 240000,
      });
      if (resp && resp.toolCalls && resp.toolCalls.length > 0) {
        sendToolCalls(normalize(resp.toolCalls));
        return true;
      }
      if (resp && resp.content) {
        // 上游只回了文本（tool_choice:auto 时合法）——按普通响应返回
        console.log(`[${rid}] Passthrough content (${resp.content.length} chars)`);
        if (stream) {
          streamTextResponse(res, rid, model, resp.content, promptTokens);
        } else {
          res.json({
            id: `chatcmpl-${rid}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, message: { role: "assistant", content: resp.content }, finish_reason: "stop" }],
            usage: { prompt_tokens: promptTokens, completion_tokens: resp.content.length, total_tokens: promptTokens + resp.content.length },
          });
        }
        return true;
      }
      console.log(`[${rid}] Passthrough returned nothing — falling back`);
    }
  } catch (err) {
    console.log(`[${rid}] Tool passthrough failed: ${err.message}`);
  }

  // 2) deterministic 兜底：仅在游戏强制 tool call 时合成参数
  //    （auto 时伪造 apply_* 参数会把垃圾数据写进游戏数据库，宁缺毋滥）
  if (forced && targetTool?.function?.name) {
    const { synthesizeToolArguments } = require("./llm/tool-synth");
    const args = synthesizeToolArguments(targetTool.function, rawMessages);
    console.log(`[${rid}] Synthesized args for ${targetTool.function.name}: ${JSON.stringify(args).slice(0, 150)}`);
    sendToolCalls([{
      id: `call_${rid}`,
      type: "function",
      function: { name: targetTool.function.name, arguments: JSON.stringify(args) },
    }]);
    return true;
  }
  return false;
}

/** SSE 流式发送文本（供透传路径复用） */
function streamTextResponse(res, rid, model, text, promptTokens) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const chunkId = `chatcmpl-${rid}`;
  const ts = Math.floor(Date.now() / 1000);
  let offset = 0;
  const chunkSize = 6;
  const sendChunk = () => {
    const chunk = text.slice(offset, offset + chunkSize);
    offset += chunkSize;
    const done = offset >= text.length;
    res.write(`data: ${JSON.stringify({
      id: chunkId, object: "chat.completion.chunk", created: ts, model,
      choices: [{ index: 0, delta: { content: chunk }, finish_reason: done ? "stop" : null }],
    })}\n\n`);
    if (done) {
      res.write(`data: ${JSON.stringify({
        id: chunkId, object: "chat.completion.chunk", created: ts, model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: promptTokens, completion_tokens: text.length, total_tokens: promptTokens + text.length },
      })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      console.log(`[${rid}] SSE done (${text.length} chars)`);
    } else {
      setTimeout(sendChunk, 25 + Math.random() * 15);
    }
  };
  sendChunk();
}

async function handleEdictScenario(messages, historyContext, rid) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = lastUser?.content || "";

  const decisionKeywords = [
    { kw: "赈灾|救灾|赈济", type: "relief" },
    { kw: "加征|加税|加饷|辽饷", type: "taxIncrease" },
    { kw: "减税|免税|蠲免", type: "taxDecrease" },
    { kw: "募兵|征兵|招兵|扩军", type: "recruit" },
    { kw: "反腐|整顿吏治|查处|肃贪", type: "antiCorruption" },
    { kw: "水利|治水|修河", type: "irrigation" },
    { kw: "城防|加固|筑城", type: "fortify" },
    { kw: "调兵|出兵|征讨|进剿", type: "deployTroops" },
    { kw: "议和|和谈", type: "peaceTalks" },
    { kw: "安抚流民|救济难民", type: "appeaseRefugees" },
    { kw: "币制|铸钱|通货", type: "currency" },
    { kw: "赏赐|笼络|恩赏", type: "reward" },
    { kw: "戒严|宵禁|管制", type: "martialLaw" },
    { kw: "修路|道路|驿站", type: "roadMaintenance" },
  ];

  const decisions = [];
  for (const { kw, type } of decisionKeywords) {
    if (new RegExp(kw).test(text)) decisions.push({ type, intensity: "normal" });
  }
  if (decisions.length === 0) decisions.push({ type: "routine", intensity: "low" });

  console.log(`[${rid}] Edict decisions: ${decisions.map((d) => d.type).join(", ")}`);

  const { calculateEdictEffect, formatEdictResult } = require("./mcp/tools/edict");
  const { evaluateFactionReaction } = require("./mcp/tools/faction");
  const { checkHistoricalEvent } = require("./mcp/tools/history");

  // Faction assignment: each decision assigned to the best faction
  const factionAssignments = [];
  let totalBonus = 1.0;
  const factionChanges = [];

  for (const d of decisions) {
    const assignedFaction = factionEngine.assignFaction(d.type, text);
    const { multiplier, desc } = factionEngine.calculateExecutionBonus(d.type, assignedFaction);

    // Check if faction refuses
    if (factionEngine.checkRefusal(assignedFaction, d.type)) {
      factionAssignments.push({ decision: d.type, faction: assignedFaction, multiplier: 0, desc: `[REFUSED] ${FACTIONS[assignedFaction].name}拒绝对此政令进行执行` });
      continue;
    }

    factionAssignments.push({ decision: d.type, faction: assignedFaction, multiplier, desc });
    totalBonus += (multiplier - 1.0);

    // Apply faction effects
    const changes = factionEngine.applyExecutionEffects(assignedFaction, d.type, multiplier);
    factionChanges.push(...changes);
  }

  // Adjust decision effects by faction bonus
  const adjustedDecisions = decisions.map((d, i) => ({
    ...d,
    intensity: factionAssignments[i]?.multiplier > 1.2 ? "high"
              : factionAssignments[i]?.multiplier === 0 ? "low"
              : d.intensity,
  }));

  const calcResult = await calculateEdictEffect({ decisions: adjustedDecisions });
  const formatted = await formatEdictResult({ effects: calcResult });

  const factionLabels = { relief: "赈灾", taxIncrease: "加税", taxDecrease: "减税", recruit: "募兵", antiCorruption: "反腐", deployTroops: "出兵", peaceTalks: "议和", currency: "币制改革", reward: "赏赐" };
  const mainAction = decisions.find((d) => d.type !== "routine")?.type || "加税";
  const factionResult = await evaluateFactionReaction({ action: factionLabels[mainAction] || mainAction });

  gameState.modifyEconomy(calcResult.summary);
  gameState.modifyMilitary(calcResult.summary);

  // Apply causality: relationships, world state, fate
  const relChanges = relationshipTracker.applyEdictEffects(decisions, gameState.getTurn().number);
  const worldChanges = worldState.applyEdictEffects(decisions);
  worldState.tick();
  const dynamicEvents = worldState.checkEvents();
  const fateEvents = fateEngine.checkFates(relationshipTracker, worldState, text, gameState.getTurn().number);

  const event = await checkHistoricalEvent();
  gameState.advanceTurn();
  gameState.recordEdict(text.slice(0, 300));

  // Format dynamic events
  let eventsText = "";
  if (dynamicEvents.length > 0) {
    eventsText = "\n[World Events]\n" + dynamicEvents.map((e) => `${e.name}: ${e.desc}`).join("\n");
  }
  if (fateEvents.length > 0) {
    eventsText += "\n\n[NPC Fate Changes]\n" + fateEvents.map((e) => `${e.name}: ${e.desc}`).join("\n");
  }

  // Dynamic content creation
  const creationResults = dynamicEntities.processCommands(text);
  if (creationResults.commands.length > 0) {
    eventsText += "\n\n[Content Created]\n" + creationResults.commands.map((c) => `${c.type}: ${c.name}`).join("\n");
  }

  // AI Advisor Commentary
  const advisorCommentary = await generateEdictCommentary(decisions, factionAssignments, calcResult, factionResult);

  return [
    formatted.formattedText,
    "",
    "[Faction Execution]",
    ...factionAssignments.map((fa) => `  ${fa.desc}: ${FACTIONS[fa.faction]?.name || fa.faction}`),
    ...factionChanges.map((c) => `  ${c}`),
    "",
    "[Court Reaction]",
    factionResult.summary,
    ...factionResult.suggestions.filter(Boolean).map((s) => `  -> ${s}`),
    event.currentEvent ? `\n[Key Event: ${event.currentEvent.name}]\n${event.currentEvent.desc}` : "",
    eventsText,
    advisorCommentary ? `\n[内阁辅臣评议]\n${advisorCommentary}` : "",
    historyContext ? `\n${historyContext}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * 用 LLM 丰富世界事件描述（proxy 模式），增强叙事感
 */
async function enrichEventsWithLLM(events) {
  if (!events || events.length === 0) return events;

  try {
    const eventList = events.map(e => `${e.name}: ${e.desc}`).join("\n");
    const prompt = `Rewrite the following Ming dynasty historical events in a more vivid, dramatic narrative style. Use classical Chinese court chronicle language. Keep each event under 60 characters. Do NOT change any names or facts — only improve the literary quality.

Events:
${eventList}

Return each event as: EventName: NewDescription`;

    const { proxyRequest: pr } = require("./llm/proxy");
    const result = await pr([
      { role: "system", content: "You are a Ming dynasty court historian. Rewrite historical events vividly. Keep format: Name: Description. Keep each under 60 chars." },
      { role: "user", content: prompt },
    ], null, null, { maxToolRounds: 0, maxTokens: 400 });

    if (result) {
      // Parse LLM response back into event objects
      const lines = result.split("\n").filter(l => l.includes(":"));
      return lines.map(line => {
        const idx = line.indexOf(":");
        if (idx === -1) return events[0];
        const name = line.slice(0, idx).trim();
        const desc = line.slice(idx + 1).trim();
        // Match back to original event
        const match = events.find(e => line.includes(e.name) || name.includes(e.name));
        return { name: match?.name || name, desc: desc || (match?.desc || line) };
      });
    }
  } catch (err) {
    console.log("[EventEnrich] LLM failed, using templates:", err.message);
  }
  return events;
}

/**
 * 生成诏书 AI 战略评议
 * proxy 模式：LLM 生成 1-2 句战略分析
 * deterministic 模式：基于决策组合生成模板评论
 */
async function generateEdictCommentary(decisions, factionAssignments, calcResult, factionResult) {
  const decisionTypes = decisions.map(d => d.type).filter(t => t !== "routine");
  if (decisionTypes.length === 0) return null;

  const state = gameState.getState();
  const e = state.economy;

  // Deterministic only — proxy mode already has LLM analysis in main response
  const labels = { relief: "赈灾", taxIncrease: "加税", taxDecrease: "减税", recruit: "募兵",
    antiCorruption: "反腐", deployTroops: "出兵", peaceTalks: "议和", currency: "币制改革",
    reward: "赏赐", irrigation: "水利", fortify: "城防", martialLaw: "戒严",
    appeaseRefugees: "安抚流民", roadMaintenance: "修路" };

  const refused = factionAssignments.filter(fa => fa.multiplier === 0);

  const commentary = [];
  const hasTax = decisionTypes.includes("taxIncrease");
  const hasRelief = decisionTypes.includes("relief");
  const hasRecruit = decisionTypes.includes("recruit");
  const hasAntiCorrupt = decisionTypes.includes("antiCorruption");
  const hasPeace = decisionTypes.includes("peaceTalks");

  if (hasTax && e.popularSupport < 40) commentary.push("加税虽解燃眉之急，然民力已疲，恐生变乱。");
  if (hasTax && hasRelief) commentary.push("加税与赈灾并行，以有余补不足，不失为权宜之策。");
  if (hasRecruit && e.treasury < 500000) commentary.push("募兵需饷，以当前国库之数，恐难持久。宜开源节流并重。");
  if (hasAntiCorrupt && e.corruption > 50) commentary.push("整顿吏治正当其时——贪腐不除，则万事难举。");
  if (hasPeace && e.imperialAuthority < 50) commentary.push("议和可暂缓边患，然皇权威严不可失。需防主和派借此坐大。");
  if (decisionTypes.length >= 4) commentary.push("政令繁多，恐执行不力。宜分清主次，以免顾此失彼。");
  if (refused.length > 0) commentary.push("有派系抗命不遵，陛下需权衡——是强力镇压还是暂时容忍？");

  if (commentary.length === 0) {
    commentary.push("政令已下，观其后效。若执行得力，当可收预期之功。");
  }

  return commentary[0];
}

async function handleNpcScenario(messages, historyContext, rid) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = lastUser?.content || "";

  let npcName = "Minister";
  for (const name of characterRegistry.listNames()) {
    if (text.includes(name)) { npcName = name; break; }
  }
  const char = characterRegistry.get(npcName);
  const state = gameState.getState();

  // Session-aware NPC memory
  const npcMemory = sessionManager.getActiveNpcMemory(npcName);
  npcMemory.add("user", text);

  console.log(`[${rid}] NPC: ${npcName} | session: ${sessionManager.getActive().id} | msgs: ${npcMemory.getMessageCount()}`);

  // Generate NPC agenda — what this character currently cares about
  const agenda = generateAgenda(npcName, { worldState, relationshipTracker, fateEngine, factionEngine, npcMemory });
  const agendaTopics = agenda.map(a => a.topic);

  // Get relevant world variables for this NPC's role
  const relevantVars = getRelevantWorldVars(npcName);
  const v = worldState.getState();
  const varContext = relevantVars.map(k => `${k}: ${v[k].toFixed(1)}`).join(", ");

  // Generate fate context for AI-driven dialogue
  const fateCtx = generateFateContext(npcName, relationshipTracker.get(npcName), worldState, npcMemory, state);

  const e = state.economy;
  const m = state.military;

  // Build richer topic list based on game state
  const topics = [];
  if (e.treasury < 500000) topics.push("The treasury is strained and needs new revenue sources.");
  if (e.corruption > 55) topics.push("Official corruption is rampant and must be addressed.");
  if (m.rebellionLevel > 40) topics.push("Rebel forces are growing stronger by the day.");
  if (e.popularSupport < 35) topics.push("The people are growing restless.");
  if (v.borderTension > 65) topics.push("Border tensions with the Qing are escalating.");
  if (v.famineIndex > 45) topics.push("Food shortages threaten several provinces.");
  if (e.imperialAuthority < 40) topics.push("The emperor's authority is being undermined by powerful factions.");
  if (topics.length === 0) topics.push("The situation is stable for now.");

  // Relationship-aware response
  const rel = relationshipTracker.get(npcName);
  const relLevel = relationshipTracker.getLevel(npcName);
  const fate = fateEngine.get(npcName);

  let response;
  if (char) {
    // ===== Deterministic mode: richer template-based response =====
    const tonePrefix = {
      loyal: "陛下圣明！微臣以为",
      trusted: "陛下所言极是。以臣之见",
      neutral: "陛下。臣以为",
      distant: "陛下有命，臣自当遵从。",
      hostile: "（冷淡地）陛下既问，臣便直言——",
      treacherous: "（皮笑肉不笑）陛下说得是。不过——",
    };

    // Pick 2 most relevant topics
    const primaryTopic = agendaTopics[0] || topics[0];
    const secondaryTopic = agendaTopics[1] || (topics.length > 1 ? topics[1] : "");

    // Character-appropriate closing
    const closingPhrases = {
      "魏忠贤": "奴才定当竭力为陛下分忧。",
      "袁崇焕": "臣以项上人头担保，定不负陛下所托。",
      "孙承宗": "老臣定当尽心竭力，以报陛下知遇之恩。",
      "崔呈秀": "陛下英明神武，臣佩服得五体投地。",
      "温体仁": "此事宜从长计议。陛下圣明，自有决断。",
      "洪承畴": "臣必竭尽全力，但请陛下给予足够支持。",
      "钱谦益": "臣才疏学浅，但定当尽力为陛下分忧。",
      "徐光启": "臣愿将平生所学，尽献于陛下。",
      "房壮丽": "臣一身正气，何惧之有？但为社稷计，臣不得不言。",
    };

    const closing = closingPhrases[npcName] || char.goals[0] || "臣定当竭力以报陛下。";

    // Easter egg: historical quotes + hidden dialogues
    const easterEgg = injectNpcEasterEgg(npcName, {
      fateStatus: fate.status,
      relScore: rel.score,
      borderTension: worldState.getState().borderTension,
      turn: state.turn.number,
      corruption: e.corruption,
    });

    response = [
      `${char.name} (${char.role}) [Relations: ${relLevel.label} (${rel.score})]`,
      fate.status !== "alive" ? `[状态: ${fate.status}]` : "",
      char.attitude ? `[态度: ${char.attitude.slice(0, 40)}]` : "",
      "",
      `${tonePrefix[relLevel.level] || tonePrefix.neutral} ${primaryTopic}`,
      secondaryTopic ? `关于${secondaryTopic.split("，")[0].slice(0, 40)}，${char.name}也有话要说。` : "",
      `"${closing}"`,
      "",
      `*(${char.faction} | ${char.personality.slice(0, 50)}...)*`,
      agenda.length > 0 ? `\n[关切议题]\n${agenda.map(a => `  - ${a.topic}`).join("\n")}` : "",
      fateCtx ? `\n[Fate Trajectory]\n${fateCtx}` : "",
      easterEgg || "",
    ].filter(Boolean).join("\n");
  } else {
    response = `${npcName}: Your Majesty summoned me. ${topics[0]}`;
  }

  // Store response in memory
  npcMemory.add("assistant", response);

  // Inject memory context if available
  const memoryContext = npcMemory.getContext();
  if (memoryContext && npcMemory.getMessageCount() > 4) {
    return `${memoryContext}\n\n[Latest response]\n${response}`;
  }
  return response;
}

async function handleCourtScenario(messages, historyContext, rid) {
  const allText = messages.map((m) => m.content || "").join("");

  // Enhanced topic detection (10+ categories)
  const topicMap = [
    { kw: "税|饷|赋|财|银|钱|国库|内帑|经费", topic: "财政税赋", category: "finance" },
    { kw: "兵|辽东|边关|清军|后金|鞑|虏|战|征讨|剿匪", topic: "军事边防", category: "military" },
    { kw: "贪|贿|吏治|考成|御史|弹劾|查办|巡按", topic: "吏治反腐", category: "governance" },
    { kw: "科举|取士|书院|翰林|国子监|学政|会试", topic: "科举取士", category: "education" },
    { kw: "灾|荒|饥|赈|粮|水利|河|漕运|农", topic: "民生赈济", category: "welfare" },
    { kw: "藩王|宗室|俸禄|封地|郡王|亲王", topic: "宗室藩务", category: "imperial" },
    { kw: "礼|祭祀|太庙|谥|仪|典礼|朝贡", topic: "礼仪朝贡", category: "ritual" },
    { kw: "刑|律|法|案|狱|大理|三司", topic: "刑律司法", category: "justice" },
    { kw: "盐|铁|茶|马|市舶|海禁|贸易|商", topic: "盐铁贸易", category: "commerce" },
    { kw: "火器|火炮|鸟铳|历法|西学|洋", topic: "技术引进", category: "technology" },
    { kw: "党争|东林|阉党|宦官|厂卫|锦衣卫", topic: "朝堂党争", category: "faction" },
  ];

  // Find the best matching topic
  let bestTopic = null, bestScore = 0;
  for (const t of topicMap) {
    const score = (allText.match(new RegExp(t.kw, "g")) || []).length;
    if (score > bestScore) { bestScore = score; bestTopic = t; }
  }
  const topic = bestTopic || { topic: "朝政大局", category: "general" };

  console.log(`[${rid}] Court: ${topic.topic} (${topic.category}) | score: ${bestScore}`);

  const { evaluateFactionReaction } = require("./mcp/tools/faction");
  const factionResult = await evaluateFactionReaction({ action: topic.topic });

  // Build NPC stances based on character cards and topic
  const npcStances = buildCourtStances(topic);

  // Generate the court discussion
  const state = gameState.getState();
  const v = worldState.getState();

  const lines = [
    `━━━ 朝堂廷议 ━━━`,
    `议题: ${topic.topic}`,
    `主持: 崇祯帝`,
    `与会: 内阁大学士、六部尚书、都察院御史`,
    "",
    `【各方奏对】`,
    "",
  ];

  // Each NPC stance
  for (const stance of npcStances) {
    const char = characterRegistry.get(stance.name);
    const rel = relationshipTracker.get(stance.name);
    const relScore = rel?.score || 0;
    const powerIndicator = stance.influence === "high" ? " (强势)" : stance.influence === "low" ? " (弱势)" : "";

    lines.push(`${stance.name} (${char?.role || ""}) [${char?.faction || ""}]${powerIndicator}:`);
    lines.push(`  "${stance.statement}"`);
    if (stance.reasoning) lines.push(`  理据: ${stance.reasoning}`);
    lines.push("");
  }

  // Faction-level summary
  lines.push("【派系态度】");
  if (factionResult.factionReactions) {
    for (const [, fr] of Object.entries(factionResult.factionReactions)) {
      lines.push(`  ${fr.factionName}: ${fr.attitude} — ${fr.reason}`);
    }
  }
  lines.push("");

  // Synthesis
  lines.push("【廷议总结】");
  lines.push(factionResult.summary || "众臣各执一词，陛下需乾纲独断。");

  // Recommendations
  if (factionResult.suggestions && factionResult.suggestions.length > 0) {
    lines.push("");
    lines.push("【内阁建议】");
    lines.push(...factionResult.suggestions.filter(Boolean).map((s, i) => `  ${i + 1}. ${s}`));
  }

  // Faction power warning
  const factionReport = factionEngine.getReport();
  if (factionReport.recommendation) {
    lines.push("");
    lines.push(`【⚠ 党派态势】${factionReport.recommendation}`);
  }

  if (historyContext) lines.push("", historyContext);

  return lines.join("\n");
}

/**
 * 构建廷议中各 NPC 的立场
 */
function buildCourtStances(topic) {
  const stances = [];
  const state = gameState.getState();
  const e = state.economy;
  const v = worldState.getState();

  // 为每个 NPC 生成基于其性格和当前局势的立场
  const stanceTemplates = {
    finance: {
      "魏忠贤": { stance: "支持", influence: "high", statement: "老奴以为，当务之急是加征商税和矿税。江南富商大贾，家财万贯，理应多为朝廷出力。", reasoning: "阉党可借收税之机中饱私囊，加征商税不影响农民。" },
      "孙承宗": { stance: "谨慎", influence: "medium", statement: "加税固可解一时之困，然须防竭泽而渔。臣以为当先清理积欠、查核冗员，开源不如节流。", reasoning: "富国强兵需时日，不能急功近利。" },
      "房壮丽": { stance: "反对加税", influence: "medium", statement: "百姓已不堪重负！再行加税，必致民变四起。臣请陛下先从内廷开支削减开始。", reasoning: "清廉派认为皇室和官僚应先做出表率。" },
      "温体仁": { stance: "中立", influence: "low", statement: "此事务须慎重。加税有加税的道理，减支有减支的好处。一切听凭陛下乾纲独断。", reasoning: "" },
      "徐光启": { stance: "支持改革", influence: "low", statement: "与其在旧税制上修修补补，不如重新丈量田亩、清核户口。税基扩大，税率自然可降。", reasoning: "技术官僚的务实思路。" },
    },
    military: {
      "袁崇焕": { stance: "主战", influence: "high", statement: "臣请陛下增拨军饷五十万两，编练新军三万。五年平辽之策，不可半途而废！", reasoning: `边境紧张度${v.borderTension.toFixed(0)}，时不我待。` },
      "洪承畴": { stance: "务实", influence: "medium", statement: "练兵固然要紧，但眼下粮饷不足，贸然扩军恐难持久。臣以为当稳扎稳打，先确保现有兵力粮饷充足。", reasoning: "西北前线的实际经验——没有后勤的军队不堪一击。" },
      "魏忠贤": { stance: "反对增拨", influence: "high", statement: "军饷年年增加，辽东却年年告急。老奴斗胆问一句——这些银子都花到哪去了？", reasoning: "借军事问题打压武将集团。" },
    },
    governance: {
      "房壮丽": { stance: "坚决支持", influence: "high", statement: "吏治不清，国将不国！臣请陛下允准都察院彻查六部及地方官吏，不论品级高低，有贪必究！", reasoning: "都察院已掌握多起贪腐线索。" },
      "魏忠贤": { stance: "表面支持", influence: "high", statement: "陛下圣明。反腐肃贪，老奴第一个赞成。不过……'自己人'总归是信得过的。东厂愿协助查案。", reasoning: "将反腐转化为打击政敌的工具。" },
      "温体仁": { stance: "谨慎", influence: "medium", statement: "反腐是好事，但若操之过急，恐引起朝局动荡。可否先从几个典型入手，以儆效尤？", reasoning: "害怕反腐波及自身或盟友。" },
    },
    faction: {
      "魏忠贤": { stance: "自辩", influence: "high", statement: "老奴对陛下一片忠心，日月可鉴。那些说阉党把持朝政的，分明是挑拨离间！", reasoning: "" },
      "孙承宗": { stance: "进谏", influence: "medium", statement: "陛下，朝中党派之争已到了不能不面对的时候。若任其发展，朝廷将四分五裂。", reasoning: "党争已严重影响了朝政的正常运转。" },
      "钱谦益": { stance: "忧虑", influence: "low", statement: "朝中清流日渐凋零，正气不彰。长此以往，只怕再也没有人敢对陛下说真话了。", reasoning: "东林党处于劣势，希望皇帝保护。" },
    },
  };

  const templates = stanceTemplates[topic.category] || {};

  // Add NPCs with defined stances for this topic
  for (const name of characterRegistry.listNames()) {
    const t = templates[name];
    if (t) {
      stances.push({ name, ...t });
    }
  }

  // Add a few more NPCs if the topic has fewer than 4 speakers
  if (stances.length < 4) {
    const added = new Set(stances.map(s => s.name));
    const extras = [
      { name: "孙承宗", statement: "此事关乎社稷安危，老臣以为需从长计议，不可操切行事。", influence: "medium" },
      { name: "温体仁", statement: "各位大人说得都有道理。陛下圣明，自有裁断。臣遵旨便是。", influence: "low" },
      { name: "房壮丽", statement: "臣以为此事关乎天下百姓福祉，当以民为本，不可只考虑朝廷得失。", influence: "medium" },
    ];
    for (const extra of extras) {
      if (!added.has(extra.name)) {
        stances.push(extra);
        added.add(extra.name);
        if (stances.length >= 5) break;
      }
    }
  }

  return stances;
}

/**
 * 诏书润色 (Edict Refinement)
 * 将玩家的大纲式白话转化为正式诏书文本。
 * 原版对应: second_model → /byok/edict/refine/*
 */
async function handleRefineScenario(messages, historyContext, rid) {
  // Game sends refine as: system prompt + NPC analysis + "请按要求完成任务"
  // Extract the NPC's actual proposal from the LAST substantial message before the instruction

  let text = "";

  // Strategy: take the LAST user/assistant message that has substantial content
  // and is NOT the instruction template
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m.content) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.content.includes("请按要求完成任务")) continue;
    if (m.content.trim().length < 20) continue;

    text = m.content.trim();
    break;
  }

  // Fallback: search all messages for anything substantial
  if (!text) {
    for (const m of messages) {
      if (m.content && m.content.length > 40 && !m.content.includes("请按要求完成任务")) {
        text = m.content; break;
      }
    }
  }

  // Clean prefixes
  text = (text || "")
    .replace(/^朕决定[：:]\s*/g, "")
    .replace(/^.*的结论\s*/g, "")
    .trim();

  if (!text || text.length < 10) {
    console.log(`[${rid}] Refine: no content found in ${messages.length} msgs`);
    text = "（诏书内容由廷议而定）";
  }

  const state = gameState.getState();
  console.log(`[${rid}] Refine: "${text.slice(0, 80)}..."`);

  const template = `奉天承运皇帝诏曰：

${text.replace(/([。！？])/g, "$1\n")}

钦此。
${state.turn.display}`;

  if (historyContext && historyContext.length > 50) {
    return `${template}\n\n---\n[参考先例]\n${historyContext}`;
  }

  return template;
}

/**
 * 结局生成 (Endgame)
 * 原版对应: /byok/edict/confirm/endgame_finalize
 */
async function handleEndgameScenario(messages, historyContext, rid) {
  const state = gameState.getState();
  const e = state.economy;

  console.log(`[${rid}] Endgame | ${state.turn.display}`);

  // 判定结局
  let endingType, endingNarrative, score;

  if (state.turn.number >= 65 || e.popularSupport <= 10 || e.treasury <= 0 && e.imperialAuthority <= 15) {
    endingType = "bad";
    score = Math.floor(e.popularSupport * 0.3 + e.imperialAuthority * 0.2 + (e.treasury > 0 ? 10 : 0));
    endingNarrative = generateBadEnding(state);
  } else if (e.popularSupport >= 50 && e.treasury >= 1000000 && e.imperialAuthority >= 60) {
    endingType = "happy";
    score = Math.floor(e.popularSupport * 0.5 + e.imperialAuthority * 0.3 + e.treasury / 100000);
    endingNarrative = generateHappyEnding(state);
  } else {
    endingType = "normal";
    score = Math.floor(e.popularSupport * 0.4 + e.imperialAuthority * 0.3 + e.treasury / 200000);
    endingNarrative = generateNormalEnding(state);
  }

  return [
    `[Ending: ${endingType}]`,
    `Score: ${score}`,
    "",
    endingNarrative,
    "",
    "---",
    `Reign: 崇祯${state.turn.year}年 | Turns: ${state.turn.number}`,
    `Final Treasury: ${Math.floor(e.treasury).toLocaleString()} taels | Popular Support: ${e.popularSupport.toFixed(1)}`,
    `Corruption: ${e.corruption.toFixed(1)} | Authority: ${e.imperialAuthority.toFixed(1)}`,
  ].join("\n");
}

function generateBadEnding(state) {
  if (state.turn.number >= 65) {
    return `崇祯十七年春，李自成攻破北京。帝登煤山，自缢殉国。临终血书："朕自登基十七年，逆贼直逼京师。虽朕薄德匪躬，上干天咎，然皆诸臣之误朕也。"大明二百七十六年国祚，至此而终。`;
  }
  return `朝纲崩溃，民心尽失，流寇四起。崇祯帝无力回天，大明江山轰然倒塌。史载："思宗在位十七年，勤政爱民，然积重难返，终至亡国。"`;
}

function generateHappyEnding(state) {
  return `在崇祯帝的英明治理下，明朝成功渡过了危机。国库充盈，民心归附，边防稳固。虽然内忧外患不断，但帝国在艰难中逐渐恢复了元气。崇祯帝的改革为明朝续命数十年，史称"崇祯中兴"。`;
}

function generateNormalEnding(state) {
  return `崇祯帝在位多年，竭尽全力维持着摇摇欲坠的大明江山。虽然未能实现中兴，但也未让局势彻底失控。帝国在风雨中艰难维持，留给后世一个未尽的悬念。史书记载："帝勤于政事，然困于时局。"`;
}

async function handleSimulateScenario(messages, historyContext, rid) {
  console.log(`[${rid}] Simulation`);

  // Generate strategic analysis via the new advisor system
  const analysis = await generateStrategicAnalysis({
    worldState,
    factionEngine,
    fateEngine,
    relationshipTracker,
  });

  const state = gameState.getState();
  const e = state.economy;
  const m = state.military;
  const t = state.turn;

  const statusReport = [
    `[Empire Status Report: ${t.display}]`,
    "",
    "Economy:",
    `  Treasury: ${Math.floor(e.treasury).toLocaleString()} taels${e.treasury < 300000 ? " [LOW]" : ""}`,
    `  Privy Purse: ${Math.floor(e.privyPurse).toLocaleString()} taels`,
    `  Popular Support: ${e.popularSupport.toFixed(1)}/100`,
    `  Corruption: ${e.corruption.toFixed(1)}/100`,
    `  Imperial Authority: ${e.imperialAuthority.toFixed(1)}/100`,
    `  Currency Supply: ${e.currencySupply.toFixed(1)}/100`,
    "",
    "Military:",
    `  Troops: ${m.totalTroops.toLocaleString()} | Morale: ${m.morale.toFixed(1)}`,
    `  Rebel Activity: ${m.rebellionLevel.toFixed(1)}/100`,
    `  Border Status: ${m.borderStatus}`,
    "",
    "Factions:",
    ...Object.entries(state.factions).map(([, f]) => `  ${f.name}: Power ${f.power} | ${f.attitude}`),
    "",
    // Easter egg: seasonal flavor + rare events + dreams
    injectReportFlavor() ? `${injectReportFlavor()}\n` : "",
    analysis,
    historyContext ? `\n${historyContext}` : "",
  ].join("\n");

  return statusReport;
}

const PORT = config.port;

// ============ Session & Archive API ============

app.post("/v1/session/new", (_req, res) => {
  const session = sessionManager.createSession();
  gameState.reset();
  res.json({ sessionId: session.id });
});

app.post("/v1/session/reset", (_req, res) => {
  const session = sessionManager.resetActive();
  gameState.reset();
  relationshipTracker.reset();
  worldState.reset();
  fateEngine.reset();
  factionEngine.reset();
  res.json({ sessionId: session.id });
});

app.get("/v1/session/current", (_req, res) => {
  const s = sessionManager.getActive();
  const memories = {};
  for (const [name, mem] of s.npcMemories) {
    memories[name] = { messageCount: mem.getMessageCount(), hasCompressed: !!mem.compressed };
  }
  res.json({ sessionId: s.id, createdAt: s.createdAt, npcMemories: memories });
});

app.get("/v1/archives", (_req, res) => {
  res.json(archiveManager.listArchives());
});

app.post("/v1/archives/create", (req, res) => {
  res.json(archiveManager.createArchive(req.body?.name));
});

app.post("/v1/archives/restore", (req, res) => {
  try { res.json(archiveManager.restoreArchive(req.body?.sessionId)); }
  catch (e) { res.status(404).json({ error: e.message }); }
});

app.delete("/v1/archives/:sessionId", (req, res) => {
  archiveManager.deleteArchive(req.params.sessionId);
  res.json({ deleted: true });
});

// ============ Causality API ============

app.get("/v1/causality/relationships", (_req, res) => {
  const report = [];
  for (const name of characterRegistry.listNames()) {
    const rel = relationshipTracker.get(name);
    const level = relationshipTracker.getLevel(name);
    const fate = fateEngine.get(name);
    const char = characterRegistry.get(name);
    report.push({ npc: name, score: rel.score, level: level.label, status: fate.status, faction: char?.faction });
  }
  res.json(report);
});

app.get("/v1/causality/world", (_req, res) => {
  res.json(worldState.getState());
});

app.get("/v1/causality/fates", (_req, res) => {
  res.json(fateEngine.getReport());
});

app.get("/v1/dynamic-entities", (_req, res) => {
  res.json(dynamicEntities.getAll());
});

app.get("/v1/causality/factions", (_req, res) => {
  res.json(factionEngine.getReport());
});

// ============ Simulator API Intercept (after patch-simulator.js) ============

// Capture ALL /api/* requests from the game
app.all("/api/*", (req, res) => {
  const rid = require("uuid").v4().slice(0, 6);
  console.log(`\n[SIM ${rid}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[SIM ${rid}] body keys:`, Object.keys(req.body).join(", "));
    const bodyStr = JSON.stringify(req.body);
    console.log(`[SIM ${rid}] body:`, bodyStr.slice(0, 500));
  }
  // Placeholder: return empty success so game doesn't crash
  // 注意：游戏端成功码是 "10000"（不是 "20001"——那是 Mod 后端码）。
  // 用错码会导致游戏把响应按错误/空数据处理。
  res.json({ code: "10000", data: {}, message: "cz-engine placeholder" });
});

// Capture /proxy/* requests
app.all("/proxy/*", (req, res) => {
  const rid = require("uuid").v4().slice(0, 6);
  console.log(`\n[PROXY ${rid}] ${req.method} ${req.path}`);
  res.json({ code: "10000", data: {}, message: "cz-engine proxy placeholder" });
});

// Catch-all: log unmapped routes
app.use((req, res, next) => {
  if (req.path.startsWith("/v1/") || req.path === "/health" || req.path.startsWith("/api/") || req.path.startsWith("/proxy/")) { next(); return; }
  if (req.method === "POST" || req.method === "GET") {
    console.log(`[404] ${req.method} ${req.path} — not handled`);
  }
  next();
});

if (require.main === module) {
  (async () => {
    await retriever.initialize();
    app.listen(PORT, () => {
      console.log(`\nCZ Rules Engine v2.0  http://localhost:${PORT}\nGame BYOK: http://localhost:${PORT}/v1\n`);
    });
  })();
}

module.exports = { app };
