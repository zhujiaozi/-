/**
 * NPC 工具 -- 角色档案查询
 *
 * 提供游戏中 NPC 角色的查询接口:
 *   - getNpcProfile:   单个 NPC 完整档案
 *   - getNpcList:      所有 NPC 摘要列表
 *   - getNpcByFaction: 按派系筛选 NPC
 */
const { characterRegistry } = require("../../characters/registry");

/**
 * 获取单个 NPC 的完整档案
 * 参数: name - NPC 姓名 (如 "魏忠贤", "袁崇焕")
 * 未找到时返回 error 和已知 NPC 列表
 */
async function getNpcProfile(args = {}) {
  const name = args.name || "";
  const char = characterRegistry.get(name);
  if (!char) {
    const list = characterRegistry.listNames();
    return {
      error: `未找到 "${name}"`,
      knownNpcs: list,
      hint: `可用角色: ${list.join("、")}`,
    };
  }
  return char.toProfile();
}

/**
 * 获取所有 NPC 的摘要列表
 * 返回: 每个 NPC 的姓名、职位、派系、性格摘要
 */
async function getNpcList(_args = {}) {
  return characterRegistry.listNames().map((name) => {
    const c = characterRegistry.get(name);
    return {
      name: c.name,
      role: c.role,
      faction: c.faction,
      briefPersonality: c.personality.slice(0, 20) + "...",
    };
  });
}

/**
 * 按派系筛选 NPC
 * 参数: faction - 派系名称 (如 "eunuch", "donglin", "militaryGroup")
 * 返回: 该派系下所有 NPC 的姓名、职位、性格
 */
async function getNpcByFaction(args = {}) {
  const faction = args.faction || "";
  const names = characterRegistry.listNames();
  return names
    .filter((n) => characterRegistry.get(n).faction === faction)
    .map((n) => {
      const c = characterRegistry.get(n);
      return { name: c.name, role: c.role, personality: c.personality };
    });
}

module.exports = { getNpcProfile, getNpcList, getNpcByFaction };
