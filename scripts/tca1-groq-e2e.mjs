#!/usr/bin/env node

process.env.TCA1_LLM_PROVIDER = "groq";
await import("./tca1-openai-e2e.mjs");
