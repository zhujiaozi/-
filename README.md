# 崇祯规则引擎 — 创意工坊模组

## 这是什么

一个 BYOK 规则引擎，通过游戏自带的"自有 API"功能接管 AI 调用。不修改任何游戏文件。

## 安装

1. 安装 Node.js（如果没装过）：https://nodejs.org 下载 LTS 版，一路下一步
2. 下载本模组整个文件夹，解压到任意位置
3. 双击 `start.bat` → 首次运行自动安装依赖 → 启动服务器
4. 游戏设置 → LLM 配置 → 添加自定义服务商
5. Base URL: `http://localhost:3456/v1`，API Key: 随意填
6. 角色模型建议分别配置（效果更好）：
   - chat_model（大臣对话）→ `cz-npc`
   - court_model（廷议）→ `cz-court`
   - second_model（诏书润色）→ `cz-edict`
   - simulate_model_1 / 2（推演）→ `cz-simulate`
   - 嫌麻烦就全部填 `cz-rules-v1`

## 模式

| 模式 | 配置 | 说明 |
|------|------|------|
| **外部 LLM（推荐）** | `CZ_MODE=proxy` + DeepSeek Key | 完整体验。游戏的三阶段推演（落库）依赖 LLM 生成结构化指令——任命官员、国库数值等改动只有这个模式才会真正写进游戏 |
| 内置引擎 | `CZ_MODE=deterministic` | 无需 API Key，轻量体验。大臣对话、廷议可用，但**任命/数值改动无法落库**（这是游戏机制的限制：写库指令必须由 LLM 生成） |

**建议用 proxy 模式。** DeepSeek API Key 在 https://platform.deepseek.com 注册领取，一局游戏大约消耗几元钱的 token。

## 工作原理

```
游戏请求 ──┬─ 带游戏工具的请求（落库/奏折/任命解析）→ 原样透传给 LLM → tool_calls 原样返回游戏
           └─ 普通请求（NPC聊天/廷议/推演）→ 场景路由 → MCP 工具 + RAG 检索 + 角色卡 → LLM → 返回
```

- **MCP 工具** (14 个)：状态查询、数值计算、知识检索。LLM 调用工具获取精确数据，不靠脑补。
- **RAG 向量检索** (62 条史料)：按需检索相关历史背景，不把全部知识塞进 prompt。
- **角色卡** (9 个 NPC)：每个 NPC 有结构化性格、关系约束、独特命运线。

## 功能

| 系统 | 说明 |
|------|------|
| 场景路由 | 自动识别诏书/NPC对话/廷议/模拟推演/结局 |
| NPC 对话 | 角色卡 + 关系 + RAG 预取实体 + 记忆上下文 |
| 诏书执行 | 决策解析 → MCP 计算效果 → 党派分配 → 派系反应 |
| 党派竞争 | 东林/阉党/武将，政令分配→势力变化→皇权代价 |
| NPC 命运 | 9 人各有真实历史命运线，可被玩家选择改变（如处死魏忠贤触发专属剧情） |
| 动态创建 | 诏书里写"创立锦衣卫"→引擎跟踪新实体 |
| 安全防护 | 4 层：场景权限 + 可见性 + 护栏 + 注入检测 |
| 存档 | 自动保存/恢复 session + 状态 + 记忆（原子写入 + 备份） |

## API 端点

| 端点 | 说明 |
|------|------|
| `GET /v1/models` | 模型列表 |
| `POST /v1/chat/completions` | 主推理 |
| `GET /v1/causality/relationships` | NPC 关系 |
| `GET /v1/causality/world` | 世界状态 |
| `GET /v1/causality/fates` | NPC 命运 |
| `GET /v1/causality/factions` | 党派对比 |
| `GET /v1/dynamic-entities` | 玩家创建的实体 |
| `GET /v1/token-stats` | token 消耗统计 |
| `POST /v1/session/new` | 新建游戏 |
| `POST /v1/session/reset` | 重置 |
| `POST /v1/archives/create` | 存档 |
| `POST /v1/archives/restore` | 读档 |

## 环境变量 (`.env`)

首次运行 start.bat 会自动从 `.env.example` 复制一份 `.env`，用记事本编辑：

```env
CZ_MODE=proxy                    # proxy(推荐) 或 deterministic
CZ_CACHE_MODE=off                # off 或 unified (OpenAI/Claude 用)
DEEPSEEK_API_KEY=sk-xxx          # proxy 模式必填
```

## 技术栈

Node.js + Express，14 个 MCP 工具，SimpleTFIDF 嵌入（自动升级到 Transformers.js 或 API），内存向量库（兼容 ChromaDB）。

