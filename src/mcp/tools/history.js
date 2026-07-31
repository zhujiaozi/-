/**
 * 历史事件工具
 *
 * 管理游戏中的关键历史事件时间线。
 * 提供当前事件检查与完整时间线查询。
 */
const { gameState } = require("../../state/game-state");

/**
 * 关键历史事件表
 * key: 回合编号, value: 事件详情
 */
const KEY_EVENTS = {
  8: {
    name: "己巳之变",
    year: "崇祯二年",
    desc: "后金皇太极率军突破长城防线，直逼北京城下。袁崇焕率军回援，后因阉党诬陷下狱。",
    effects: { popularSupport: -10, militaryMorale: -10, imperialAuthority: -5 },
  },
  18: {
    name: "后金远征林丹汗",
    year: "崇祯五年",
    desc: "后金出兵远征蒙古林丹汗，北方草原格局剧变，明朝失去牵制后金的力量。",
    effects: { rebellionLevel: 5 },
  },
  21: {
    name: "明末大鼠疫",
    year: "崇祯六年",
    desc: "大规模鼠疫爆发席卷华北，人口锐减，经济遭受重创，加速明朝崩溃。",
    effects: { popularSupport: -15, treasury: -500000 },
  },
  34: {
    name: "皇太极称帝",
    year: "崇祯九年",
    desc: "皇太极于盛京称帝，改国号为'大清'。明朝面对的不再是部落酋长，而是一个帝国。",
    effects: { imperialAuthority: -10 },
  },
  53: {
    name: "农民军攻克洛阳开封",
    year: "崇祯十四年",
    desc: "李自成农民军势如破竹，连下洛阳、开封。福王被杀，中原震动。",
    effects: { popularSupport: -10, treasury: -300000, rebellionLevel: 15 },
  },
  65: {
    name: "李自成攻陷北京",
    year: "崇祯十七年",
    desc: "李自成攻破北京城。崇祯帝自缢煤山，留下'诸臣误我'的遗言。吴三桂引清兵入关。大明覆亡。",
    effects: {},
    isEnding: true,
  },
};

/**
 * 检查当前回合是否有历史事件触发
 * 返回:
 *   - 当前回合有事件: { currentEvent, appliedEffects, isEnding }
 *   - 当前回合无事件: { currentEvent, lastEvent, nextEvent }
 */
async function checkHistoricalEvent(_args = {}) {
  const turnNum = gameState.getTurn().number;
  const event = KEY_EVENTS[turnNum];

  if (!event) {
    // 查找最近的历史事件
    const eventTurns = Object.keys(KEY_EVENTS)
      .map(Number)
      .sort((a, b) => a - b);
    const upcoming = eventTurns.find((t) => t > turnNum);
    const past = eventTurns.filter((t) => t <= turnNum).pop();

    return {
      currentEvent: null,
      lastEvent: past ? { turn: past, ...KEY_EVENTS[past] } : null,
      nextEvent: upcoming
        ? { turn: upcoming, turnsUntil: upcoming - turnNum, ...KEY_EVENTS[upcoming] }
        : null,
    };
  }

  return {
    currentEvent: { turn: turnNum, ...event },
    appliedEffects: event.effects || {},
    isEnding: event.isEnding || false,
  };
}

/**
 * 获取完整历史事件时间线
 * 每个事件标注状态: 已发生 / 正在发生 / 未发生
 */
async function getEventTimeline(_args = {}) {
  const currentTurn = gameState.getTurn().number;
  return Object.entries(KEY_EVENTS).map(([turn, event]) => {
    const t = parseInt(turn);
    let status;
    if (t < currentTurn) {
      status = "已发生";
    } else if (t === currentTurn) {
      status = "正在发生";
    } else {
      status = "未发生";
    }
    return {
      turn: t,
      name: event.name,
      year: event.year,
      status,
      brief: event.desc.slice(0, 50) + "...",
    };
  });
}

module.exports = { checkHistoricalEvent, getEventTimeline, KEY_EVENTS };
