import { recordLoketSale, walletBalance, type LedgerEnv } from "./ledger";

export type BillerMode = "simulation" | "h2h";
export type PaymentStatus = "simulated" | "pending" | "success" | "failed" | "refunded";

export interface BillQuote {
  customerName: string;
  period: string;
  amount: number;
  denda: number;
  adminFee: number;
  collfee: number;
  total: number;
}

interface InquiryInput {
  category: string;
  product: string;
  customerNumber: string;
  adminFee: number;
  months?: string;
  taxYear?: string;
}

interface PayInput extends InquiryInput {
  clientRef: string;
  customerName?: string;
  amount?: number;
  tagihan?: number;
  denda?: number;
  collfee?: number;
  period?: string;
  loketName?: string;
  loketCode?: string;
  parentId?: string;
  outcome?: "pending" | "success" | "failed" | "refund";
}

interface ProviderResult {
  outcome: "pending" | "success" | "failed";
  providerRef?: string;
  message?: string;
}

interface BillerProvider {
  inquire(input: InquiryInput): Promise<{ status: "found" | "not_found" | "unavailable"; message?: string; bill?: BillQuote; providerRef?: string }>;
  submit(input: InquiryInput & { clientRef: string; bill: BillQuote; providerRef?: string }): Promise<ProviderResult>;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function simulationBill(input: InquiryInput): BillQuote | null {
  const digits = input.customerNumber.replace(/\D/g, "");
  if (digits.length < 5) return null;
  const prepaid = input.product.match(/Prepaid\s+(\d+)/i);
  const fixed = prepaid ? Number(prepaid[1]) * 1000 : null;
  const tail = Number(digits.slice(-5)) || 10000;
  const amount = fixed ?? (15000 + (tail % 250000));
  const denda = fixed ? 0 : (tail % 9 === 0 ? 2000 : 0);
  const months = input.category === "BPJS" ? Math.max(1, Number(input.months) || 1) : 1;
  const billAmount = amount * months;
  const billFine = denda * months;
  const period = input.category === "BPJS"
    ? `${String(months).padStart(2, "0")} Bulan`
    : input.category === "Pajak PBB" && input.taxYear
      ? input.taxYear
      : new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  return {
    customerName: `Pelanggan ${digits.slice(-4)}`,
    period,
    amount: billAmount,
    denda: billFine,
    adminFee: input.adminFee,
    collfee: 0,
    total: billAmount + billFine + input.adminFee,
  };
}

const simulationProvider: BillerProvider = {
  async inquire(input) {
    const bill = simulationBill(input);
    if (!bill) return { status: "not_found", message: "Nomor minimal 5 digit." };
    return { status: "found", bill, providerRef: `sim-${input.customerNumber}` };
  },
  async submit() {
    return { outcome: "success", message: "Simulasi tidak memanggil penyedia biller." };
  },
};

function h2hConfigured() {
  return Boolean(process.env.BILLER_H2H_URL && process.env.BILLER_H2H_KEY);
}

async function h2hCall(path: string, payload: Record<string, unknown>) {
  const base = process.env.BILLER_H2H_URL || "";
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BILLER_H2H_KEY || ""}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) return { ok: false, body, message: "Penyedia biller tidak menjawab." };
  return { ok: true, body, message: "" };
}

const h2hProvider: BillerProvider = {
  async inquire(input) {
    if (!h2hConfigured()) {
      return { status: "unavailable", message: "Sambungan biller sungguhan belum diisi. Saldo tidak berubah." };
    }
    try {
      const result = await h2hCall("/inquiry", {
        category: input.category,
        product: input.product,
        customerNumber: input.customerNumber,
        adminFee: input.adminFee,
      });
      if (!result.ok || result.body?.found === false) return { status: "not_found", message: "Tagihan tidak ditemukan di penyedia." };
      const amount = Number(result.body?.amount) || 0;
      const denda = Number(result.body?.denda) || 0;
      const adminFee = Number(result.body?.adminFee ?? input.adminFee) || 0;
      const collfee = Number(result.body?.collfee) || 0;
      return {
        status: "found",
        providerRef: clean(result.body?.providerRef),
        bill: {
          customerName: clean(result.body?.customerName) || "Pelanggan",
          period: clean(result.body?.period),
          amount,
          denda,
          adminFee,
          collfee,
          total: amount + denda + adminFee + collfee,
        },
      };
    } catch {
      return { status: "unavailable", message: "Penyedia biller tidak dapat dihubungi. Saldo tidak berubah." };
    }
  },
  async submit(input) {
    if (!h2hConfigured()) return { outcome: "failed", message: "Sambungan biller sungguhan belum diisi." };
    try {
      const result = await h2hCall("/payment", {
        providerRef: input.providerRef,
        clientRef: input.clientRef,
        customerNumber: input.customerNumber,
        amount: input.bill.total,
      });
      const outcome = result.body?.outcome;
      if (outcome === "success" || outcome === "pending" || outcome === "failed") {
        return { outcome, providerRef: clean(result.body?.providerRef) || input.providerRef, message: clean(result.body?.message) };
      }
      return { outcome: "failed", message: "Jawaban penyedia tidak dikenali. Saldo tidak dipotong." };
    } catch {
      return { outcome: "pending", message: "Jawaban penyedia tertunda. Saldo belum dipotong sampai status berhasil." };
    }
  },
};

function providerFor(mode: BillerMode) {
  return mode === "h2h" ? h2hProvider : simulationProvider;
}

export function requestedMode(value: unknown): BillerMode {
  return value === "production" || value === "h2h" ? "h2h" : "simulation";
}

export async function inquireBill(mode: BillerMode, input: InquiryInput) {
  return providerFor(mode).inquire(input);
}

export async function runBillerPayment(env: LedgerEnv, actorId: string, mode: BillerMode, input: PayInput) {
  if (mode === "simulation") {
    const quote = simulationBill({ ...input, customerNumber: input.customerNumber });
    const amount = Number(input.amount) || quote?.total || 0;
    const result = await recordLoketSale(env, actorId, {
      ...input,
      amount,
      tagihan: Number(input.tagihan) || quote?.amount || 0,
      denda: Number(input.denda) || quote?.denda || 0,
      adminFee: input.adminFee,
      collfee: Number(input.collfee) || 0,
      period: input.period || quote?.period || "",
      customerName: input.customerName || quote?.customerName || "Pelanggan",
      channel: "simulation",
      outcome: "success",
    });
    return { ...result, paymentStatus: "simulated" as PaymentStatus, mode };
  }

  if (input.outcome === "refund") {
    return { error: "Pengembalian saldo hanya dicatat setelah penyedia menyatakan transaksi berhasil.", status: 409, balance: await walletBalance(env, actorId), paymentStatus: "failed" as PaymentStatus, mode };
  }

  const inquiry = await h2hProvider.inquire(input);
  if (inquiry.status !== "found" || !inquiry.bill) {
    const balance = await walletBalance(env, actorId);
    return { error: inquiry.message || "Tagihan tidak dapat dicek.", status: inquiry.status === "not_found" ? 404 : 409, balance, paymentStatus: "failed" as PaymentStatus, mode };
  }
  const pending = await recordLoketSale(env, actorId, {
    ...input,
    amount: inquiry.bill.total,
    tagihan: inquiry.bill.amount,
    denda: inquiry.bill.denda,
    adminFee: inquiry.bill.adminFee,
    collfee: inquiry.bill.collfee,
    period: inquiry.bill.period,
    customerName: inquiry.bill.customerName,
    channel: "production",
    outcome: "pending",
  });
  if (pending.error || !pending.sale) return { ...pending, paymentStatus: "failed" as PaymentStatus, mode };
  const submitted = await h2hProvider.submit({ ...input, bill: inquiry.bill, providerRef: inquiry.providerRef });
  const settled = await recordLoketSale(env, actorId, {
    ...input,
    amount: inquiry.bill.total,
    tagihan: inquiry.bill.amount,
    denda: inquiry.bill.denda,
    adminFee: inquiry.bill.adminFee,
    collfee: inquiry.bill.collfee,
    period: inquiry.bill.period,
    customerName: inquiry.bill.customerName,
    channel: "production",
    outcome: submitted.outcome === "pending" ? "pending" : submitted.outcome,
  });
  return { ...settled, error: settled.error || (submitted.outcome === "failed" ? submitted.message : undefined), paymentStatus: submitted.outcome, mode };
}

export async function handleBillerRequest(method: string, pathname: string, body: Record<string, unknown>, actorId: string, env: LedgerEnv) {
  if (pathname === "/api/biller/inquiry" && method === "POST") {
    const mode = requestedMode(body.mode ?? body.channel);
    const result = await inquireBill(mode, {
      category: clean(body.category),
      product: clean(body.product),
      customerNumber: clean(body.customerNumber),
      adminFee: Number(body.adminFee) || 0,
      months: clean(body.months),
      taxYear: clean(body.taxYear),
    });
    if (result.status !== "found") return { status: result.status === "not_found" ? 404 : 409, body: { error: result.message, mode, statusText: result.status } };
    return { status: 200, body: { mode, statusText: "found", bill: result.bill, providerRef: result.providerRef } };
  }
  if (pathname === "/api/biller/pay" && method === "POST") {
    const mode = requestedMode(body.mode ?? body.channel);
    const result = await runBillerPayment(env, actorId, mode, {
      clientRef: clean(body.clientRef),
      category: clean(body.category),
      product: clean(body.product),
      customerNumber: clean(body.customerNumber),
      customerName: clean(body.customerName),
      adminFee: Number(body.adminFee) || 0,
      amount: Number(body.amount) || 0,
      tagihan: Number(body.tagihan) || 0,
      denda: Number(body.denda) || 0,
      collfee: Number(body.collfee) || 0,
      period: clean(body.period),
      months: clean(body.months),
      taxYear: clean(body.taxYear),
      loketName: clean(body.loketName),
      loketCode: clean(body.loketCode),
      parentId: clean(body.parentId),
    });
    if (result.error || !("sale" in result) || !result.sale) return { status: result.status, body: { error: result.error, mode, statusText: result.paymentStatus } };
    return { status: 200, body: { sale: result.sale, balance: result.balance, mode, statusText: result.paymentStatus } };
  }
  return null;
}
