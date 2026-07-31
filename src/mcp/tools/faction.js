/**
 * 派系反应评估工具
 */
const { gameState } = require("../../state/game-state");

/**
 * 三大派系对政策的反应矩阵
 */
const FACTION_REACTIONS = {
  donglin: {
    name: "东林党",
    加税: { attitude: "反对", reason: "东林党认为加税加重百姓负担，违背儒家仁政理念", powerDelta: 0, suggestion: "建议削减宫廷开支以弥补财政，而非加征" },
    减税: { attitude: "支持", reason: "减免税赋符合东林党与民休息的一贯主张", powerDelta: 1, suggestion: null },
    反腐: { attitude: "强烈支持", reason: "东林党素以肃清吏治、整顿纲纪为己任", powerDelta: 2, suggestion: "建议彻查六部，制定整肃名册" },
    募兵: { attitude: "中立", reason: "东林党担心军费膨胀致使财政恶化", powerDelta: -1, suggestion: "建议精简编制，提高精锐部队占比" },
    议和: { attitude: "反对", reason: "东林党认为和谈有损国威，且后金不可信", powerDelta: -1, suggestion: "坚持战求和局，不可示弱于敌" },
    币制改革: { attitude: "支持", reason: "东林党认为币制混乱损害民生，改革有利稳定", powerDelta: 1, suggestion: null },
    赏赐: { attitude: "反对", reason: "东林党认为滥赏虚耗国库，助长侥幸之心", powerDelta: 0, suggestion: null },
  },
  eunuch: {
    name: "阉党",
    加税: { attitude: "支持", reason: "阉党可从加税中增加分润", powerDelta: 1, suggestion: "建议提高税率并扩大征收范围" },
    减税: { attitude: "反对", reason: "减税将压缩阉党的财源和运作空间", powerDelta: -1, suggestion: null },
    反腐: { attitude: "强烈反对", reason: "反腐直接威胁阉党的核心利益网", powerDelta: -2, suggestion: null },
    募兵: { attitude: "中立", reason: "阉党对募兵无直接利益关切，但可借机安插亲信", powerDelta: 0, suggestion: null },
    议和: { attitude: "支持", reason: "议和可节省军费支出，减少朝廷对武将的依赖", powerDelta: 1, suggestion: null },
    币制改革: { attitude: "反对", reason: "币制改革可能影响阉党控制的钱庄和私铸利益", powerDelta: -1, suggestion: null },
    赏赐: { attitude: "强烈支持", reason: "赏赐笼络是阉党获取利益的直接渠道", powerDelta: 2, suggestion: null },
  },
  militaryGroup: {
    name: "武将集团",
    加税: { attitude: "有条件支持", reason: "如能增加军费则支持", powerDelta: 1, suggestion: "建议将加征部分的五成拨为军费专款" },
    减税: { attitude: "中立", reason: "武将集团的财政来源主要是军费拨款，减税影响不直接", powerDelta: 0, suggestion: null },
    反腐: { attitude: "支持", reason: "武将集团长期受害于文官贪腐克扣军饷", powerDelta: 1, suggestion: null },
    募兵: { attitude: "强烈支持", reason: "增加兵力可提升武将集团的实力和话语权", powerDelta: 2, suggestion: "建议优先充实辽东前线边防兵力" },
    议和: { attitude: "反对", reason: "武将视议和为耻辱，且担心被朝廷弃用", powerDelta: -2, suggestion: null },
    币制改革: { attitude: "中立", reason: "武将集团对货币事务不特别关注", powerDelta: 0, suggestion: null },
    赏赐: { attitude: "支持", reason: "赏赐可激励将士，鼓舞军心士气", powerDelta: 1, suggestion: "建议赏赐前线将士以鼓舞士气" },
  },
};

async function evaluateFactionReaction(args = {}) {
  const action = args.action || "";
  const state = gameState.getState();

  // 匹配政策关键词（空 action 时 key.includes("") 恒真，会误命中第一个键——必须排除）
  const matchedActions = action
    ? Object.keys(FACTION_REACTIONS.donglin).filter((key) =>
        action.includes(key) || key.includes(action)
      )
    : [];

  const matchKey = matchedActions.length > 0 ? matchedActions[0] : null;
  const results = {};

  for (const [factionKey, factionData] of Object.entries(FACTION_REACTIONS)) {
    const reaction = matchKey ? factionData[matchKey] : null;
    if (reaction) {
      results[factionKey] = {
        factionName: factionData.name,
        currentPower: state.factions[factionKey]?.power || 0,
        ...reaction,
      };
    } else {
      results[factionKey] = {
        factionName: factionData.name,
        currentPower: state.factions[factionKey]?.power || 0,
        attitude: "中立",
        reason: "此政策与该派系核心利益无明显关联",
        powerDelta: 0,
        suggestion: null,
      };
    }
  }

  // 汇总建议
  const allSuggestions = Object.values(results)
    .map((r) => r.suggestion)
    .filter(Boolean);

  return {
    action,
    matchedPolicy: matchKey || "未匹配到已知政策类型",
    factionReactions: results,
    summary: generateFactionSummary(results),
    suggestions: allSuggestions,
  };
}

function generateFactionSummary(results) {
  const support = Object.entries(results).filter(([, r]) => r.attitude.includes("支持") && !r.attitude.includes("反对"));
  const oppose = Object.entries(results).filter(([, r]) => r.attitude.includes("反对"));
  const neutral = Object.entries(results).filter(
    ([, r]) => !r.attitude.includes("支持") && !r.attitude.includes("反对")
  );

  const parts = [];
  if (support.length > 0) parts.push(`【支持派】${support.map(([, r]) => r.factionName).join("、")}`);
  if (oppose.length > 0) parts.push(`【反对派】${oppose.map(([, r]) => r.factionName).join("、")}`);
  if (neutral.length > 0) parts.push(`【中立派】${neutral.map(([, r]) => r.factionName).join("、")}`);

  return parts.join(" | ");
}

async function predictRebellion(_args = {}) {
  const s = gameState.getState();
  const riskLevel =
    s.economy.popularSupport < 20 ? "极高" :
    s.economy.popularSupport < 35 ? "高" :
    s.economy.popularSupport < 50 ? "中等" : "较低";

  return {
    riskLevel,
    factors: {
      popularSupport: s.economy.popularSupport,
      rebellionLevel: s.military.rebellionLevel,
      treasury: s.economy.treasury,
    },
    recommendedActions: [
      s.economy.popularSupport < 40 && "赈灾减税以挽回民心",
      s.military.rebellionLevel > 30 && "增兵镇压必要叛乱地区",
      s.economy.treasury < 200000 && "开源节流优先保证军饷",
    ].filter(Boolean),
  };
}

module.exports = { evaluateFactionReaction, predictRebellion };
