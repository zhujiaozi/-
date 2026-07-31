/**
 * 强制注入 BYOK 配置到游戏 localStorage
 * 运行: node force-byok.js
 * 然后重新打开游戏即可生效
 */
const fs = require("fs");
const path = require("path");

// 游戏 localStorage 路径 (Electron LevelDB)
const LS_DIR = path.join(process.env.APPDATA, "aigame", "Local Storage", "leveldb");

// 要注入的配置
const CUSTOM_PROVIDER = {
  id: "cz_rules_engine",
  builtin: false,
  name: "CZ Rules Engine",
  base_url: "http://localhost:3456/v1",
  api_key: "cz-rules-v1",
  api_key_url: "",
  extra_headers: {},
  params_override: {},
};

// 所有角色模型统一指向我们的服务器
const STRATEGY = {
  id: "cz_default",
  name: "CZ Rules",
  roles: {
    chat_model:        { provider: "cz_rules_engine", model: "cz-npc" },
    court_model:       { provider: "cz_rules_engine", model: "cz-court" },
    second_model:      { provider: "cz_rules_engine", model: "cz-edict" },
    simulate_model_1:  { provider: "cz_rules_engine", model: "cz-simulate" },
    simulate_model_2:  { provider: "cz_rules_engine", model: "cz-simulate" },
  },
};

const CONFIG = {
  version: 2,
  providers: {
    deepseek: { builtin: true, name: "DeepSeek", base_url: "https://api.deepseek.com", api_key: "", api_key_url: "https://platform.deepseek.com/api_keys", params_override: { tool_choice: "auto", thinking: { type: "disabled" } } },
    cz_rules_engine: CUSTOM_PROVIDER,
  },
  strategies: [STRATEGY],
  activeStrategyId: "cz_default",
};

// 生成 localStorage key (需要知道 userId)
// 从实际游戏读取的概率极高
function findUserId() {
  try {
    const prefsFile = path.join(process.env.APPDATA, "aigame", "Preferences");
    if (fs.existsSync(prefsFile)) {
      const prefs = JSON.parse(fs.readFileSync(prefsFile, "utf8"));
      return prefs.userId || prefs.user_id || null;
    }
  } catch {}
  return null;
}

function generateConfigScript(config, userId) {
  const lsKey = `llm_config_${userId}`;
  const strategyKey = `byok_active_strategy_key_${userId}`;
  return `
// Copy and paste this entire block into the game's DevTools console (F12 or Ctrl+Shift+I)
// Or save to localStorage directly:

localStorage.setItem('${lsKey}', ${JSON.stringify(JSON.stringify(config))});
localStorage.setItem('${strategyKey}', ${JSON.stringify(JSON.stringify("cz_default"))});
console.log('BYOK config injected. Restart the game.');
  `.trim();
}

const userId = findUserId();
if (userId) {
  console.log("Found userId:", userId);
  console.log(generateConfigScript(CONFIG, userId));
} else {
  console.log("Could not find userId automatically.");
  console.log("Please open the game, press F12, and paste this in the console:");
  console.log("");
  console.log("(function(){");
  console.log("  const keys = Object.keys(localStorage).filter(k => k.includes('llm_config'));");
  console.log("  if (keys.length > 0) {");
  console.log("    const userId = keys[0].replace('llm_config_', '');");
  console.log("    const config = " + JSON.stringify(CONFIG, null, 2) + ";");
  console.log('    localStorage.setItem("llm_config_" + userId, JSON.stringify(config));');
  console.log('    localStorage.setItem("byok_active_strategy_key_" + userId, JSON.stringify("cz_default"));');
  console.log('    console.log("BYOK injected for userId:", userId);');
  console.log("  } else {");
  console.log('    console.log("No existing BYOK config found. Play the game once first.");');
  console.log("  }");
  console.log("})();");
}
