import type { LineSeries } from "@/components/dashboard/LineChart";

const COLORS = ["#f59e0b", "#7c3aed", "#0284c7"];

export function buildThreeMonthSheets(points: { at: string; ok?: boolean }[]) {
  const now = new Date();
  const labels = Array.from({ length: 31 }, (_, index) => String(index + 1));
  const series: LineSeries[] = [-2, -1, 0].map((offset, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const values = labels.map((_, dayIndex) => {
      const day = dayIndex + 1;
      if (day > daysInMonth) return null;
      if (offset === 0 && day > now.getDate()) return null;
      return points.filter((point) => {
        if (point.ok === false) return false;
        const date = new Date(point.at);
        return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth() && date.getDate() === day;
      }).length;
    });
    return {
      name: month.toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
      color: COLORS[index],
      values,
    };
  });
  return { labels, series };
}
