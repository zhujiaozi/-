const config = require("../config");

class InMemoryStore {
  constructor() { this.documents = []; this.embeddings = []; }

  async add(ids, embeddings, documents, metadatas) {
    for (let i = 0; i < ids.length; i++) {
      this.documents.push({ id: ids[i], document: documents[i], metadata: metadatas ? metadatas[i] : {} });
      this.embeddings.push(embeddings[i]);
    }
  }

  async query(queryEmbedding, topK = 5) {
    if (this.documents.length === 0) return [];
    // 空向量（embedding API 失败的产物）会产生 NaN 余弦分，直接不查
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return [];
    const scores = this.embeddings.map((emb) => {
      let dotProduct = 0, normA = 0, normB = 0;
      for (let i = 0; i < emb.length; i++) {
        dotProduct += queryEmbedding[i] * emb[i];
        normA += queryEmbedding[i] * queryEmbedding[i];
        normB += emb[i] * emb[i];
      }
      const denominator = Math.sqrt(normA) * Math.sqrt(normB);
      return denominator === 0 ? 0 : dotProduct / denominator;
    });
    const indices = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
    return indices.slice(0, topK).map((idx) => ({
      id: this.documents[idx].id, document: this.documents[idx].document,
      metadata: this.documents[idx].metadata, score: scores[idx],
    }));
  }

  async count() { return this.documents.length; }

  async reset() { this.documents = []; this.embeddings = []; }
}

async function createVectorStore() {
  try {
    const { ChromaClient } = require("chromadb");
    const client = new ChromaClient({ path: config.chroma.path });
    console.log("[RAG] Using Chroma vector store");
    const store = {
      client, collection: null,
      _ensure: async function () {
        if (this.collection) return this.collection;
        try { this.collection = await this.client.getCollection({ name: "ming_history" }); }
        catch { this.collection = await this.client.createCollection({ name: "ming_history", metadata: { description: "Ming Dynasty historical corpus" } }); }
        return this.collection;
      },
      async add(ids, embeddings, documents, metadatas) {
        const col = await this._ensure();
        await col.add({ ids, embeddings, documents, metadatas });
      },
      async query(queryEmbedding, topK = 5) {
        const col = await this._ensure();
        const results = await col.query({ queryEmbeddings: [queryEmbedding], nResults: topK });
        if (!results || !results.documents || !results.documents[0]) return [];
        return results.documents[0].map((doc, i) => ({
          id: results.ids?.[0]?.[i] || `r${i}`, document: doc,
          metadata: results.metadatas?.[0]?.[i] || {},
          score: results.distances ? 1 - (results.distances[0]?.[i] || 0) : null,
        }));
      },
      async count() { const col = await this._ensure(); return (await col.count()) || 0; },
      async reset() {
        try { await this.client.deleteCollection({ name: "ming_history" }); this.collection = null; } catch {}
      },
    };
    return store;
  } catch (e) {
    console.log(`[RAG] Chroma unavailable (${e.message.slice(0, 60)}...), using InMemoryStore`);
  }
  const store = new InMemoryStore();
  console.log("[RAG] Using InMemoryStore");
  return store;
}

module.exports = { createVectorStore, InMemoryStore };
