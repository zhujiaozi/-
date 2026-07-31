/**
 * 生成 Steam Workshop 上传用的 .vdf 构建文件
 * 从 WORKSHOP.md 提取描述并转成 Steam BBCode 格式
 * 运行: node generate-vdf.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

// Steam Workshop 描述支持 BBCode: [b] [h1] [h2] [list] [*] [url]
const DESCRIPTION = `[b]⚠️ 重要：订阅下载后，必须双击模组文件夹里的 start.bat 启动本地引擎，再进游戏配置 BYOK，模组才会生效！[/b] 只订阅不启动引擎是无效的。引擎需要 Node.js 环境（https://nodejs.org 下载 LTS 版）。

[b]崇祯规则重构[/b] 是一个 BYOK（自带 API）规则引擎模组，不修改任何游戏文件，通过游戏内置的"自有 API"功能接管并增强 AI 逻辑。

[h1]👤 角色逻辑优化（核心）[/h1]
[list]
[*][b]9 位名臣独立角色卡[/b]：魏忠贤、袁崇焕、孙承宗、温体仁、洪承畴、钱谦益、徐光启、崔呈秀、房壮丽——各有结构化性格、政治立场、派系归属与说话方式
[*][b]真实历史命运线[/b]：每位大臣的命运参照史实设计，且能被你的选择改变——处死魏忠贤触发专属剧情（提前铲除/贬谪自尽），党羽连锁反应；己巳之变时你是否相信袁崇焕决定他的生死；徐光启的科学遗产、房壮丽的殉国……每条命运线都有独特叙事与数值影响
[*][b]关系系统[/b]：大臣对皇帝的态度（忠君/疏远/敌对/叛意）随你的决策动态变化，直接影响他们的言行与结局
[*][b]记忆系统[/b]：大臣记得你说过的话，多轮对话有连贯性，还有极低概率触发"皇帝梦"等隐藏叙事
[/list]

[h1]🏛️ 朝堂与决策[/h1]
[list]
[*][b]党派竞争[/b]：东林、阉党、武将集团三方势力此消彼长，政令分配给不同党派执行效果不同，派系过强会反噬皇权
[*][b]廷议讨论[/b]：各臣按自身立场与当前局势发言，不再千人一面
[*][b]决策真实生效[/b]：任命官员、国库收支、民心军力等改动通过游戏官方流程写库，说换内阁就真换内阁
[/list]

[h1]📜 内容增强[/h1]
[list]
[*][b]62 条明代史料检索[/b]：内阁制度、辽东风云、财政盐铁等背景按需注入，言之有据
[*][b]动态内容创建[/b]：诏书里写"创立锦衣卫"，引擎会跟踪你创建的新机构/军队/人物
[*][b]战略分析[/b]：每回合生成帝国态势报告与威胁预警
[/list]

[h1]🔧 安装（需要 Node.js）[/h1]
[list]
[*]1. 安装 Node.js（https://nodejs.org，LTS 版）
[*]2. 订阅后打开模组文件夹（创意工坊页面可"打开 Mod 文件夹"），双击 start.bat，保持窗口开着
[*]3. 游戏设置 → LLM 配置 → 添加自定义服务商
[*]4. Base URL 填 http://localhost:3456/v1 ，API Key 随意
[*]5. 角色模型建议：chat_model→cz-npc，court_model→cz-court，second_model→cz-edict，simulate_model→cz-simulate（也可全部填 cz-rules-v1）
[*]6. 每次玩之前都要先运行 start.bat
[/list]

推荐使用 proxy 模式（DeepSeek API Key，platform.deepseek.com 免费注册）：任命、国库等决策改动依赖 LLM 生成结构化指令才能落库。一局游戏 token 费用约几元。无 Key 的 deterministic 模式可体验对话与廷议，但数值改动不会写入游戏。`;

// KeyValues 没有转义机制：\" 会截断字符串。但 quoted string 支持真实换行，
// 所以描述里直接放换行符（不要用字面 \n——Steam 不会转换它）。
// 英文双引号成对替换为中文「」
function vdfText(s) {
  let open = true;
  return s.replace(/"/g, () => (open = !open) ? "」" : "「");
}

// 已发布过的物品要沿用原 publishedfileid（"0" 会创建新物品）
const outPath = path.join(DIST, "workshop.vdf");
let publishedFileId = "0";
try {
  const existing = fs.readFileSync(outPath, "utf8");
  const m = existing.match(/"publishedfileid"\s+"(\d+)"/);
  if (m && m[1] !== "0") publishedFileId = m[1];
} catch {}

const vdf = `"workshopitem"
{
	"appid"			"4304230"
	"publishedfileid"	"${publishedFileId}"
	"contentfolder"		"${path.join(DIST, "cz-rules-engine")}"
	"previewfile"		"${path.join(DIST, "cover.png")}"
	"title"			"崇祯规则重构"
	"description"		"${vdfText(DESCRIPTION)}"
	"changenote"		"v1.1.0 首次发布：角色逻辑优化，修复任命/奏折/国库改动不生效"
	"visibility"		"0"
}
`;

fs.writeFileSync(outPath, vdf, "utf8");
console.log("Written:", outPath, "| publishedfileid:", publishedFileId);
