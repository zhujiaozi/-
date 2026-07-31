const config = require("../config");
const { CORPUS } = require("./corpus/ming-history");
const { createVectorStore } = require("./vector-store");
const { createEmbedder } = require("./embedder");

class Retriever {
  constructor() { this.store = null; this.embedder = null; this.initialized = false; }

  async initialize() {
    if (this.initialized) return;
    console.log("[RAG] Initializing retriever...");
    this.store = await createVectorStore();
    this.embedder = await createEmbedder();
    const count = await this.store.count();
    if (count === 0) {
      console.log(`[RAG] Indexing ${CORPUS.length} documents...`);
      await this._indexCorpus();
    } else {
      console.log(`[RAG] ${count} documents already indexed`);
    }
    this.initialized = true;
    console.log("[RAG] Retriever ready");
  }

  async _indexCorpus() {
    const texts = CORPUS.map((c) => c.content);
    const ids = CORPUS.map((c) => c.id);
    const metadatas = CORPUS.map((c) => c.metadata);
    console.log(`[RAG] Embedding ${texts.length} documents...`);
    const embeddings = await this.embedder.embedBatch(texts);
    console.log("[RAG] Writing to vector store...");
    await this.store.add(ids, embeddings, texts, metadatas);
    console.log("[RAG] Indexing complete");
  }

  async search(query, topK = null) {
    if (!this.initialized) await this.initialize();
    topK = topK || config.rag.defaultTopK;
    const queryEmbedding = await this.embedder.embed(query);
    const results = await this.store.query(queryEmbedding, topK);
    return results.map((r) => ({
      content: r.document, category: r.metadata?.category || "unknown",
      keywords: r.metadata?.keywords || [], era: r.metadata?.era || "",
      relevance: r.score ? r.score.toFixed(3) : "N/A", source: r.id || "unknown",
    }));
  }

  async getContextForPrompt(query, topK = 3) {
    const results = await this.search(query, topK);
    if (results.length === 0) return "";
    const parts = ["[Historical Background]"];
    for (let i = 0; i < results.length; i++) parts.push(`${i + 1}. ${results[i].content}`);
    parts.push("[End Background]\n");
    return parts.join("\n");
  }

  async rebuild() {
    if (this.store && typeof this.store.reset === "function") await this.store.reset();
    await this._indexCorpus();
  }

  async getStats() {
    if (!this.initialized) await this.initialize();
    const count = await this.store.count();
    return {
      totalDocuments: count,
      categories: [...new Set(CORPUS.map((c) => c.metadata.category))],
      eras: [...new Set(CORPUS.map((c) => c.metadata.era))],
    };
  }
}

const retriever = new Retriever();

module.exports = { Retriever, retriever };
