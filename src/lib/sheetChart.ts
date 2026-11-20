import type { LineSeries } from "@/components/dashboard/LineChart";

const COLORS = ["#f59e0b", "#7c3aed", "#0284c7"];

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthIndex(date: Date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function validMonth(iso?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return monthStart(date);
}

export function buildThreeMonthSheets(points: { at: string; ok?: boolean }[], since?: string | null) {
  const now = new Date();
  const end = monthStart(now);
  const rolling = new Date(end.getFullYear(), end.getMonth() - 2, 1);
  let origin = end;
  const pull = (iso?: string | null) => {
    const month = validMonth(iso);
    if (month && monthIndex(month) < monthIndex(origin)) origin = month;
  };
  if (since) pull(since);
  else {
    for (const point of points) {
      if (point.ok === false) continue;
      pull(point.at);
    }
  }
  const start = monthIndex(origin) > monthIndex(rolling) ? origin : rolling;
  const months: Date[] = [];
  for (let cursor = new Date(start); monthIndex(cursor) <= monthIndex(end) && months.length < 3; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    months.push(new Date(cursor));
  }
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
      color: COLORS[COLORS.length - months.length + index] ?? COLORS[index] ?? COLORS[2],
      values,
    };
  });
  return { labels, series };
}
