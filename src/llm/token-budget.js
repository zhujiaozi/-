/**
 * Token 预算与优化层
 *
 * 策略:
 *   1. Token 追踪 — 每次 LLM 调用记录 token 用量
 *   2. 响应缓存 — 相同 prompt 的请求返回缓存结果
 *   3. 预算控制 — 超出预算时自动降级到 deterministic
 *   4. 智能路由 — 某些场景不需要 LLM
 */

let sessionTokens = { prompt: 0, completion: 0, calls: 0, savings: 0 };
let cacheHits = 0;
let cacheMisses = 0;

// LRU 缓存 (最多 50 条)
const responseCache = new Map();
const MAX_CACHE_SIZE = 50;

/**
 * 估算 prompt token 数 (粗略: 中文 ~1.5 char/token, 英文 ~4 char/token)
 */
function estimateTokens(text) {
  if (!text) return 0;
  if (Array.isArray(text)) {
    return text.reduce((sum, m) => sum + estimateTokens(m.content) + estimateTokens(m.role), 0);
  }
  const str = String(text);
  // 中文字符 ~1.5/token, 其他 ~4/token
  let chineseChars = 0, otherChars = 0;
  for (const ch of str) {
    if (/[一-鿿]/.test(ch)) chineseChars++;
    else otherChars++;
  }
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 生成缓存 key
 * 注意：必须包含 system prompt 的哈希——否则不同场景/NPC 只要末尾几条
 * 消息相同就会互相命中缓存（缓存污染），且状态变化也不会失效。
 */
function cacheKey(messages, tools, model) {
  const sys = messages.find((m) => m.role === "system")?.content || "";
  const sysHash = require("crypto").createHash("md5").update(String(sys)).digest("hex").slice(0, 8);
  const content = JSON.stringify({
    sys: sysHash,
    n: messages.length,
    msg: messages.slice(-3),
    tools: (tools || []).map(t => t.function?.name).sort(),
    model,
  });
  return require("crypto").createHash("md5").update(content).digest("hex").slice(0, 16);
}

/**
 * 检查缓存
 */
function cacheGet(key) {
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.time < 300000) { // 5 min TTL
    cacheHits++;
    sessionTokens.savings += entry.tokens || 300;
    return entry.content;
  }
  if (entry) responseCache.delete(key); // expired
  cacheMisses++;
  return null;
}

/**
 * 写入缓存
 */
function cacheSet(key, content, tokens) {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    // 删除最旧的条目
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].time - b[1].time)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }
  responseCache.set(key, { content, time: Date.now(), tokens });
}

/**
 * 记录 token 消耗
 */
function trackUsage(promptTokens, completionTokens) {
  sessionTokens.prompt += promptTokens || 0;
  sessionTokens.completion += completionTokens || 0;
  sessionTokens.calls++;
}

/**
 * 获取 session 统计
 */
function getStats() {
  const total = sessionTokens.prompt + sessionTokens.completion;
  return {
    promptTokens: sessionTokens.prompt,
    completionTokens: sessionTokens.completion,
    totalTokens: total,
    llmCalls: sessionTokens.calls,
    cacheHits,
    cacheMisses,
    cacheHitRate: (cacheHits + cacheMisses) > 0 ? (cacheHits / (cacheHits + cacheMisses) * 100).toFixed(1) + "%" : "N/A",
    estimatedCost: estimateCost(sessionTokens.prompt, sessionTokens.completion),
    savings: sessionTokens.savings,
  };
}

/**
 * 估算费用 (DeepSeek: ~$0.14/1M input, ~$0.28/1M output)
 */
function estimateCost(promptTokens, completionTokens) {
  const inputCost = (promptTokens / 1000000) * 0.14;
  const outputCost = (completionTokens / 1000000) * 0.28;
  return { input: inputCost.toFixed(6), output: outputCost.toFixed(6), total: (inputCost + outputCost).toFixed(6), currency: "USD" };
}

/**
 * 判断是否应该使用 LLM (某些场景不值得)
 * @returns {{ useLLM: boolean, reason: string }}
 */
function shouldUseLLM(scenario, messagesLength) {
  // refine 场景完全不需要 LLM — 模板就够
  if (scenario === "refine") {
    return { useLLM: false, reason: "诏书润色使用确定性模板即可" };
  }

  // simulate 场景在消息很短时用 deterministic 就够了
  if (scenario === "simulate" && messagesLength <= 2) {
    return { useLLM: false, reason: "短回合报告使用本地分析即可" };
  }

  // endgame 场景用模板
  if (scenario === "endgame") {
    return { useLLM: false, reason: "结局生成使用确定性模板" };
  }

  return { useLLM: true, reason: "" };
}

/**
 * 精简 system prompt — 去掉不必要的部分
 */
function optimizeSystemPrompt(parts, scenario) {
  // 不同场景需要不同的 prompt 组件
  const required = new Set();

  switch (scenario) {
    case "npc":
      required.add("guardrail");
      required.add("character");
      required.add("state");
      required.add("fate");
      required.add("rag");
      break;
    case "court":
      required.add("guardrail");
      required.add("faction");
      required.add("state");
      required.add("rag");
      break;
    case "edict":
      required.add("guardrail");
      required.add("tools");
      required.add("state");
      required.add("rag");
      break;
    case "simulate":
      required.add("guardrail");
      required.add("state");
      required.add("analysis");
      break;
    case "refine":
      // 只用模板，不走 LLM
      return "";
    case "endgame":
      return "";
    default:
      required.add("guardrail");
      required.add("state");
  }

  // 只保留需要的组件
  const filtered = [];
  for (const part of parts) {
    if (!part) continue;
    const tag = part.slice(0, 40);
    if (tag.includes("[SYSTEM GUARDRAILS")) filtered.push(part);
    else if (tag.includes("Tools:") && required.has("tools")) filtered.push(part);
    else if (tag.includes("Scenario:") && required.has("state")) filtered.push(part);
    else if (tag.includes("[角色:") && required.has("character")) filtered.push(part);
    else if (tag.includes("[Fate Trajectory") && required.has("fate")) filtered.push(part);
    else if (tag.includes("[Historical Background") && required.has("rag")) filtered.push(part);
    else if (tag.includes("[Player-created") && required.has("state")) filtered.push(part);
    else if (tag.includes("Chinese response")) filtered.push(part);
  }

  return filtered.join("\n\n");
}

/**
 * 重启 session 统计
 */
function resetStats() {
  sessionTokens = { prompt: 0, completion: 0, calls: 0, savings: 0 };
  cacheHits = 0;
  cacheMisses = 0;
  responseCache.clear();
}

module.exports = {
  estimateTokens,
  cacheKey,
  cacheGet,
  cacheSet,
  trackUsage,
  getStats,
  shouldUseLLM,
  optimizeSystemPrompt,
  resetStats,
};
