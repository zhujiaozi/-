const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const config = {
  port: parseInt(process.env.CZ_PORT || "3456", 10),
  chroma: { path: process.env.CZ_CHROMA_PATH || path.join(ROOT, "data", "chroma") },
  embedding: { model: process.env.CZ_EMBED_MODEL || "Xenova/bge-small-zh-v1.5", dimension: 512 },
  rag: { defaultTopK: 5, maxChunkSize: 512, chunkOverlap: 64 },
  llm: {
    defaultProvider: process.env.CZ_LLM_PROVIDER || "deepseek",
    providers: {
      deepseek: { baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY || "", model: "deepseek-chat" },
      openai: { baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com", apiKey: process.env.OPENAI_API_KEY || "", model: "gpt-4o-mini" },
      local: { baseUrl: process.env.LOCAL_LLM_URL || "http://localhost:8080", apiKey: "not-needed", model: "local-model" },
    },
  },
  logLevel: process.env.CZ_LOG_LEVEL || "info",
  defaultGameState: {
    turn: { number: 1, era: "崇祯", year: 1, season: "春", display: "崇祯1年春" },
    economy: { treasury: 3000000, privyPurse: 500000, popularSupport: 65, corruption: 45, imperialAuthority: 70, currencySupply: 40 },
    military: { totalTroops: 80000, morale: 55, supply: 60, borderStatus: "Alert", rebellionLevel: 25 },
    factions: {
      donglin: { name: "Donglin Faction", power: 45, attitude: "neutral" },
      eunuch: { name: "Eunuch Faction", power: 35, attitude: "hostile" },
      militaryGroup: { name: "Military Faction", power: 20, attitude: "neutral" },
    },
    socialClasses: {
      military: { name: "Military", satisfaction: 40 },
      imperialClan: { name: "Imperial Clan", satisfaction: 60 },
      gentry: { name: "Gentry", satisfaction: 50 },
      farmers: { name: "Farmers", satisfaction: 35 },
      bureaucrats: { name: "Bureaucrats", satisfaction: 55 },
      eunuchs: { name: "Eunuchs", satisfaction: 50 },
    },
  },
};

module.exports = config;
