export interface QueueLine {
  period: string;
  amount: number | null;
  denda: number | null;
}

export interface QueueSlice {
  period: string;
  amount: number;
  denda: number;
  collfee: number;
}

const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MONTH_INDEX: Record<string, string> = {
  januari: "01", februari: "02", maret: "03", april: "04", mei: "05", juni: "06",
  juli: "07", agustus: "08", september: "09", oktober: "10", november: "11", desember: "12",
};

export function allocateExact(total: number, count: number): number[] {
  const size = Math.max(1, count);
  const safe = Math.max(0, Math.round(Number.isFinite(total) ? total : 0));
  const base = Math.floor(safe / size);
  const rest = safe - base * size;
  return Array.from({ length: size }, (_, index) => base + (index === size - 1 ? rest : 0));
}

export function scaleTo(values: number[], target: number): number[] {
  const safe = Math.max(0, Math.round(Number.isFinite(target) ? target : 0));
  if (values.length === 0) return [];
  const sum = values.reduce((total, value) => total + value, 0);
  if (sum === safe) return values.slice();
  if (sum <= 0) return allocateExact(safe, values.length);
  const raw = values.map((value) => Math.floor((safe * value) / sum));
  const drift = safe - raw.reduce((total, value) => total + value, 0);
  raw[raw.length - 1] += drift;
  return raw;
}

function monthTokens(text: string): string[] {
  const named: string[] = [];
  const pattern = /(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(20\d{2})/gi;
  for (const match of text.matchAll(pattern)) {
    const month = MONTH_INDEX[match[1].toLowerCase()];
    if (month) named.push(`${match[2]}${month}`);
  }
  if (named.length > 0) return named;
  return text.replace(/\D/g, "").match(/20\d{2}(?:0[1-9]|1[0-2])/g) ?? [];
}

function lembarCount(text: string): number {
  const match = text.match(/(\d+)\s+lembar/i);
  const count = match ? Number(match[1]) : 0;
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function titledMonth(token: string): string {
  const match = token.match(/^(20\d{2})(0[1-9]|1[0-2])$/);
  if (!match) return token.startsWith("lembar-") ? `Lembar ${token.slice(7)}` : token;
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
}

function detectedTokens(period: string, lines: QueueLine[]): string[] {
  const seen = new Set<string>();
  const named: string[] = [];
  for (const text of [period, ...lines.map((line) => line.period)]) {
    for (const token of monthTokens(text)) {
      if (seen.has(token)) continue;
      seen.add(token);
      named.push(token);
    }
  }
  const lembar = Math.max(lembarCount(period), ...lines.map((line) => lembarCount(line.period)), 0);
  const count = Math.max(named.length, lembar);
  if (count <= 1) return named;
  const tokens = named.slice();
  while (tokens.length < count) tokens.push(`lembar-${tokens.length + 1}`);
  return tokens;
}

function matchedShares(lines: QueueLine[], tokens: string[]) {
  const singles = lines.flatMap((line) => {
    const tokensInLine = monthTokens(line.period);
    if (tokensInLine.length !== 1 || line.amount == null) return [];
    return [{ token: tokensInLine[0], amount: line.amount, denda: line.denda ?? 0 }];
  });
  if (singles.length !== tokens.length || tokens.some((token) => token.startsWith("lembar-"))) return null;
  const byToken = new Map(singles.map((line) => [line.token, line]));
  if (!tokens.every((token) => byToken.has(token))) return null;
  return tokens.map((token) => byToken.get(token)!);
}

export function expandBillRows(input: { period: string; lines: QueueLine[]; amount: number; denda: number; collfee: number }): QueueSlice[] {
  const tokens = detectedTokens(input.period, input.lines);
  if (tokens.length <= 1) {
    return [{
      period: tokens.length === 1 ? titledMonth(tokens[0]) : input.period,
      amount: Math.max(0, Math.round(input.amount) || 0),
      denda: Math.max(0, Math.round(input.denda) || 0),
      collfee: Math.max(0, Math.round(input.collfee) || 0),
    }];
  }
  const matched = matchedShares(input.lines, tokens);
  const amountTarget = input.amount > 0 ? input.amount : matched?.reduce((sum, line) => sum + line.amount, 0) ?? 0;
  const dendaTarget = input.denda > 0 ? input.denda : matched?.reduce((sum, line) => sum + line.denda, 0) ?? 0;
  const amounts = matched ? scaleTo(matched.map((line) => line.amount), amountTarget) : allocateExact(amountTarget, tokens.length);
  const dendas = matched ? scaleTo(matched.map((line) => line.denda), dendaTarget) : allocateExact(dendaTarget, tokens.length);
  const fees = allocateExact(input.collfee, tokens.length);
  return tokens.map((token, index) => ({
    period: titledMonth(token),
    amount: amounts[index] ?? 0,
    denda: dendas[index] ?? 0,
    collfee: fees[index] ?? 0,
  }));
}

export function applyGroupAdmin<T extends { key: string; payKey?: string; providerRef?: string; amount: number; denda: number }>(rows: T[], admin: number) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.payKey || row.providerRef || row.key;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const share = new Map<string, number>();
  for (const group of groups.values()) {
    const parts = allocateExact(admin, group.length);
    group.forEach((row, index) => share.set(row.key, parts[index] ?? 0));
  }
  return rows.map((row) => {
    const adminShare = share.get(row.key) ?? admin;
    return { ...row, admin: adminShare, total: row.amount + row.denda + adminShare };
  });
}
