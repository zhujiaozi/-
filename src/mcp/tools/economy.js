/**
 * 经济模拟工具
 *
 * 提供经济系统的模拟推演与收入预估:
 *   - simulateEconomy: 模拟未来 N 回合的经济变化
 *   - projectRevenue:  预估当前季度收入明细
 */
const { gameState } = require("../../state/game-state");

/**
 * 模拟经济推演
 * 参数: turns - 模拟回合数 (1-20)
 * 返回: 每个回合的国库/民心/腐败/货币流通量的投影数据
 *
 * 模拟逻辑:
 *   - 每回合固定支出约 150000 两，含随机波动
 *   - 民心自然下降
 *   - 腐败自然上升
 *   - 货币流通缓慢萎缩
 *   - 国库耗尽后民心加速下降
 */
async function simulateEconomy(args = {}) {
  const turns = Math.min(20, Math.max(1, args.turns || 4));
  const state = gameState.getState();
  const e = { ...state.economy };
  const projections = [];

  for (let i = 1; i <= turns; i++) {
    // 季度收入（与 projectRevenue 的 160000 一致）+ 固定支出，均含随机波动
    // 原实现只有支出没有收入，任何模拟都必然得出"国库耗尽"的结论
    e.treasury += 160000 + Math.round(Math.random() * 20000);
    e.treasury -= 150000 + Math.round(Math.random() * 30000);
    // 民心自然变化
    e.popularSupport -= 0.3 + Math.random() * 0.3;
    e.popularSupport = Math.max(0, e.popularSupport);
    // 腐败自然增长
    e.corruption += 0.3 + Math.random() * 0.2;
    e.corruption = Math.min(100, e.corruption);
    // 货币流通缓慢变化
    e.currencySupply -= 0.1 + Math.random() * 0.1;
    e.currencySupply = Math.max(0, e.currencySupply);

    // 国库耗尽惩罚
    if (e.treasury < 0) {
      e.treasury = 0;
      e.popularSupport -= 5;
    }

    projections.push({
      turn: i,
      treasury: Math.round(e.treasury),
      popularSupport: Math.round(e.popularSupport * 10) / 10,
      corruption: Math.round(e.corruption * 10) / 10,
      currencySupply: Math.round(e.currencySupply * 10) / 10,
    });
  }

  return {
    currentTurn: state.turn.display,
    projections,
    summary: {
      treasuryChange:
        projections[projections.length - 1].treasury - state.economy.treasury,
      projectedRunway:
        state.economy.treasury > 0
          ? `约 ${Math.floor(state.economy.treasury / 150000)} 个季度`
          : "国库已空",
      warning:
        e.treasury <= 0
          ? "警告: 如不干预，国库将在模拟期内耗尽"
          : null,
    },
  };
}

/**
 * 预估当前季度收入明细
 * 返回各项收入估算及净结余
 */
async function projectRevenue(_args = {}) {
  // 简化版收入预估
  return {
    estimatedQuarterlyTaxRevenue: 120000,
    estimatedQuarterlyCustomsRevenue: 15000,
    estimatedQuarterlyMonopolyRevenue: 25000,
    totalEstimatedIncome: 160000,
    fixedExpenses: 150000,
    netQuarterlyBalance: 10000,
    note:
      "当前处于通货紧缩环境，实际收入可能低于预估值。建议增加商业流通以提升税收。",
  };
}

module.exports = { simulateEconomy, projectRevenue };
