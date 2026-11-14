export interface SetoranMovement {
  amount: number;
  at: string;
  status?: string;
}

export interface SetoranDay {
  day: number;
  lbr: number;
  rupiah: number;
  tLbr: number;
  tRupiah: number;
  remark: string;
  setor: number;
  tSetor: number;
  selisih: number;
}

function onDay(value: string, year: number, month: number, day: number) {
  const date = new Date(value);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

export function setoranDays(year: number, month: number, sales: SetoranMovement[], tickets: SetoranMovement[]): SetoranDay[] {
  const days = new Date(year, month, 0).getDate();
  const rows: SetoranDay[] = [];
  let tLbr = 0;
  let tRupiah = 0;
  let tSetor = 0;
  for (let day = 1; day <= days; day += 1) {
    const daySales = sales.filter((sale) => onDay(sale.at, year, month, day));
    const dayTickets = tickets.filter((ticket) => onDay(ticket.at, year, month, day));
    const approved = dayTickets.filter((ticket) => ticket.status === "approved");
    const lbr = daySales.length;
    const rupiah = daySales.reduce((sum, sale) => sum + Number(sale.amount), 0);
    const setor = approved.reduce((sum, ticket) => sum + Number(ticket.amount), 0);
    tLbr += lbr;
    tRupiah += rupiah;
    tSetor += setor;
    const remark = dayTickets.some((ticket) => ticket.status === "pending") ? "Tiket menunggu" : "";
    rows.push({ day, lbr, rupiah, tLbr, tRupiah, remark, setor, tSetor, selisih: tSetor - tRupiah });
  }
  return rows;
}

export function setoranLines(identity: string, period: string, rows: SetoranDay[], money: (value: number) => string) {
  const lines = [
    "MENTARI NUSANTARA",
    "PANTAUAN SETORAN",
    identity,
    `Bulan ${period}`,
    "",
    "TGL  LBR  RUPIAH          T.LBR  T.RUPIAH        REMARK            SETOR           T.SETOR         SELISIH",
  ];
  rows.forEach((row) => {
    lines.push(
      `${String(row.day).padEnd(5)}${String(row.lbr).padEnd(5)}${money(row.rupiah).padEnd(16)}${String(row.tLbr).padEnd(7)}${money(row.tRupiah).padEnd(16)}${row.remark.padEnd(18)}${money(row.setor).padEnd(16)}${money(row.tSetor).padEnd(16)}${money(row.selisih)}`,
    );
  });
  const last = rows[rows.length - 1];
  lines.push("");
  lines.push(`TOTAL LEMBAR ${last?.tLbr ?? 0}    TOTAL RUPIAH ${money(last?.tRupiah ?? 0)}    TOTAL SETOR ${money(last?.tSetor ?? 0)}    SELISIH ${money(last?.selisih ?? 0)}`);
  lines.push("");
  lines.push("Dibuat Oleh                 Diperiksa Oleh");
  lines.push("");
  lines.push("(                    )      (                    )");
  return lines;
}
