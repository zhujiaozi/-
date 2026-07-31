/**
 * 文本向量化 — 三级回退策略:
 *   1. LLM Provider Embedding API (DeepSeek/OpenAI) — 质量最高
 *   2. 本地 Transformers.js (bge-small-zh) — 离线可用
 *   3. SimpleTFIDF — 零依赖纯JS底线
 */
const config = require("../config");

class SimpleEmbedder {
  constructor(dimension = 512) { this.dimension = dimension; }
  _tokenize(text) {
    const chars = text.replace(/\s+/g, "").split("");
    const tokens = [];
    for (let i = 0; i < chars.length; i++) {
      tokens.push(chars[i]);
      if (i < chars.length - 1) tokens.push(chars[i] + chars[i + 1]);
    }
    return tokens;
  }
  _hash(token) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    return Math.abs(hash) % this.dimension;
  }
  async embed(text) {
    const tokens = this._tokenize(text);
    const vector = new Array(this.dimension).fill(0);
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    for (const [t, f] of Object.entries(tf)) vector[this._hash(t)] += Math.log(1 + f);
    let norm = 0;
    for (const v of vector) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
    return vector;
  }
  async embedBatch(texts) { return Promise.all(texts.map((t) => this.embed(t))); }
}

async function createApiEmbedder() {
  const provider = resolveEmbedProvider();
  if (!provider) return null;

  console.log(`[RAG] Trying embedding API: ${provider.baseUrl}`);
  try {
    const testResp = await fetch(`${provider.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ model: provider.model, input: "test" }),
      signal: AbortSignal.timeout(10000),
    });
    if (testResp.ok) {
      console.log(`[RAG] Embedding API OK (model: ${provider.model})`);
      return {
        async embed(text) {
          const resp = await fetch(`${provider.baseUrl}/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.apiKey}` },
            body: JSON.stringify({ model: provider.model, input: text }),
          });
          if (!resp.ok) {
            console.log(`[RAG] Embedding API error ${resp.status} — query skipped`);
            return [];
          }
          const data = await resp.json();
          return data.data?.[0]?.embedding || [];
        },
        async embedBatch(texts) {
          const resp = await fetch(`${provider.baseUrl}/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${provider.apiKey}` },
            body: JSON.stringify({ model: provider.model, input: texts }),
          });
          if (!resp.ok) {
            console.log(`[RAG] Embedding batch API error ${resp.status} — skipped`);
            return texts.map(() => []);
          }
          const data = await resp.json();
          return (data.data || []).map((d) => d.embedding);
        },
      };
    }
  } catch (e) {
    console.log(`[RAG] Embedding API unavailable: ${e.message.slice(0, 60)}`);
  }
  return null;
}

function resolveEmbedProvider() {
  // Try DeepSeek
  const dsKey = process.env.DEEPSEEK_API_KEY;
  if (dsKey) return { baseUrl: "https://api.deepseek.com/v1", apiKey: dsKey, model: "deepseek-chat" };
  // Try OpenAI
  const oaKey = process.env.OPENAI_API_KEY;
  if (oaKey) return { baseUrl: "https://api.openai.com/v1", apiKey: oaKey, model: "text-embedding-3-small" };
  // Try custom
  const customUrl = process.env.CZ_LLM_BASE_URL;
  const customKey = process.env.CZ_LLM_API_KEY;
  if (customUrl && customKey) return { baseUrl: customUrl, apiKey: customKey, model: process.env.CZ_LLM_MODEL || "default" };
  return null;
}

async function createEmbedder() {
  // Tier 1: API
  const api = await createApiEmbedder();
  if (api) return api;

  // Tier 2: Local Transformers.js
  try {
    const { pipeline } = require("@xenova/transformers");
    console.log(`[RAG] Loading local model: ${config.embedding.model}...`);
    const extractor = await pipeline("feature-extraction", config.embedding.model, { quantized: true });
    console.log("[RAG] Local model loaded OK");
    return {
      async embed(text) { const r = await extractor(text, { pooling: "mean", normalize: true }); return Array.from(r.data); },
      async embedBatch(texts) { const results = []; for (const t of texts) { const r = await extractor(t, { pooling: "mean", normalize: true }); results.push(Array.from(r.data)); } return results; },
    };
  } catch (e) {
    console.log(`[RAG] Local model unavailable: ${e.message.slice(0, 60)}`);
  }

  // Tier 3: SimpleTFIDF
  const emb = new SimpleEmbedder(config.embedding.dimension);
  console.log(`[RAG] Using SimpleTFIDF (dim=${config.embedding.dimension})`);
  return emb;
}

module.exports = { createEmbedder, SimpleEmbedder };
