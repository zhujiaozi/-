/**
 * 游戏状态 MCP 工具
 *
 * 提供游戏世界状态的查询接口:
 *   - getGameState:  完整状态快照
 *   - getEconomy:    经济详情含预警注释
 *   - getProvince:   单个省份查询
 *   - getMilitary:   军事详情含预警注释
 */
const { gameState } = require("../../state/game-state");

/**
 * 获取完整游戏状态
 * 返回: 回合、经济、军事、派系、社会阶层、当前政策、诏书历史数量
 */
async function getGameState(_args = {}) {
  const s = gameState.getState();
  return {
    turn: s.turn,
    economy: s.economy,
    military: s.military,
    factions: s.factions,
    socialClasses: s.socialClasses,
    activePolicies: s.activePolicies,
    edictHistoryCount: s.edictHistory.length,
  };
}

/**
 * 获取经济数据 (含预警注释)
 * 预警规则:
 *   treasury < 200000  -> 国库告急
 *   treasury > 1000000 -> 国库充裕
 *   corruption > 60    -> 腐败严重
 *   corruption > 35    -> 腐败上升
 *   popularSupport < 30 -> 民心涣散
 *   popularSupport > 60 -> 民心较稳
 *   imperialAuthority < 30 -> 皇权式微
 *   currencySupply < 30 -> 严重紧缩
 *   currencySupply > 60 -> 流通偏多
 */
async function getEconomy(_args = {}) {
  const e = gameState.getEconomy();
  const t = gameState.getTurn();

  return {
    turn: t.display,
    treasury: e.treasury,
    privyPurse: e.privyPurse,
    popularSupport: e.popularSupport,
    corruption: e.corruption,
    imperialAuthority: e.imperialAuthority,
    currencySupply: e.currencySupply,
    estimatedQuarterlyExpense: 150000,
    treasuryRunway: Math.floor(e.treasury / 150000),
    notes: {
      treasury:
        e.treasury < 200000
          ? "警告: 国库告急"
          : e.treasury > 1000000
            ? "国库充裕"
            : "正常",
      corruption:
        e.corruption > 60
          ? "警告: 腐败严重"
          : e.corruption > 35
            ? "腐败上升中"
            : "较轻",
      popularSupport:
        e.popularSupport < 30
          ? "警告: 民心涣散"
          : e.popularSupport > 60
            ? "民心较稳"
            : "正常",
      imperialAuthority:
        e.imperialAuthority < 30 ? "警告: 皇权式微" : "正常",
      currencySupply:
        e.currencySupply < 30
          ? "严重紧缩(通缩)"
          : e.currencySupply > 60
            ? "流通偏多"
            : "偏紧",
    },
  };
}

/**
 * 获取单个省份数据
 * 参数: codeName - 省份代号 (如 "1001_beijing")
 * 未找到时返回 error 及 availableCodes 列表
 */
async function getProvince(args = {}) {
  const codeName = args.codeName;
  if (!codeName) {
    return {
      error: "请提供省份代号",
      availableCodes: Object.keys(gameState.getAllProvinces()),
    };
  }
  const prov = gameState.getProvince(codeName);
  if (!prov) {
    return {
      error: `未找到省份 "${codeName}"`,
      availableCodes: Object.keys(gameState.getAllProvinces()),
    };
  }
  return prov;
}

/**
 * 获取军事数据 (含预警注释)
 * 预警规则:
 *   morale < 30       -> 士气低落
 *   morale > 60       -> 士气高昂
 *   supply < 30       -> 补给不足
 *   rebellionLevel > 50 -> 流寇肆虐
 *   rebellionLevel > 25 -> 叛乱上升
 */
async function getMilitary(_args = {}) {
  const m = gameState.getMilitary();
  return {
    ...m,
    notes: {
      morale:
        m.morale < 30 ? "警告: 士气低落" : m.morale > 60 ? "士气高昂" : "正常",
      supply: m.supply < 30 ? "警告: 补给不足" : "正常",
      rebellionLevel:
        m.rebellionLevel > 50
          ? "警告: 流寇肆虐"
          : m.rebellionLevel > 25
            ? "叛乱上升中"
            : "基本平稳",
    },
  };
}

module.exports = { getGameState, getEconomy, getProvince, getMilitary };
