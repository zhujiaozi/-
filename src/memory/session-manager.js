/**
 * 会话管理器
 *
 * 管理游戏会话生命周期:
 * - 创建新会话 (新局)
 * - 切换会话 (读档)
 * - 结束会话
 * - 按 session_id 隔离所有 NPC 记忆
 */
const { v4: uuidv4 } = require("uuid");
const { NpcMemory } = require("./npc-memory");

class Session {
  constructor(id) {
    this.id = id;
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this.npcMemories = new Map();  // npcName -> NpcMemory
    this.turnNumber = 0;
  }

  getNpcMemory(npcName) {
    if (!this.npcMemories.has(npcName)) {
      this.npcMemories.set(npcName, new NpcMemory(npcName, this.id));
    }
    return this.npcMemories.get(npcName);
  }

  touch() { this.lastActive = Date.now(); }

  toSnapshot() {
    const memories = {};
    for (const [name, mem] of this.npcMemories) {
      memories[name] = mem.toSnapshot();
    }
    return {
      id: this.id,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
      turnNumber: this.turnNumber,
      npcMemories: memories,
    };
  }

  static fromSnapshot(data) {
    const s = new Session(data.id);
    s.createdAt = data.createdAt || Date.now();
    s.lastActive = data.lastActive || Date.now();
    s.turnNumber = data.turnNumber || 0;
    if (data.npcMemories) {
      for (const [name, snap] of Object.entries(data.npcMemories)) {
        s.npcMemories.set(name, NpcMemory.fromSnapshot(snap, name, s.id));
      }
    }
    return s;
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.activeSessionId = null;
  }

  /** 创建新会话 (新游戏开局) */
  createSession() {
    const id = uuidv4().slice(0, 8);
    const session = new Session(id);
    this.sessions.set(id, session);
    this.activeSessionId = id;
    return session;
  }

  /** 获取当前活跃会话 */
  getActive() {
    if (!this.activeSessionId) return this.createSession();
    if (!this.sessions.has(this.activeSessionId)) {
      this.activeSessionId = null;
      return this.createSession();
    }
    return this.sessions.get(this.activeSessionId);
  }

  /** 获取指定 NPC 在当前会话中的记忆 */
  getActiveNpcMemory(npcName) {
    return this.getActive().getNpcMemory(npcName);
  }

  /** 切换到指定会话 (读档) */
  setActive(sessionId) {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Session "${sessionId}" not found`);
    }
    this.activeSessionId = sessionId;
    return this.sessions.get(sessionId);
  }

  /** 获取会话 */
  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /** 删除会话及其所有 NPC 记忆 */
  delete(sessionId) {
    this.sessions.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  /** 列出所有会话 */
  list() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastActive: s.lastActive,
      turnNumber: s.turnNumber,
      npcCount: s.npcMemories.size,
    }));
  }

  /** 重置当前会话 (重新开始, 清空所有记忆) */
  resetActive() {
    const oldId = this.activeSessionId;
    if (oldId) this.sessions.delete(oldId);
    return this.createSession();
  }

  /** 导出为可序列化数据 */
  exportAll() {
    return {
      activeSessionId: this.activeSessionId,
      sessions: Array.from(this.sessions.values()).map((s) => s.toSnapshot()),
    };
  }

  /** 从序列化数据恢复 */
  importAll(data) {
    this.sessions.clear();
    if (data.sessions) {
      for (const snap of data.sessions) {
        this.sessions.set(snap.id, Session.fromSnapshot(snap));
      }
    }
    this.activeSessionId = data.activeSessionId;
  }
}

const sessionManager = new SessionManager();

module.exports = { Session, SessionManager, sessionManager };
