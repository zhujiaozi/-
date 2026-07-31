/**
 * 存档管理器
 *
 * 本地文件系统存档, 兼容原版游戏的存档概念:
 * - 创建存档 (包含完整 session 数据 + gameState)
 * - 读取存档
 * - 列出存档
 * - 删除存档
 */
const fs = require("fs");
const path = require("path");
const { sessionManager } = require("../memory/session-manager");
const { gameState, GameState } = require("../state/game-state");
const { deepMerge } = require("../state/deep-merge");

const ARCHIVE_DIR = path.resolve(__dirname, "..", "..", "data", "archives");

/** 校验 sessionId，防路径遍历（importArchive 的 id 来自用户提供的 JSON） */
function safeId(sessionId) {
  const id = String(sessionId || "");
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid session id: "${id.slice(0, 32)}"`);
  }
  return id;
}

class ArchiveManager {
  constructor() {
    if (!fs.existsSync(ARCHIVE_DIR)) {
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }
  }

  /** 创建存档 */
  createArchive(name) {
    const session = sessionManager.getActive();
    const data = {
      name: name || `Archive ${new Date().toISOString().slice(0, 10)}`,
      createdAt: Date.now(),
      session: session.toSnapshot(),
      gameState: gameState.getState(),
    };
    const filename = `${safeId(session.id)}.json`;
    const filepath = path.join(ARCHIVE_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
    return { id: session.id, name: data.name, filepath };
  }

  /** 读取存档并恢复 */
  restoreArchive(sessionId) {
    const id = safeId(sessionId);
    const filepath = path.join(ARCHIVE_DIR, `${id}.json`);
    if (!fs.existsSync(filepath)) {
      throw new Error(`Archive "${id}" not found`);
    }
    const raw = fs.readFileSync(filepath, "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Archive "${id}" is corrupted: ${e.message}`);
    }
    if (!data.session) {
      throw new Error(`Archive "${id}" is missing session data`);
    }

    // 恢复 session——始终以存档文件为准，覆盖内存中的同 id session
    // （原实现在 session 已存在时沿用内存旧数据，读档结果与存档不符）
    const { Session } = require("../memory/session-manager");
    sessionManager.sessions.set(id, Session.fromSnapshot(data.session));
    sessionManager.setActive(id);

    // 恢复 gameState——以完整新建状态为基底深合并，补齐缺失字段
    if (data.gameState) {
      const fresh = JSON.parse(JSON.stringify(new GameState().getState()));
      deepMerge(fresh, data.gameState);
      gameState.state = fresh;
    }

    return { id, name: data.name, createdAt: data.createdAt };
  }

  /** 列出所有存档 */
  listArchives() {
    if (!fs.existsSync(ARCHIVE_DIR)) return [];
    const files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
      const filepath = path.join(ARCHIVE_DIR, f);
      try {
        const raw = fs.readFileSync(filepath, "utf8");
        const data = JSON.parse(raw);
        return {
          id: data.session?.id || f.replace(".json", ""),
          name: data.name || "Unknown",
          createdAt: data.createdAt || 0,
          turnNumber: data.gameState?.turn?.number || 0,
          npcCount: data.session?.npcMemories
            ? Object.keys(data.session.npcMemories).length
            : 0,
        };
      } catch {
        return { id: f.replace(".json", ""), name: f, error: "Corrupted" };
      }
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /** 删除存档文件（不动内存中的 session——玩家可能还在这个会话里玩） */
  deleteArchive(sessionId) {
    const id = safeId(sessionId);
    const filepath = path.join(ARCHIVE_DIR, `${id}.json`);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    return true;
  }

  /** 导出存档为字符串 (用于分享) */
  exportArchive(sessionId) {
    const id = safeId(sessionId);
    const filepath = path.join(ARCHIVE_DIR, `${id}.json`);
    if (!fs.existsSync(filepath)) {
      throw new Error(`Archive "${id}" not found`);
    }
    return fs.readFileSync(filepath, "utf8");
  }

  /** 从导入字符串创建存档 */
  importArchive(jsonStr) {
    const data = JSON.parse(jsonStr);
    const sessionId = safeId(data.session?.id);
    if (!sessionId) throw new Error("Invalid archive: missing session id");
    const filepath = path.join(ARCHIVE_DIR, `${sessionId}.json`);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
    return this.restoreArchive(sessionId);
  }
}

const archiveManager = new ArchiveManager();

module.exports = { ArchiveManager, archiveManager };
