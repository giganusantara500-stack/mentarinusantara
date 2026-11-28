import type { LineSeries } from "@/components/dashboard/LineChart";

const COLORS = ["#f59e0b", "#7c3aed", "#0284c7"];

export function isCountedSale(status?: string | null) {
  return status === "success";
}

export function buildThreeMonthSheets(points: { at: string; ok?: boolean }[]) {
  const now = new Date();
  const months = [2, 1, 0].map((offset) => new Date(now.getFullYear(), now.getMonth() - offset, 1));
  const labels = Array.from({ length: 31 }, (_, index) => String(index + 1));
  const series: LineSeries[] = months.map((month, index) => {
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const isCurrent = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
    const values = labels.map((_, dayIndex) => {
      const day = dayIndex + 1;
      if (day > daysInMonth || (isCurrent && day > now.getDate())) return null;
      return points.filter((point) => {
        if (point.ok === false) return false;
        const date = new Date(point.at);
        return !Number.isNaN(date.getTime())
          && date.getFullYear() === month.getFullYear()
          && date.getMonth() === month.getMonth()
          && date.getDate() === day;
      }).length;
    });
    return {
      name: month.toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
      color: COLORS[index] ?? COLORS[2],
      values,
    };
  });
  return { labels, series };
}

function jakartaParts(date: Date) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).split("-").map(Number);
  return { year, month, day };
}

function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function buildThreeMonthSums(points: { at: string; amount: number }[]) {
  const today = jakartaParts(new Date());
  const months = [2, 1, 0].map((offset) => shiftMonth(today.year, today.month, -offset));
  const labels = Array.from({ length: 31 }, (_, index) => String(index + 1));
  const series: LineSeries[] = months.map((month, index) => {
    const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
    const isCurrent = month.year === today.year && month.month === today.month;
    const values = labels.map((_, dayIndex) => {
      const day = dayIndex + 1;
      if (day > daysInMonth || (isCurrent && day > today.day)) return null;
      const key = `${month.year}-${String(month.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return points.filter((point) => point.at.slice(0, 10) === key).reduce((sum, point) => sum + point.amount, 0);
    });
    return {
      name: new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }),
      color: COLORS[index] ?? COLORS[2],
      values,
    };
  });
  return { labels, series };
}
