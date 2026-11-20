import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importLedgerSnapshot, type LedgerEnv } from "./ledger";

let imported = false;

function legacyPaths() {
  const paths: string[] = [];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    paths.push(path.join(here, "data", "ledger.json"));
  } catch {
    /* bundler may rewrite import.meta.url */
  }
  paths.push(path.join(process.cwd(), "server", "data", "ledger.json"));
  paths.push(path.join(os.tmpdir(), "mentari-nusantara-ledger.json"));
  return [...new Set(paths)];
}

function readLegacy() {
  const snapshot = { wallets: {} as Record<string, number>, tickets: [] as unknown[], sales: [] as unknown[], mutations: [] as unknown[] };
  for (const filePath of legacyPaths()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as typeof snapshot;
      Object.assign(snapshot.wallets, parsed.wallets ?? {});
      for (const row of parsed.tickets ?? []) snapshot.tickets.push(row);
      for (const row of parsed.sales ?? []) snapshot.sales.push(row);
      for (const row of parsed.mutations ?? []) snapshot.mutations.push(row);
    } catch {
      /* file lama tidak ada */
    }
  }
  return snapshot;
}

export async function importLegacyLedger(env: LedgerEnv) {
  if (imported) return;
  const snapshot = readLegacy();
  const hasRows = snapshot.tickets.length > 0 || snapshot.sales.length > 0 || snapshot.mutations.length > 0 || Object.keys(snapshot.wallets).length > 0;
  if (!hasRows) {
    imported = true;
    return;
  }
  const result = await importLedgerSnapshot(env, snapshot).catch(() => null);
  if (result && !result.error) imported = true;
}
