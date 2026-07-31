/**
 * 简易 .env 加载器 — 零依赖
 * 在 server.js 最开头调用: require("./env-loader").load();
 */
const fs = require("fs");
const path = require("path");

function load() {
  const envPath = path.resolve(__dirname, "..", ".env");
  try {
    if (!fs.existsSync(envPath)) {
      // 从 .env.example 复制
      const examplePath = path.resolve(__dirname, "..", ".env.example");
      if (fs.existsSync(examplePath)) {
        fs.copyFileSync(examplePath, envPath);
        console.log("[Setup] Created .env from .env.example — edit it to configure API keys");
      }
      return;
    }
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      // 剥离 UTF-8 BOM 和 \r——Windows 记事本保存的 .env 常带 BOM，
      // 否则首行 key 会变成 "﻿DEEPSEEK_API_KEY"，真正的 key 静默失效
      const trimmed = line.replace(/^﻿/, "").trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim().replace(/^﻿/, "");
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (e) {
    // Silently fail — use defaults
  }
}

module.exports = { load };
