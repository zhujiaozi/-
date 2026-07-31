const { describe, it } = require("node:test");
const assert = require("node:assert");

const { getGameState, getEconomy, getProvince, getMilitary } = require("../src/mcp/tools/game-state");
const { calculateEdictEffect, formatEdictResult, EFFECT_MATRIX } = require("../src/mcp/tools/edict");
const { getNpcProfile, getNpcList } = require("../src/mcp/tools/npc");
const { simulateEconomy } = require("../src/mcp/tools/economy");
const { evaluateFactionReaction } = require("../src/mcp/tools/faction");
const { checkHistoricalEvent } = require("../src/mcp/tools/history");
const { gameState } = require("../src/state/game-state");

describe("State query tools", () => {
  it("getGameState returns full state", async () => {
    gameState.reset();
    const r = await getGameState();
    assert.ok(r.turn);
    assert.ok(r.economy);
    assert.ok(r.military);
    assert.ok(r.factions);
    assert.ok(r.economy.treasury > 0);
  });

  it("getEconomy returns indicators and warnings", async () => {
    const r = await getEconomy();
    assert.ok(r.treasury);
    assert.ok(r.popularSupport);
    assert.ok(r.notes);
    assert.ok(r.treasuryRunway > 0);
  });

  it("getProvince missing code returns error with available codes", async () => {
    const r = await getProvince({});
    assert.ok(r.error);
    assert.ok(r.availableCodes);
  });

  it("getMilitary returns military status", async () => {
    const r = await getMilitary();
    assert.ok(r.totalTroops > 0);
    assert.ok(r.notes);
  });
});

describe("Edict calculation tools", () => {
  it("calculateEdictEffect relief effect", async () => {
    const r = await calculateEdictEffect({ decisions: [{ type: "relief", intensity: "normal" }] });
    assert.ok(r.summary.treasury < 0);
    assert.ok(r.summary.popularSupport > 0);
    assert.equal(r.details[0].label, "赈灾");
  });

  it("calculateEdictEffect tax increase", async () => {
    const r = await calculateEdictEffect({ decisions: [{ type: "taxIncrease", intensity: "high" }] });
    assert.ok(r.summary.treasury > 0);
    assert.ok(r.summary.popularSupport < 0);
    assert.ok(r.summary.corruption > 0);
  });

  it("calculateEdictEffect multi-decision stacking", async () => {
    const r = await calculateEdictEffect({
      decisions: [
        { type: "taxIncrease", intensity: "normal" },
        { type: "recruit", intensity: "normal" },
        { type: "antiCorruption", intensity: "normal" },
      ],
    });
    assert.equal(r.details.length, 3);
  });

  it("calculateEdictEffect invalid type returns warning", async () => {
    const r = await calculateEdictEffect({ decisions: [{ type: "nonexistent" }] });
    assert.ok(r.warnings.length > 0);
  });

  it("calculateEdictEffect empty array returns error", async () => {
    const r = await calculateEdictEffect({ decisions: [] });
    assert.ok(r.error);
  });

  it("formatEdictResult produces formatted text", async () => {
    const calc = await calculateEdictEffect({ decisions: [{ type: "relief", intensity: "normal" }, { type: "recruit", intensity: "low" }] });
    const fmt = await formatEdictResult({ effects: calc });
    assert.ok(fmt.formattedText.includes("赈灾"));
    assert.ok(fmt.rawSummary);
  });

  it("EFFECT_MATRIX covers all types", () => {
    const types = Object.keys(EFFECT_MATRIX);
    assert.ok(types.includes("relief"));
    assert.ok(types.includes("recruit"));
    assert.ok(types.length >= 12);
  });
});

describe("NPC tools", () => {
  it("getNpcProfile returns known NPC", async () => {
    const r = await getNpcProfile({ name: "袁崇焕" });
    assert.equal(r.name, "袁崇焕");
    assert.equal(r.faction, "militaryGroup");
  });

  it("getNpcProfile unknown returns suggestions", async () => {
    const r = await getNpcProfile({ name: "Unknown" });
    assert.ok(r.error);
    assert.ok(r.knownNpcs.includes("魏忠贤"));
  });

  it("getNpcList returns all NPCs", async () => {
    const r = await getNpcList();
    assert.ok(Array.isArray(r));
    assert.ok(r.length >= 6);
  });
});

describe("Economy simulation", () => {
  it("simulateEconomy projects 4 turns", async () => {
    gameState.reset();
    const r = await simulateEconomy({ turns: 4 });
    assert.equal(r.projections.length, 4);
    assert.ok(r.summary);
  });
});

describe("Faction reactions", () => {
  it("evaluateFactionReaction tax increase", async () => {
    const r = await evaluateFactionReaction({ action: "加税" });
    assert.ok(r.factionReactions.eunuch);
    assert.ok(r.factionReactions.donglin);
    assert.ok(r.summary);
  });

  it("evaluateFactionReaction anti-corruption has donglin support and eunuch oppose", async () => {
    const r = await evaluateFactionReaction({ action: "反腐" });
    assert.ok(r.factionReactions.donglin.attitude.includes("支持"));
    assert.ok(r.factionReactions.eunuch.attitude.includes("反对"));
  });
});

describe("Historical events", () => {
  it("checkHistoricalEvent turn 1 shows future events", async () => {
    gameState.reset();
    const r = await checkHistoricalEvent();
    assert.equal(r.currentEvent, null);
    assert.ok(r.nextEvent);
  });

  it("checkHistoricalEvent turn 8 triggers 己巳之变", async () => {
    gameState.reset();
    gameState.state.turn.number = 8;
    const r = await checkHistoricalEvent();
    assert.ok(r.currentEvent);
    assert.ok(r.currentEvent.name.includes("己巳"));
  });
});
