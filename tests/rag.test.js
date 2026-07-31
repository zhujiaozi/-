const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const { retriever } = require("../src/rag/retriever");
const { CORPUS } = require("../src/rag/corpus/ming-history");

describe("RAG vector knowledge base", () => {
  before(async () => { await retriever.initialize(); });

  it("corpus is not empty", () => {
    assert.ok(CORPUS.length >= 15);
  });

  it("corpus covers all categories", () => {
    const cats = new Set(CORPUS.map((c) => c.metadata.category));
    assert.ok(cats.has("economy"));
    assert.ok(cats.has("military"));
    assert.ok(cats.has("institution"));
    assert.ok(cats.has("event"));
    assert.ok(cats.has("character"));
    assert.ok(cats.has("geography"));
  });

  it("retriever initializes with documents", async () => {
    const stats = await retriever.getStats();
    assert.ok(stats.totalDocuments > 0);
  });

  it("search returns relevant results", async () => {
    const results = await retriever.search("military war Liaodong", 3);
    assert.ok(results.length > 0);
    assert.ok(results[0].content);
    assert.ok(results[0].relevance);
  });

  it("search for tax-related content returns economy category", async () => {
    const results = await retriever.search("加税辽饷三饷田赋", 3);
    assert.ok(results.length > 0);
    const hasEcon = results.some((r) => r.category === "economy");
    assert.ok(hasEcon);
  });

  it("search for historical figures", async () => {
    const results = await retriever.search("Wei Zhongxian eunuch faction", 3);
    assert.ok(results.length > 0);
  });

  it("getContextForPrompt returns formatted context", async () => {
    const ctx = await retriever.getContextForPrompt("Yuan Chonghuan Liaodong defense", 2);
    assert.ok(ctx);
    assert.ok(ctx.includes("[Historical Background]"));
  });

  it("getStats returns statistics", async () => {
    const stats = await retriever.getStats();
    assert.ok(stats.totalDocuments > 0);
    assert.ok(stats.categories.length >= 4);
  });
});
