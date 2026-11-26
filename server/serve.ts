import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { apiEnvFrom, handleNodeApi } from "./handleApi";

function loadDotEnv(file = ".env") {
  try {
    const text = readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Environment dari systemd tetap dipakai bila file .env tidak ada.
  }
}

loadDotEnv();

const port = Number(process.env.API_PORT || 8787);
const host = process.env.API_HOST || "0.0.0.0";
const origin = process.env.API_CORS_ORIGIN || "*";
const env = apiEnvFrom(process.env);

const server = createServer({ maxHeaderSize: 131072 }, async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-callback-secret");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  try {
    await handleNodeApi(req, res, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "API VPS gagal diproses.";
    if (res.writableEnded) return;
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
    }
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(port, host, () => {
  console.log(`API Mentari berjalan di http://${host}:${port}`);
});
