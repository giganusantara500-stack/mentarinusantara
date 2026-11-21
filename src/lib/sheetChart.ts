import type { LineSeries } from "@/components/dashboard/LineChart";

const COLORS = ["#f59e0b", "#7c3aed", "#0284c7"];

export function isCountedSale(status?: string | null) {
  return status === "success" || status === "simulated";
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
