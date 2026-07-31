/**
 * 命运上下文注入器
 *
 * 在 NPC 对话/廷议/诏书等 AI 调用时, 注入角色的历史命运基线
 * 和当前偏离程度。AI 基于这些信息动态判断角色命运走向,
 * 而不是走预设的分支。
 */

const { characterRegistry } = require("../characters/registry");
const { UNIQUE_FATES } = require("./unique-fates");

/**
 * 为一个 NPC 生成命运上下文, 注入到 AI prompt 中
 *
 * @param {string} npcName - NPC 名字
 * @param {object} relationship - 关系追踪器中的该 NPC 数据
 * @param {object} worldState - 世界状态
 * @param {object} npcMemory - 该 NPC 的对话记忆
 * @param {object} gameState - 游戏状态
 * @returns {string} 注入 prompt 的上下文文本
 */
function generateFateContext(npcName, relationship, worldState, npcMemory, gameState) {
  const char = characterRegistry.get(npcName);
  if (!char) return "";

  const uniqueFate = UNIQUE_FATES[npcName];
  const relScore = relationship?.score || 0;
  const relLevel = getRelLabel(relScore);
  const turn = gameState.turn;

  const parts = [];
  parts.push(`[Fate Trajectory: ${npcName}]`);

  // 1. 历史基线 — 这个人"本该"怎样
  if (uniqueFate) {
    parts.push(`Historical baseline: ${uniqueFate.historicalFate}`);
  }

  // 2. 当前偏离程度 — AI 自行判断
  const deviation = calculateDeviation(npcName, relScore, worldState, gameState);
  parts.push(`Current trajectory: ${deviation.summary}`);

  // 3. 关键转折点 — 即将发生的命运事件
  const upcoming = getUpcomingTriggers(npcName, uniqueFate, { relScore, worldState, turn });
  if (upcoming.length > 0) {
    parts.push(`Upcoming fate crossroads:`);
    for (const u of upcoming) {
      parts.push(`  - ${u.name}: ${u.condition}. ${u.narrative}`);
    }
  }

  // 4. 对话记忆摘要
  if (npcMemory && npcMemory.getMessageCount() > 0) {
    const recentMsgs = npcMemory.getRecent(4);
    const topics = recentMsgs.map((m) => m.content.slice(0, 60)).join(" | ");
    parts.push(`Recent interactions: ${topics}`);
  }

  // 5. 自我认知 — 角色如何看待自己 (可能与实际偏离)
  parts.push(`Self-perception: ${char.selfPerception}`);

  // 6. 给 AI 的指引
  parts.push(`Guidance: ${generateGuidance(npcName, deviation, relScore, worldState)}`);

  return parts.join("\n");
}

/**
 * 计算命运偏离程度
 */
function calculateDeviation(npcName, relScore, worldState, gameState) {
  const turn = gameState.turn.number;
  const v = worldState.vars;

  switch (npcName) {
    case "魏忠贤":
      if (relScore <= -60) return {
        deviation: "significant_departure",
        summary: `皇帝已决心铲除他, 关系${relScore}。与历史不同——历史上崇祯即位后就贬谪了他, 但如果皇帝留用, 魏忠贤可能继续掌权。当前阉党势力仍在。`,
      };
      if (relScore >= 0) return {
        deviation: "major_departure",
        summary: `皇帝对他态度缓和, 关系${relScore}。这与历史严重偏离——历史上魏忠贤在崇祯即位当年就被清洗。他现在可能以为自己安全了, 正在暗中巩固势力。`,
      };
      return {
        deviation: "on_track",
        summary: `皇帝对他保持警惕, 关系${relScore}。接近历史轨迹——魏忠贤的倒台只是时间问题。`,
      };

    case "袁崇焕":
      if (relScore >= 40) return {
        deviation: "major_departure",
        summary: `皇帝对他极为信任, 关系${relScore}。与历史严重偏离——历史上的反间计之所以成功, 正是因为崇祯对他有疑心。现在这道裂痕不存在, 皇太极的反间计可能完全失效。`,
      };
      if (relScore >= 15) return {
        deviation: "moderate_departure",
        summary: `关系尚可(${relScore}), 但不够牢固。历史上崇祯正是在这个阶段被反间计动摇。如果第8回合前关系能突破40, 反间计可能被识破。`,
      };
      return {
        deviation: "on_track",
        summary: `关系${relScore}, 信任正在瓦解。这接近历史轨迹——一旦己巳之变发生, 反间计的种子就会在皇帝心中生根。`,
      };

    case "洪承畴":
      const songshanClose = v.borderTension > 80 && v.qingAggression > 65;
      if (songshanClose && relScore >= 30) return {
        deviation: "major_departure",
        summary: `松山危机临近, 但皇帝对他支持有加(关系${relScore})。与历史不同——足够的朝廷支持可能让他在松山突围成功, 不会有被俘降清的机会。`,
      };
      if (songshanClose && relScore < -20) return {
        deviation: "on_track",
        summary: `松山危机临近, 皇帝对他冷淡(关系${relScore})。接近历史轨迹——兵败被俘后, 感到被朝廷抛弃的洪承畴很可能降清。`,
      };
      return {
        deviation: "pending",
        summary: `尚未到松山的关键时刻。当前关系${relScore}将决定他能否在未来的危机中幸存。`,
      };

    case "钱谦益":
      if (relScore >= 50) return {
        deviation: "major_departure",
        summary: `皇帝与他的关系极为牢固(${relScore})。与历史严重偏离——历史上他因软弱而降清, 但高度的信任和尊重可能激发他内心真正的勇气。柳如是也不必独自投水。`,
      };
      if (relScore < -10 && v.qingAggression > 70) return {
        deviation: "on_track",
        summary: `关系冷淡(${relScore}), 清军压力日增。正在滑向历史轨迹——那句"水太冷"正在逼近。`,
      };
      return {
        deviation: "pending",
        summary: `关系(${relScore})尚不足以改变他的性格。他的软弱是骨子里的, 需要持续的激励才能克服。`,
      };

    case "房壮丽":
      if (v.borderTension > 80) return {
        deviation: "on_track",
        summary: `清军逼近他的家乡。以他的气节, 投井死节几乎是必然——他从来不怕死。但皇帝如果在他生前给予足够的荣誉, 他会死得更安心。`,
      };
      return {
        deviation: "pending",
        summary: `关系${relScore}。他是少数不需要担心叛变的臣子——他的问题从来不是忠诚, 而是身体能否撑到胜利那天。`,
      };

    default:
      return {
        deviation: "baseline",
        summary: `当前关系${relScore}。尚无重大偏离历史轨迹的迹象。`,
      };
  }
}

/**
 * 获取即将触发的命运节点
 */
function getUpcomingTriggers(npcName, uniqueFate, ctx) {
  if (!uniqueFate) return [];
  const upcoming = [];

  for (const path of uniqueFate.paths) {
    // 已触发的跳过
    // 检查是否接近触发条件
    let nearTrigger = false;
    let condText = "";

    switch (path.trigger.condition) {
      case "turn":
        if (path.trigger.equals && Math.abs(ctx.turn.number - path.trigger.equals) <= 3) {
          nearTrigger = true;
          condText = `将在第${path.trigger.equals}回合触发`;
        }
        break;
      case "world":
        const v = ctx.worldState.vars;
        const gaps = [];
        if (path.trigger.borderTension) gaps.push(`边境紧张度需达${path.trigger.borderTension}(当前${v.borderTension.toFixed(0)})`);
        if (path.trigger.qingAggression) gaps.push(`清军侵略需达${path.trigger.qingAggression}(当前${v.qingAggression.toFixed(0)})`);
        if (gaps.length > 0) {
          nearTrigger = true;
          condText = gaps.join(", ");
        }
        break;
    }

    if (nearTrigger) {
      upcoming.push({ name: path.name, condition: condText, narrative: path.narrative });
    }
  }

  return upcoming;
}

/**
 * 生成 AI 指引 — 告诉 AI 如何根据偏离程度来决定角色的言行
 */
function generateGuidance(npcName, deviation, relScore, worldState) {
  const char = characterRegistry.get(npcName);
  const base = `角色性格: ${char.personality.slice(0, 80)}`;

  switch (deviation.deviation) {
    case "major_departure":
      return `${base}\n历史正在被显著改变。${npcName}的言行应体现出这种变化——他察觉到了命运的转向。不要按照历史剧本走, 要根据当前关系(${relScore})和局势来回应。`;
    case "moderate_departure":
      return `${base}\n命运正在偏离, 但还不够稳固。${npcName}的言行应体现出不确定性——他在观察, 在试探。历史仍有可能回到原轨。`;
    case "significant_departure":
      return `${base}\n出现了明显的命运分叉。${npcName}的言行应反映他意识到了局势的变化, 但还不确定这意味着什么。`;
    case "on_track":
      return `${base}\n命运正在沿着历史轨迹运行。${npcName}的言行应符合他的历史形象。但注意——只要玩家还在行动, 一切都可能改变。`;
    default:
      return `${base}\n命运尚未进入关键阶段。${npcName}应表现出平常的状态, 但AI应留意任何可能改变他命运走向的细节。`;
  }
}

function getRelLabel(score) {
  if (score >= 80) return "死忠";
  if (score >= 40) return "信任";
  if (score >= 0) return "中立";
  if (score >= -40) return "疏远";
  if (score >= -80) return "敌对";
  return "叛意";
}

module.exports = { generateFateContext };
