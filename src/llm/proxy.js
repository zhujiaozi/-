/**
 * LLM 代理层
 *
 * 将优化后的 prompt (含 MCP 工具、护栏、RAG、角色卡) 转发给真实 LLM。
 * 支持 OpenAI 兼容 API，自动处理 tool calling 循环。
 *
 * 模式:
 *   - "proxy": 转发给真实 LLM (需要设置 CZ_LLM_PROVIDER)
 *   - "deterministic": 使用本地规则引擎生成响应 (默认)
 *
 * 配置:
 *   CZ_LLM_MODE=proxy|deterministic
 *   CZ_LLM_PROVIDER=deepseek|openai|custom
 *   DEEPSEEK_API_KEY=sk-xxx  (或 OPENAI_API_KEY)
 *   CZ_LLM_BASE_URL=http://... (自定义地址)
 *   CZ_LLM_MODEL=deepseek-chat (模型名)
 */
const config = require("../config");
const { estimateTokens, cacheKey, cacheGet, cacheSet, trackUsage } = require("./token-budget");

// ========== LLM 调用 ==========

/**
 * 发送 chat completion 请求 (非流式)
 */
async function callLLM(messages, tools, options = {}) {
  const provider = resolveProvider();
  if (!provider || !provider.apiKey) {
    return null;
  }

  // 强制 tool_choice 的请求（游戏结构化输出流程）不能走缓存——缓存只存纯文本响应
  const skipCache = !!options.toolChoice;

  // Check cache
  const ck = cacheKey(messages, tools, provider.model || "deepseek-chat");
  if (!skipCache) {
    const cached = cacheGet(ck);
    if (cached !== null) {
      console.log(`[LLM] Cache hit — saved ~${estimateTokens(cached)} tokens`);
      return { content: cached, toolCalls: [], usage: { cached: true }, model: provider.model };
    }
  }

  const body = {
    model: options.model || provider.model || "deepseek-chat",
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2000,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    // 默认 auto；调用方可透传游戏要求的 tool_choice ("required" 或指定函数)
    body.tool_choice = options.toolChoice || "auto";
  }

  const estInput = estimateTokens(messages) + estimateTokens(JSON.stringify(tools || []));
  console.log(`[LLM] Calling ${provider.baseUrl} model=${body.model} msgs=${messages.length} tools=${tools?.length || 0} est_input=${estInput}tk`);

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`,
      ...(provider.extraHeaders || {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout || 60000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error(`[LLM] API error ${response.status}: ${errText.slice(0, 200)}`);
    return null;
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) {
    console.error("[LLM] No choices in response");
    return null;
  }

  const actualUsage = data.usage || {};
  trackUsage(actualUsage.prompt_tokens || estInput, actualUsage.completion_tokens || 0);

  const result = {
    content: choice.message?.content || "",
    toolCalls: choice.message?.tool_calls || [],
    usage: actualUsage,
    model: data.model,
  };

  // Cache the result for text-only responses (no tool calls, no forced tool_choice)
  if (!skipCache && (!result.toolCalls || result.toolCalls.length === 0)) {
    cacheSet(ck, result.content, actualUsage.total_tokens || estInput);
  }

  return result;
}

/**
 * Tool calling 循环: LLM 调用工具 → 执行 → 把结果返回给 LLM → 生成最终响应
 *
 * @param {Array} messages — 完整对话历史
 * @param {Array} tools — OpenAI 格式工具定义
 * @param {Object} registry — MCP 工具注册中心 (执行工具调用)
 * @param {Object} options
 * @returns {string} 最终响应文本
 */
async function callWithTools(messages, tools, registry, options = {}) {
  const maxRounds = options.maxToolRounds || 3;  // 减少轮次节省 token
  let currentMessages = [...messages];

  for (let round = 0; round < maxRounds; round++) {
    const response = await callLLM(currentMessages, tools, options);

    if (!response) return null; // LLM 不可用

    // LLM 返回了最终文本 (没有 tool calls)
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return response.content;
    }

    // LLM 要调用工具
    console.log(`[LLM] Tool calls requested: ${response.toolCalls.map((tc) => tc.function.name).join(", ")}`);

    // 添加 assistant 消息 (含 tool calls)
    currentMessages.push({
      role: "assistant",
      content: response.content || null,
      tool_calls: response.toolCalls,
    });

    // 执行每个工具调用
    for (const tc of response.toolCalls) {
      const toolName = tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}

      try {
        const result = await registry.execute(toolName, args);
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
        console.log(`[LLM] Tool ${toolName} executed successfully`);
      } catch (err) {
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err.message }),
        });
        console.log(`[LLM] Tool ${toolName} failed: ${err.message}`);
      }
    }
  }

  // 达到最大轮次，强制 LLM 生成最终响应
  currentMessages.push({ role: "system", content: "Please provide your final response now without calling any more tools." });
  const final = await callLLM(currentMessages, [], options);
  return final?.content || null;
}

// ========== Provider 解析 ==========

function resolveProvider() {
  const mode = process.env.CZ_MODE || process.env.CZ_LLM_MODE || "deterministic";
  if (mode !== "proxy") return null;

  const providerName = process.env.CZ_LLM_PROVIDER || config.llm.defaultProvider;

  // 从环境变量构建 provider
  const envMap = {
    deepseek: {
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      model: process.env.CZ_LLM_MODEL || "deepseek-chat",
      extraHeaders: {},
    },
    openai: {
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY || "",
      model: process.env.CZ_LLM_MODEL || "gpt-4o-mini",
      extraHeaders: {},
    },
    custom: {
      baseUrl: process.env.CZ_LLM_BASE_URL || "",
      apiKey: process.env.CZ_LLM_API_KEY || "",
      model: process.env.CZ_LLM_MODEL || "default",
      extraHeaders: process.env.CZ_LLM_EXTRA_HEADERS
        ? JSON.parse(process.env.CZ_LLM_EXTRA_HEADERS)
        : {},
    },
  };

  const provider = envMap[providerName];
  if (provider && !provider.apiKey) {
    console.log("[LLM] No API key configured for", providerName, "- using deterministic mode");
    return null;
  }
  return provider;
}

/**
 * 主入口: 发送 prompt 给 LLM 并返回响应
 * 如果 LLM 不可用，返回 null (调用方应 fallback 到 deterministic)
 */
async function proxyRequest(messages, tools, registry, options = {}) {
  const provider = resolveProvider();
  if (!provider) return null;

  if (tools && tools.length > 0) {
    return await callWithTools(messages, tools, registry, options);
  }
  const resp = await callLLM(messages, tools, options);
  return resp?.content || null;
}

module.exports = { proxyRequest, callLLM, resolveProvider };
