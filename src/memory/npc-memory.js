/**
 * NPC 记忆存储
 *
 * 每个 NPC 在每个会话中有独立的对话历史。
 * 支持:
 * - 追加对话
 * - 检索最近 N 条
 * - 压缩旧对话为摘要
 * - 序列化/反序列化
 */
const { v4: uuidv4 } = require("uuid");

class NpcMemory {
  constructor(npcName, sessionId) {
    this.npcName = npcName;
    this.sessionId = sessionId;
    this.messages = [];       // [{role, content, timestamp}]
    this.compressed = "";     // 旧对话摘要
    this.compressedCount = 0; // 已压缩的消息数
    this.maxMessages = 50;    // 超过此数量触发压缩
    this.keepRecent = 10;     // 压缩后保留最近 N 条
  }

  /** 添加一条对话 */
  add(role, content) {
    // content 可能为 undefined/null 或 OpenAI 多模态数组——统一转字符串再截断
    if (Array.isArray(content)) {
      content = content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("\n");
    }
    content = String(content ?? "");
    this.messages.push({
      role,
      content: content.slice(0, 2000),
      timestamp: Date.now(),
    });
    // 触发压缩检查
    if (this.messages.length > this.maxMessages) {
      this._compress();
    }
  }

  /** 获取完整记忆 (压缩摘要 + 最近消息) */
  getContext() {
    const parts = [];
    if (this.compressed) {
      parts.push(`[Previous conversation summary with ${this.npcName}]: ${this.compressed}`);
      parts.push("");
    }
    parts.push(`[Recent dialogue with ${this.npcName}]:`);
    const recent = this.getRecent(this.keepRecent + 10);
    for (const msg of recent) {
      parts.push(`${msg.role === "user" ? "Emperor" : this.npcName}: ${String(msg.content ?? "").slice(0, 300)}`);
    }
    return parts.join("\n");
  }

  /** 获取最近 N 条消息 */
  getRecent(n = 10) {
    return this.messages.slice(-n);
  }

  /** 获取消息总数 */
  getMessageCount() {
    return this.messages.length + this.compressedCount;
  }

  /** 压缩: 取最早的消息生成摘要, 只保留最近 N 条 */
  _compress() {
    const toCompress = this.messages.slice(0, this.messages.length - this.keepRecent);
    if (toCompress.length === 0) return;

    // 简易压缩: 提取关键主题
    const topics = this._extractTopics(toCompress);
    const oldSummary = this.compressed;

    this.compressed = oldSummary
      ? `${oldSummary}\nLater: ${topics}`
      : `Early dialogue: ${topics}`;

    this.compressedCount += toCompress.length;
    this.messages = this.messages.slice(-this.keepRecent);
  }

  /** 从消息中提取关键主题 (简易版) */
  _extractTopics(msgs) {
    const keywords = [
      "辽东", "军饷", "税收", "反腐", "科举", "水利", "赈灾",
      "后金", "农民军", "李自成", "阉党", "东林", "募兵", "议和",
      "粮草", "城防", "流民", "瘟疫", "宗室", "漕运",
    ];
    const allText = msgs.map((m) => m.content).join(" ");
    const hits = keywords.filter((kw) => allText.includes(kw));
    return hits.length > 0 ? `Topics discussed: ${hits.join(", ")}` : "General discussion";
  }

  /** 清空记忆 */
  reset() {
    this.messages = [];
    this.compressed = "";
    this.compressedCount = 0;
  }

  /** 序列化 */
  toSnapshot() {
    return {
      messages: this.messages.slice(-100), // 最多保留 100 条
      compressed: this.compressed,
      compressedCount: this.compressedCount,
    };
  }

  /** 反序列化 */
  static fromSnapshot(data, npcName, sessionId) {
    const mem = new NpcMemory(npcName, sessionId);
    if (data.messages) mem.messages = data.messages;
    if (data.compressed) mem.compressed = data.compressed;
    if (data.compressedCount) mem.compressedCount = data.compressedCount;
    return mem;
  }
}

module.exports = { NpcMemory };
