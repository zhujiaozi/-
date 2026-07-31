# 崇祯规则引擎 v2 — 架构设计文档

## 替换清单

### 原版 AI 端点 → 替换方式

```
原版游戏 AI 管线:
  游戏客户端 → wunhope.com 后端 → 拼一个巨大 prompt → LLM → 返回文本
  问题: 一个 prompt 要塞角色+历史+规则+数值, LLM 负担过重, 必然出错

替换后:
  游戏客户端 → 本地 MCP Server → RAG检索+MCP工具+角色卡 → LLM → 返回文本
```

| 原版被替换内容 | MCP 工具接管 | RAG 接管 | 角色卡接管 |
|---------------|-------------|---------|-----------|
| `/game/edict/refine` 诏书润色 | ✅ 格式模板 | ✅ 诏书范例 | — |
| `/game/edict/confirm` 诏书执行判定 | ✅ 规则引擎计算 | ✅ 类似历史案例 | — |
| `/npc/chat/stream` 大臣对话 | ✅ getGameState() | ✅ 该人物历史言行 | ✅ NPC角色卡 |
| `/npc/court-discussion/*` 廷议 | ✅ 派系博弈模型 | ✅ 明代廷议记录 | ✅ 各派系角色卡 |
| 回合推进后的模拟推演 | ✅ 经济/军事模型 | ✅ 历史趋势数据 | — |
| `/byok/memory-compression/*` 记忆压缩 | — | ✅ 向量摘要存储 | — |

## 三层架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                     游戏客户端 (Electron)                    │
│                   BYOK 配置 → localhost:3456                 │
└───────────────────────┬─────────────────────────────────────┘
                        │ POST /v1/chat/completions
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              MCP Server (localhost:3456)                     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ 角色卡系统    │  │ MCP 工具层    │  │ RAG 向量库       │  │
│  │              │  │              │  │                  │  │
│  │ • NPC角色定义 │  │ • gameState  │  │ • 明史/实录      │  │
│  │ • 派系立场    │  │ • edictCalc  │  │ • 制度文档       │  │
│  │ • 说话风格    │  │ • factionAI  │  │ • 人物传记       │  │
│  │ • 世界设定    │  │ • economy    │  │ • 对话记忆       │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         └─────────────────┼────────────────────┘            │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    │ Prompt 组装  │                          │
│                    │ + LLM 调用   │                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1: 角色卡系统（借鉴 SillyTavern）

**灵感来源**: 酒馆 (SillyTavern) 的 Character Card + World Info + 场景系统

```
/npc/chat/stream → 角色卡注入
  角色卡结构:
    - name: "魏忠贤"
    - role: "司礼监秉笔太监"
    - personality: "阴险狡诈,善于察言观色,野心极大"
    - faction: "阉党"
    - speech_style: "低声下气中暗藏锋芒,每句话都以'奴才'自称"
    - goals: ["掌控朝政", "排挤东林党", "积累私财"]
    - world_knowledge: ["熟知内廷运作", "掌握东厂情报网"]

  每次对话时, 角色卡作为 system prompt 第一部分注入,
  保证 NPC 言行一致, 不会"跳戏"。
```

### Layer 2: MCP 工具层（结构化计算）

**为什么用 MCP**: LLM 擅长语言理解但不擅长数学和逻辑。把数值计算
和状态查询抽成工具函数, LLM 只负责"决定调用哪个工具"和"把结果转成自然语言"。

```
MCP 工具清单:

📊 状态查询类 (LLM 调用这些获取精确数据):
  - getGameState()        → 返回当前国库/民心/腐败/皇权等全部指标
  - getProvince(name)     → 返回某省人口/税赋/忠诚/稳定
  - getNpcProfile(name)   → 返回 NPC 完整角色卡
  - getFactionStatus()    → 返回各派系势力对比
  - getSeasonalFocus()    → 返回当前季度重心

⚙️ 计算模拟类 (LLM 调用这些获取计算结果):
  - calculateEdictEffect(decisions[]) → 输入决策列表, 返回经济/政治/军事效果
  - simulateEconomy(turns)            → 模拟 N 回合经济走势
  - evaluateFactionReaction(action)   → 预测各派系对某政策的反应
  - checkHistoricalEvent(turn)        → 检查当前回合是否触发关键事件

📚 知识检索类 (LLM 调用这些获取匹配的历史知识):
  - searchHistory(query, topK)        → 从向量库检索相关史料
  - searchMemory(npc, query, topK)    → 检索与该 NPC 的历史对话
  - searchEdicts(query, topK)         → 检索类似历史诏书

🛠️ 工具辅助类:
  - formatEdict(text)       → 将白话转为正式诏书格式
  - summarizeDiscussion()   → 生成廷议摘要
```

**关键变化**: 原版 LLM 要自己算出 "加税50万两会降5点民心", 
现在 LLM 调用 `calculateEdictEffect`, 工具函数用数学模型计算,
LLM 只需把结果转成："陛下，加征税赋虽可充实国库，然恐引起民怨..."

### Layer 3: RAG 向量知识库

**为什么用 RAG**: 原版把历史知识硬塞进 prompt, token 浪费且不准。
RAG 按需检索, 只把相关的知识片段注入 prompt。

```
知识库分片策略:

数据源:
  1. 《明史》节选 — 制度/人物/事件
  2. 《崇祯实录》 — 时间线事件
  3. 明代经济数据 — 税率/物价/人口
  4. 游戏自定义 — 规则参数/事件脚本

向量化流程:
  文档 → 分块(512 tokens/chunk, 128 overlap) 
       → embedding (bge-small-zh) 
       → Qdrant 本地存储

检索触发:
  - 诏书涉及"税" → 检索明代赋税制度 + 类似历史决策 + 前几次加税效果
  - 对话提到"袁崇焕" → 检索该人物传记 + 辽东战事 + 之前对话记录
  - 廷议讨论"辽东" → 检索辽东地理 + 后金实力 + 历年战况
```

## 为什么这样设计

### 1. 为什么用 MCP 而不是全塞进 prompt？
**原版问题**: prompt 里写了 "当前国库300万两，民心65...", LLM 自己在脑内做数学——不稳定。
**MCP 方案**: LLM 调用 `getGameState()` 拿到精确数值, 调用 `calculateEdictEffect()` 用确定性模型计算。LLM 只做它最擅长的事——叙事和语言组织。

### 2. 为什么用 RAG 而不是知识硬编码？
**原版问题**: prompt 里把所有历史背景都写上, 5000 tokens 里可能只有 500 相关。
**RAG 方案**: 按需检索, 只注入最相关的 500 tokens 史料。既节省上下文, 又提高准确性。

### 3. 为什么用角色卡而不是 prompt 指令？
**原版问题**: 每次对话 AI 都要重新"理解"魏忠贤是谁, 偶尔角色崩坏。
**角色卡方案**: 固定的角色定义, 每次对话自动注入, 保证"魏忠贤永远是魏忠贤"。

### 4. 为什么游戏 BYOK → 本地服务, 而不是修改游戏文件？
- 游戏主进程是 `.jsc` 字节码, 无法修改
- BYOK 是游戏自带的合法扩展点
- 零修改, 不影响 Steam 验证

## 数据流示例

```
玩家在诏书界面: "朕决定加征辽饷，募兵两万"

1. 游戏后端 prepare → 拼装 context (含游戏状态、当前回合等)
2. 游戏 BYOK → POST localhost:3456/v1/chat/completions
3. 本地 MCP Server:
   a. RAG 检索: "加税" + "募兵" → 检索明代辽饷历史、历次加税后果
   b. MCP 工具: calculateEdictEffect([{type:"tax",amount:200000}, {type:"recruit",count:20000}])
     返回: {treasury:+150000, popularSupport:-8, corruption:+3, troops:+20000}
   c. 角色卡: (如果是大臣对话场景) 注入对应 NPC 角色定义
   d. 组装优化后的 prompt → 调用真实 LLM
   e. LLM 返回叙事文本
4. 返回游戏 → 显示诏书执行结果
```

## 技术栈选择

| 组件 | 选择 | 原因 |
|------|------|------|
| 框架 | Node.js + Express | 轻量, 游戏本身就是 Node/Electron |
| MCP 协议 | @modelcontextprotocol/sdk | 标准 MCP, 工具可被任何 MCP 客户端调用 |
| 向量库 | Qdrant (本地模式) | 支持中文, 嵌入式运行, 无需额外服务 |
| Embedding | bge-small-zh-v1.5 | 中文最佳小模型, 本地方案 |
| LLM 调用 | OpenAI 兼容 API (透传) | 兼容游戏 BYOK 配置的任意服务商 |

## 实现计划

### Phase 1: MCP 工具层 (核心 — 本周完成)
- 实现 MCP Server 骨架
- 实现核心工具: getGameState / calculateEdictEffect / checkHistoricalEvent
- 游戏状态机 (从游戏请求中提取和跟踪)

### Phase 2: 角色卡系统 (本周完成)
- SillyTavern 风格的角色卡格式
- 6个核心 NPC 角色卡
- 廷议场景卡

### Phase 3: RAG 知识库 (下周)
- 准备明代史料语料
- Qdrant 向量库集成
- 检索管道: query → embedding → search → rerank → inject

### Phase 4: 联调与微调
- 在实际游戏中测试 BYOK 配置
- 调优 prompt 模板
- 记录和修复边界情况
