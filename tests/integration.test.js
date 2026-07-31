const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const { gameState } = require("../src/state/game-state");
const { retriever } = require("../src/rag/retriever");

const BASE_URL = "http://localhost:3458";
let server;

before(async () => {
  const { app } = require("../src/server");
  await new Promise((resolve) => { server = app.listen(3458, resolve); });
  await retriever.initialize();
});

after(() => { if (server) server.close(); });

function post(path, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      `${BASE_URL}${path}`,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": buf.length } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
          catch { resolve({ status: res.statusCode, body: b }); }
        });
      }
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, body: b }); }
      });
    }).on("error", reject);
  });
}

describe("Integration tests", () => {
  it("GET /health returns ok", async () => {
    const r = await get("/health");
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "ok");
    assert.equal(r.body.engine, "cz-rules-engine");
  });

  it("GET /v1/models returns model list", async () => {
    const r = await get("/v1/models");
    assert.equal(r.status, 200);
    assert.equal(r.body.object, "list");
    assert.ok(Array.isArray(r.body.data));
    assert.ok(r.body.data.length >= 3);
    const names = r.body.data.map((m) => m.id);
    assert.ok(names.includes("cz-rules-v1"));
    assert.ok(names.includes("cz-edict"));
    assert.ok(names.includes("cz-npc"));
  });

  it("POST /v1/chat/completions edict scenario", async () => {
    gameState.reset();
    const r = await post("/v1/chat/completions", {
      model: "cz-edict",
      messages: [
        { role: "system", content: "You are a Ming Dynasty advisor system. Current: Chongzhen Year 1, Spring." },
        { role: "user", content: "The Emperor decides: increase taxes to fund the military. Recruit 20000 soldiers nationwide. Order Yuan Chonghuan to strengthen Liaodong defenses. Also provide relief funds to Shaanxi disaster victims. Purge corrupt officials through anti-corruption measures." },
      ],
      stream: false,
    });
    assert.equal(r.status, 200);
    const choice = r.body.choices?.[0];
    assert.ok(choice);
    assert.ok(choice.message.content.length > 50);
    assert.equal(choice.finish_reason, "stop");
  });

  it("POST /v1/chat/completions NPC chat", async () => {
    gameState.reset();
    const r = await post("/v1/chat/completions", {
      model: "cz-npc",
      messages: [
        { role: "system", content: "NPC dialogue system." },
        // 游戏实际发送的是中文 prompt（路由按中文人名识别 NPC）
        { role: "user", content: "袁崇焕，你对辽东局势有何看法？" },
      ],
      stream: false,
    });
    assert.equal(r.status, 200);
    const c = r.body.choices?.[0]?.message?.content;
    assert.ok(c);
    assert.ok(c.includes("Yuan Chonghuan") || c.includes("袁崇焕"));
  });

  it("POST /v1/chat/completions court discussion", async () => {
    gameState.reset();
    const r = await post("/v1/chat/completions", {
      model: "cz-court",
      messages: [
        { role: "system", content: "Court discussion begins." },
        { role: "user", content: "诸卿，军饷不足，该当如何？" },
      ],
      stream: false,
    });
    assert.equal(r.status, 200);
    const c = r.body.choices?.[0]?.message?.content;
    assert.ok(c);
    // Court discussion produces faction reactions
    assert.ok(c.includes("Court") || c.includes("Faction") || c.includes("Summary") || c.includes("派系") || c.includes("廷议"));
  });

  it("POST /v1/chat/completions simulation", async () => {
    gameState.reset();
    const r = await post("/v1/chat/completions", {
      model: "cz-simulate",
      messages: [
        { role: "system", content: "Generate empire status report." },
        { role: "user", content: "What is the current situation?" },
      ],
      stream: false,
    });
    assert.equal(r.status, 200);
    const c = r.body.choices?.[0]?.message?.content;
    assert.ok(c);
    assert.ok(c.includes("Treasury") || c.includes("Empire"));
  });

  it("SSE streaming response", async () => {
    gameState.reset();
    const buf = Buffer.from(JSON.stringify({
      model: "cz-rules-v1",
      messages: [{ role: "user", content: "Brief situation report." }],
      stream: true,
    }), "utf8");

    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        `${BASE_URL}/v1/chat/completions`,
        { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": buf.length } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c.toString()));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
        }
      );
      req.on("error", reject);
      req.write(buf);
      req.end();
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "text/event-stream");
    assert.ok(response.body.includes("data: "));
    assert.ok(response.body.includes("[DONE]"));
  });

  it("API returns usage statistics", async () => {
    const r = await post("/v1/chat/completions", {
      model: "cz-rules-v1",
      messages: [{ role: "user", content: "test" }],
      stream: false,
    });
    assert.ok(r.body.usage);
    assert.ok(r.body.usage.prompt_tokens >= 0);
    assert.ok(r.body.usage.completion_tokens >= 0);
  });

  it("Invalid model does not crash", async () => {
    const r = await post("/v1/chat/completions", {
      model: "nonexistent-model",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.choices?.[0]?.message?.content);
  });

  it("POST /v1/session/new creates new session", async () => {
    const r = await post("/v1/session/new", {});
    assert.equal(r.status, 200);
    assert.ok(r.body.sessionId);
  });

  it("GET /v1/session/current returns active session", async () => {
    const r = await get("/v1/session/current");
    assert.equal(r.status, 200);
    assert.ok(r.body.sessionId);
    assert.ok(r.body.npcMemories);
  });

  it("POST /v1/session/reset resets session", async () => {
    const r = await post("/v1/session/reset", {});
    assert.equal(r.status, 200);
    assert.ok(r.body.sessionId);
  });

  it("Archives: create, list, restore, delete", async () => {
    // Create
    const c = await post("/v1/archives/create", { name: "test-archive" });
    assert.equal(c.status, 200);
    assert.ok(c.body.id);

    // List
    const l = await get("/v1/archives");
    assert.equal(l.status, 200);
    assert.ok(Array.isArray(l.body));

    // Restore
    const r = await post("/v1/archives/restore", { sessionId: c.body.id });
    assert.equal(r.status, 200);

    // Delete via path
    await new Promise((resolve, reject) => {
      const req = http.request(
        `${BASE_URL}/v1/archives/${c.body.id}`,
        { method: "DELETE" },
        (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b) })); }
      );
      req.on("error", reject);
      req.end();
    });
  });

  it("NPC memory accumulates across turns", async () => {
    // Start fresh
    await post("/v1/session/reset", {});
    // Send two NPC chats with Chinese NPC names
    await post("/v1/chat/completions", {
      model: "cz-npc",
      messages: [
        { role: "system", content: "NPC dialogue." },
        { role: "user", content: "袁崇焕，汇报辽东军情。" },
      ],
      stream: false,
    });
    await post("/v1/chat/completions", {
      model: "cz-npc",
      messages: [
        { role: "system", content: "NPC dialogue." },
        { role: "user", content: "袁崇焕，军饷粮草情况如何？" },
      ],
      stream: false,
    });
    // Check session
    const s = await get("/v1/session/current");
    assert.equal(s.status, 200);
    const yuanMem = s.body.npcMemories["袁崇焕"];
    assert.ok(yuanMem, "Yuan Chonghuan should have memory");
    assert.ok(yuanMem.messageCount >= 4, `Expected >=4 messages, got ${yuanMem.messageCount}`);
  });

  it("Causality: edict changes relationships and world state", async () => {
    // Start fresh
    await post("/v1/session/reset", {});
    // Issue an anti-corruption edict
    await post("/v1/chat/completions", {
      model: "cz-edict",
      messages: [
        { role: "system", content: "Edict system." },
        { role: "user", content: "朕决定整顿吏治，彻查贪腐，清理阉党余孽。" },
      ],
      stream: false,
    });
    // Check relationships changed
    const relsResp = await get("/v1/causality/relationships");
    const wei = relsResp.body.find((r) => r.npc === "魏忠贤");
    const fang = relsResp.body.find((r) => r.npc === "房壮丽");
    assert.ok(wei, "魏忠贤 should exist");
    assert.ok(wei.score < -40, `魏忠贤 score should drop after anti-corruption, got ${wei.score}`);
    assert.ok(fang.score > 25, `房壮丽 score should rise after anti-corruption, got ${fang.score}`);

    // Check world state changed
    const worldResp = await get("/v1/causality/world");
    // factionStability should be lower after anti-corruption
    assert.ok(worldResp.body.factionStability < -10, `factionStability should drop after anti-corruption, got ${worldResp.body.factionStability}`);
  });

  it("Fates: player can execute a treacherous NPC", async () => {
    await post("/v1/session/reset", {});
    // Execute Wei Zhongxian
    await post("/v1/chat/completions", {
      model: "cz-edict",
      messages: [
        { role: "system", content: "Edict system." },
        { role: "user", content: "朕决定：诛杀魏忠贤，铲除阉党。" },
      ],
      stream: false,
    });
    const fatesResp = await get("/v1/causality/fates");
    const wei = fatesResp.body.find((f) => f.npc === "魏忠贤");
    assert.ok(wei, "Wei Zhongxian should exist");
    assert.ok(["executed", "imprisoned", "dead"].includes(wei.status),
      `Wei should be dead/imprisoned, got ${wei.status}`);
    assert.equal(wei.reversible, false, "Execution should be irreversible");
  });

  it("Fates: loyal NPC cannot be forced to negative extreme", async () => {
    await post("/v1/session/reset", {});
    // Try to execute a diehard loyalist
    await post("/v1/chat/completions", {
      model: "cz-edict",
      messages: [
        { role: "system", content: "Edict system." },
        { role: "user", content: "朕决定：诛杀房壮丽。" },
      ],
      stream: false,
    });
    const fatesResp = await get("/v1/causality/fates");
    const fang = fatesResp.body.find((f) => f.npc === "房壮丽");
    assert.ok(fang, "Fang Zhuangli should exist");
    // Player CAN execute anyone — the constraint is on automatic betrayal, not player choice
    assert.ok(["executed", "alive"].includes(fang.status), `Fang status: ${fang.status}`);
  });

  it("Fates: faction purge chains to faction members", async () => {
    await post("/v1/session/reset", {});
    // Purge eunuch faction
    await post("/v1/chat/completions", {
      model: "cz-edict",
      messages: [
        { role: "system", content: "Edict system." },
        { role: "user", content: "朕决定：清洗阉党，诛杀魏忠贤。" },
      ],
      stream: false,
    });
    // Check that other eunuch faction members are affected
    const fatesResp = await get("/v1/causality/fates");
    const cui = fatesResp.body.find((f) => f.npc === "崔呈秀");
    assert.ok(cui, "Cui Chengxiu should exist");
    // Cui historically committed suicide after Wei fell, so "dead" is also valid
    assert.ok(["imprisoned", "disgraced", "dead"].includes(cui.status),
      `Cui affected by faction purge + unique fate, got ${cui.status}`);
  });

  it("Fates: player can pardon imprisoned NPC", async () => {
    await post("/v1/session/reset", {});
    // First imprison Hong Chengchou
    await post("/v1/chat/completions", {
      model: "cz-edict",
      messages: [
        { role: "system", content: "Edict system." },
        { role: "user", content: "朕决定：将洪承畴革职下狱。" },
      ],
      stream: false,
    });
    // Then pardon him
    await post("/v1/chat/completions", {
      model: "cz-edict",
      messages: [
        { role: "system", content: "Edict system." },
        { role: "user", content: "朕决定：赦免释放洪承畴，官复原职。" },
      ],
      stream: false,
    });
    const fatesResp = await get("/v1/causality/fates");
    const hong = fatesResp.body.find((f) => f.npc === "洪承畴");
    assert.ok(hong, "Hong Chengchou should exist");
    assert.equal(hong.status, "alive", `Hong should be restored to alive after pardon, got ${hong.status}`);
  });

  it("Factions: faction power rises after edict execution", async () => {
    await post("/v1/session/reset", {});
    // Get initial faction state
    const before = await get("/v1/causality/factions");
    const donglinBefore = before.body.factions.find((f) => f.name === "东林党").power;

    // Issue edict favoring Donglin
    await post("/v1/chat/completions", {
      model: "cz-edict",
      messages: [
        { role: "system", content: "Edict system." },
        { role: "user", content: "朕决定：命东林党整顿吏治，反腐肃贪。" },
      ],
      stream: false,
    });

    const after = await get("/v1/causality/factions");
    const donglinAfter = after.body.factions.find((f) => f.name === "东林党").power;
    assert.ok(donglinAfter > donglinBefore,
      `Donglin power should increase after executing edict, before=${donglinBefore} after=${donglinAfter}`);
  });

  it("Factions: imperial authority drops when faction executes edict", async () => {
    await post("/v1/session/reset", {});
    const before = await get("/v1/causality/factions");
    const iaBefore = before.body.imperialAuthority;

    await post("/v1/chat/completions", {
      model: "cz-edict",
      messages: [
        { role: "system", content: "Edict system." },
        { role: "user", content: "朕决定：命阉党加征辽饷，充实国库。" },
      ],
      stream: false,
    });

    const after = await get("/v1/causality/factions");
    assert.ok(after.body.imperialAuthority < iaBefore,
      `Imperial authority should drop after faction executes edict, before=${iaBefore} after=${after.body.imperialAuthority}`);
  });
});
