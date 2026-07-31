/**
 * NPC 主动议题系统
 *
 * 根据游戏状态和 NPC 个人情况，生成该角色当前最关心的议题。
 * 这些议题决定 NPC 在对话中会主动提起什么话题。
 */

const { characterRegistry } = require("./registry");
const { gameState } = require("../state/game-state");
const { FACTIONS } = require("../causality/faction-engine");

/**
 * 为一个 NPC 生成当前关心的议题列表
 * @param {string} npcName
 * @param {object} ctx - { worldState, relationshipTracker, fateEngine, factionEngine, npcMemory }
 * @returns {Array<{priority: number, topic: string, type: string}>}
 */
function generateAgenda(npcName, ctx) {
  const char = characterRegistry.get(npcName);
  if (!char) return [];

  const state = gameState.getState();
  const e = state.economy;
  const m = state.military;
  const v = ctx.worldState.getState();
  const rel = ctx.relationshipTracker.get(npcName);
  const relScore = rel?.score || 0;
  const fate = ctx.fateEngine.get(npcName);
  const agenda = [];

  // === 通用议题 (所有 NPC 都可能关心) ===

  // 国库危机
  if (e.treasury < 300000) {
    agenda.push({ priority: 9, topic: "国库空虚，朝廷用度捉襟见肘", type: "treasury_crisis" });
  }

  // 民心危机
  if (e.popularSupport < 30) {
    agenda.push({ priority: 9, topic: "民心不稳，各地均有民怨沸腾之象", type: "popular_unrest" });
  }

  // 腐败严重
  if (e.corruption > 65) {
    agenda.push({ priority: 8, topic: "官场贪腐成风，吏治到了非整治不可的地步", type: "corruption" });
  }

  // 皇权衰落
  if (e.imperialAuthority < 35) {
    agenda.push({ priority: 8, topic: "皇帝权威日衰，政令难出紫禁城", type: "authority_crisis" });
  }

  // === 角色特定议题 ===

  switch (npcName) {
    case "魏忠贤":
      if (relScore >= 0) {
        agenda.push({ priority: 7, topic: "东林党人在朝中结党营私，不可不防", type: "faction_rival" });
      }
      if (fate.status === "alive" && relScore < -40) {
        agenda.push({ priority: 10, topic: "奴才近日心神不宁，恐有人在陛下面前进谗言", type: "self_preservation" });
      }
      if (v.factionStability < -30) {
        agenda.push({ priority: 6, topic: "厂卫近日密报——朝中有大臣暗中串联", type: "intelligence" });
      }
      agenda.push({ priority: 3, topic: `东厂最近查获的几桩大案……(暗示政敌的把柄)`, type: "leverage" });
      break;

    case "袁崇焕":
      if (v.borderTension > 60) {
        agenda.push({ priority: 10, topic: "辽东前线兵力不足，急需增援和粮饷", type: "military_crisis" });
      }
      if (m.morale < 40) {
        agenda.push({ priority: 8, topic: "前线将士士气低落，需陛下下旨激励", type: "military_morale" });
      }
      if (v.qingAggression > 60) {
        agenda.push({ priority: 9, topic: "后金军队调动频繁，似有大举进攻之势", type: "border_intel" });
      }
      if (relScore < 15) {
        agenda.push({ priority: 7, topic: "臣一片忠心，望陛下明鉴。朝中有人欲陷臣于不义", type: "loyalty_plea" });
      }
      break;

    case "孙承宗":
      if (v.famineIndex > 45) {
        agenda.push({ priority: 8, topic: "北方旱情严峻，需及早备荒", type: "famine_warning" });
      }
      agenda.push({ priority: 5, topic: "老臣观近来朝中风气，实有隐忧", type: "court_concern" });
      if (v.factionStability < -40) {
        agenda.push({ priority: 9, topic: "党争日趋激烈，老臣忧心忡忡", type: "faction_conflict" });
      }
      agenda.push({ priority: 4, topic: "治国需用贤才。老臣举荐几人，望陛下考虑", type: "recommendation" });
      break;

    case "崔呈秀":
      agenda.push({ priority: 5, topic: "陛下近来过于操劳，臣看在眼里疼在心里", type: "flattery" });
      if (v.factionStability < -30) {
        agenda.push({ priority: 6, topic: "东林党那些人又在散布谣言，诋毁朝政", type: "attack_rivals" });
      }
      break;

    case "温体仁":
      agenda.push({ priority: 7, topic: "朝局之事，老臣以为宜稳不宜急", type: "caution" });
      if (v.factionStability < -50) {
        agenda.push({ priority: 6, topic: "朝中各方势力互不相让，老臣也只能尽力调和", type: "mediation" });
      }
      break;

    case "洪承畴":
      if (m.rebellionLevel > 50) {
        agenda.push({ priority: 10, topic: "陕西流寇已成燎原之势，臣兵力捉襟见肘", type: "rebel_crisis" });
      }
      if (e.treasury < 500000) {
        agenda.push({ priority: 8, topic: "军饷拖欠数月，将士们已怨声载道", type: "pay_concern" });
      }
      break;

    case "钱谦益":
      if (v.qingAggression > 65) {
        agenda.push({ priority: 8, topic: "江南士林对时局忧心忡忡", type: "scholar_concern" });
      }
      agenda.push({ priority: 5, topic: "臣近日在读前朝史书，有些心得想与陛下分享", type: "scholarship" });
      break;

    case "徐光启":
      if (v.famineIndex > 40) {
        agenda.push({ priority: 9, topic: "臣在天津试种甘薯已有成效，可在北方各省推广", type: "agriculture" });
      }
      if (v.borderTension > 60) {
        agenda.push({ priority: 8, topic: "澳门葡萄牙人可提供新式火炮，臣请陛下批准引进", type: "technology" });
      }
      agenda.push({ priority: 6, topic: "现行历法已有偏差，臣请旨修订", type: "calendar" });
      break;

    case "房壮丽":
      if (e.corruption > 50) {
        agenda.push({ priority: 9, topic: "吏治不修，则万事不举。臣请彻查各级官员", type: "anti_corruption" });
      }
      if (fate.status === "alive") {
        agenda.push({ priority: 5, topic: "臣近日查阅历年考功记录，发现诸多问题", type: "personnel" });
      }
      break;
  }

  // === 关系议题 ===
  if (relScore >= 60 && fate.status === "alive") {
    agenda.push({ priority: 5, topic: `对皇帝的忠诚和感激之情`, type: "loyalty" });
  }
  if (relScore < -30 && fate.status === "alive") {
    agenda.push({ priority: 5, topic: `对皇帝冷淡态度的隐晦不满`, type: "resentment" });
  }

  // 排序后取前 3 个
  return agenda.sort((a, b) => b.priority - a.priority).slice(0, 3);
}

/**
 * 获取角色相关的世界状态筛选
 * 不同角色的关注点不同
 */
function getRelevantWorldVars(npcName) {
  const char = characterRegistry.get(npcName);
  if (!char) return [];

  const faction = char.faction;
  switch (faction) {
    case "militaryGroup":
      return ["borderTension", "qingAggression", "rebelMomentum"];
    case "eunuch":
      return ["factionStability"];
    case "donglin":
      return ["famineIndex", "plagueLevel", "factionStability"];
    default:
      return ["factionStability", "famineIndex"];
  }
}

module.exports = { generateAgenda, getRelevantWorldVars };
