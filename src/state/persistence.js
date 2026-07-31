/**
 * 持久化层
 *
 * 自动保存/恢复: session、gameState、NPC记忆、关系、世界状态、命运、党派
 * 保存触发: 每次 edict 处理后 + 进程退出时
 * 恢复: 服务启动时自动加载
 */
const fs = require("fs");
const path = require("path");

const SAVE_FILE = path.resolve(__dirname, "..", "..", "data", "autosave.json");
const SAVE_INTERVAL = 30000; // 每30秒检查一次

const { deepMerge } = require("./deep-merge");

class Persistence {
  constructor(deps) {
    this.deps = deps; // { sessionManager, gameState, relationshipTracker, worldState, fateEngine, factionEngine }
    this.dirty = false;
    this._startAutoSave();
    this._restore();
  }

  /** 标记需要保存 */
  markDirty() { this.dirty = true; }

  /** 立即保存 */
  save() {
    try {
      const data = {
        savedAt: Date.now(),
        session: this.deps.sessionManager.exportAll(),
        gameState: this.deps.gameState.getState(),
        relationships: this.deps.relationshipTracker.toSnapshot(),
        worldState: this.deps.worldState.toSnapshot(),
        fates: this.deps.fateEngine.toSnapshot(),
        factions: this.deps.factionEngine.toSnapshot(),
      };
      const dir = path.dirname(SAVE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // 原子写入：先写临时文件再 rename，并保留上一份 .bak——
      // 进程在写入中途被杀时不会得到截断的 JSON（那会毁掉全部进度）
      const tmpFile = SAVE_FILE + ".tmp";
      const bakFile = SAVE_FILE + ".bak";
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf8");
      if (fs.existsSync(SAVE_FILE)) {
        try { fs.copyFileSync(SAVE_FILE, bakFile); } catch {}
      }
      fs.renameSync(tmpFile, SAVE_FILE);
      this.dirty = false;
      console.log(`[Persist] Saved to ${SAVE_FILE}`);
    } catch (e) {
      console.error(`[Persist] Save failed: ${e.message}`);
    }
  }

  /** 从磁盘恢复 */
  _restore() {
    try {
      if (!fs.existsSync(SAVE_FILE)) {
        console.log("[Persist] No autosave found, starting fresh");
        return;
      }
      let raw = fs.readFileSync(SAVE_FILE, "utf8");
      let data;
      try {
        data = JSON.parse(raw);
      } catch (parseErr) {
        // 主存档损坏 → 尝试 .bak 备份
        const bakFile = SAVE_FILE + ".bak";
        if (fs.existsSync(bakFile)) {
          console.error(`[Persist] Autosave corrupted (${parseErr.message}), trying .bak`);
          raw = fs.readFileSync(bakFile, "utf8");
          data = JSON.parse(raw);
        } else {
          throw parseErr;
        }
      }
      if (data.session) this.deps.sessionManager.importAll(data.session);
      if (data.gameState) {
        // 以一份完整的新建状态为基底深合并——旧存档缺少的新增字段
        // （含 reset() 添加的运行时字段）用默认值补齐，避免跨版本恢复后
        // 访问 undefined 字段崩溃
        const fresh = JSON.parse(JSON.stringify(new (this.deps.gameState.constructor)().getState()));
        deepMerge(fresh, data.gameState);
        this.deps.gameState.state = fresh;
      }
      if (data.relationships) {
        const { RelationshipTracker } = require("../causality/relationship");
        const restored = RelationshipTracker.fromSnapshot(data.relationships);
        this.deps.relationshipTracker.relationships = restored.relationships;
      }
      if (data.worldState) {
        const { WorldState } = require("../causality/world-state");
        Object.assign(this.deps.worldState.vars, data.worldState.vars || {});
      }
      if (data.fates) {
        const { FateEngine } = require("../causality/fate-engine");
        const restored = FateEngine.fromSnapshot(data.fates);
        this.deps.fateEngine.fates = restored.fates;
      }
      if (data.factions) {
        const { FactionEngine } = require("../causality/faction-engine");
        const restored = FactionEngine.fromSnapshot(data.factions);
        this.deps.factionEngine.factions = restored.factions;
      }
      console.log(`[Persist] Restored from ${SAVE_FILE} (saved ${new Date(data.savedAt).toLocaleString()})`);
    } catch (e) {
      console.error(`[Persist] Restore failed: ${e.message}, starting fresh`);
    }
  }

  _startAutoSave() {
    this._saveTimer = setInterval(() => {
      if (this.dirty) this.save();
    }, SAVE_INTERVAL);
    if (this._saveTimer && this._saveTimer.unref) this._saveTimer.unref(); // Don't block process exit

    // 进程退出时保存
    const doSave = () => { if (this.dirty) { try { this.save(); } catch {} } };
    process.on("SIGINT", () => { doSave(); process.exit(); });
    process.on("SIGTERM", () => { doSave(); process.exit(); });
    process.on("beforeExit", doSave);
  }
}

module.exports = { Persistence };
