import { useEffect, useMemo, useRef, useState } from "react";

export interface LineSeries {
  name: string;
  color: string;
  values: Array<number | null>;
}

interface Props {
  labels: string[];
  series: LineSeries[];
  formatValue: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  emptyText?: string;
  emptyMax?: number;
  integerScale?: boolean;
}

function niceMax(peak: number, emptyMax: number) {
  if (peak <= 0) return emptyMax;
  const padded = peak * 1.12;
  const exp = Math.floor(Math.log10(padded));
  const base = 10 ** exp;
  const frac = padded / base;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const nice = steps.find((item) => item + 1e-9 >= frac) ?? 10;
  return nice * base;
}

function countMax(peak: number) {
  if (peak <= 0) return 1;
  const headroom = Math.max(peak, Math.ceil(peak * 1.2));
  const magnitude = 10 ** Math.floor(Math.log10(headroom));
  const steps = [1, 2, 3, 4, 5, 6, 8, 10];
  const scaled = headroom / magnitude;
  const step = steps.find((item) => item + 1e-9 >= scaled) ?? 10;
  return step * magnitude;
}

export function LineChart({ labels, series, formatValue, axisFormat, height = 288, emptyText = "Belum ada data.", emptyMax = 10, integerScale = false }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const chartHeight = Math.max(140, height);

  const allValues = series.flatMap((s) => s.values).filter((value): value is number => value != null);
  const peak = allValues.length ? Math.max(...allValues, 0) : 0;
  const max = integerScale ? countMax(peak) : niceMax(peak, emptyMax);
  const min = 0;
  const range = max - min || 1;
  const axisText = axisFormat ?? ((value: number) => new Intl.NumberFormat("id-ID").format(Math.round(value)));

  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const update = () => setWidth(Math.max(720, Math.round(node.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [labels.length]);
  const padding = { top: 28, right: 28, bottom: 58, left: Math.min(128, Math.max(92, axisText(max).length * 8 + 36)) };
  const chartW = width - padding.left - padding.right;
  const plotH = chartHeight - padding.top - padding.bottom;

  const xStep = labels.length > 1 ? chartW / (labels.length - 1) : chartW;

  const points = useMemo(() => {
    return series.map((s) => ({
      ...s,
      coords: s.values.map((v, i) => {
        if (v == null) return null;
        const x = padding.left + i * xStep;
        const y = padding.top + plotH - ((v - min) / range) * plotH;
        return { x, y, value: v };
      }),
    }));
  }, [series, xStep, plotH, range, min, padding.left, padding.top]);

  const yTicks = useMemo(() => {
    const splits = integerScale
      ? [max <= 6 ? 1 : Math.max(1, Math.round(max / 4))]
      : [5, 4, 2].map((count) => max / count).filter((step) => {
          const exp = Math.floor(Math.log10(step || 1));
          const base = 10 ** Math.max(exp, 0);
          const frac = step / base;
          return Math.abs(frac - Math.round(frac * 2) / 2) < 0.001;
        });
    const step = splits[0] || max / 4;
    const count = Math.max(1, Math.round(max / step));
    return Array.from({ length: count + 1 }, (_, i) => {
      const value = integerScale ? Math.round(step * i) : Math.round(step * i * 1000) / 1000;
      const y = padding.top + plotH - ((value - min) / range) * plotH;
      return { value, y };
    });
  }, [max, min, range, plotH, padding.top, integerScale]);

  if (labels.length === 0) {
    return (
      <div className="flex h-72 max-h-80 w-full items-center justify-center overflow-hidden text-sm text-slate-400">
        {emptyText}
      </div>
    );
  }

  type ChartPoint = { x: number; y: number; value?: number } | null;

  const linePath = (coords: ChartPoint[]) => {
    let path = "";
    let drawing = false;
    coords.forEach((point) => {
      if (!point) {
        drawing = false;
        return;
      }
      path += `${drawing ? "L" : "M"} ${point.x} ${point.y} `;
      drawing = true;
    });
    return path;
  };

  const areaPath = (coords: ChartPoint[]) => {
    let path = "";
    let run: { x: number; y: number }[] = [];
    const flush = () => {
      if (run.length < 2) {
        run = [];
        return;
      }
      const first = run[0];
      const last = run[run.length - 1];
      path += `${linePath(run)} L ${last.x} ${padding.top + plotH} L ${first.x} ${padding.top + plotH} Z `;
      run = [];
    };
    coords.forEach((point) => {
      if (!point) flush();
      else run.push(point);
    });
    flush();
    return path;
  };

  return (
    <div ref={hostRef} className="relative w-full overflow-visible" style={{ height: chartHeight }} onMouseLeave={() => setHoverIdx(null)}>
      <svg
        viewBox={`0 0 ${width} ${chartHeight}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Jumlah Transaksi (Lembar) per Tanggal (Hari ke-)"
      >
        <defs>
          {points.map((s, i) => (
            <linearGradient key={i} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* Y grid lines + labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={t.y}
              x2={width - padding.right}
              y2={t.y}
              stroke={t.value === 0 ? "#0a0a0a" : "#e2e8f0"}
              strokeWidth={t.value === 0 ? 2 : 1}
              strokeDasharray={t.value === 0 ? "0" : "4 4"}
            />
            <text
              x={padding.left - 10}
              y={t.y + 4}
              textAnchor="end"
              fontSize="12"
              fontWeight="500"
              fill="#334155"
              className="text-xs font-medium text-slate-700"
            >
              {axisText(t.value)}
            </text>
          </g>
        ))}

        {/* Area + lines */}
        {points.map((s, i) => (
          <g key={i}>
            <path d={areaPath(s.coords)} fill={`url(#grad-${i})`} />
            <path
              d={linePath(s.coords)}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {s.coords.map((point, index) => point && (
              <circle key={index} cx={point.x} cy={point.y} r="3.5" fill={s.color} stroke="#ffffff" strokeWidth="1.5" />
            ))}
          </g>
        ))}

        {/* X labels */}
        {labels.map((label, i) => {
          const x = padding.left + i * xStep;
          const showLabel = labels.length <= 31 || i % Math.ceil(labels.length / 15) === 0;
          return (
            <text
              key={i}
              x={x}
              y={chartHeight - 28}
              textAnchor="middle"
              fontSize="12"
              fontWeight="500"
              fill="#334155"
              className="text-xs font-medium text-slate-700"
            >
              {showLabel ? label : ""}
            </text>
          );
        })}

        <text
          x={18}
          y={padding.top + plotH / 2}
          textAnchor="middle"
          fontSize="12"
          fontWeight="500"
          fill="#334155"
          className="text-xs font-medium text-slate-700"
          transform={`rotate(-90 18 ${padding.top + plotH / 2})`}
        >
          Jumlah Transaksi (Lembar)
        </text>
        <text
          x={padding.left + chartW / 2}
          y={chartHeight - 8}
          textAnchor="middle"
          fontSize="12"
          fontWeight="500"
          fill="#334155"
          className="text-xs font-medium text-slate-700"
        >
          Tanggal (Hari ke-)
        </text>

        {/* Hover hit areas */}
        {labels.map((_, i) => {
          const x = padding.left + i * xStep;
          return (
            <rect
              key={i}
              x={x - xStep / 2}
              y={0}
              width={xStep}
              height={chartHeight}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}

        {/* Hover line + dots */}
        {hoverIdx !== null && (
          <g>
            <line
              x1={padding.left + hoverIdx * xStep}
              y1={padding.top}
              x2={padding.left + hoverIdx * xStep}
              y2={padding.top + plotH}
              stroke="#cbd5e1"
              strokeWidth="1"
            />
            {points.map((s, i) => {
              const c = s.coords[hoverIdx];
              if (!c) return null;
              return (
                <circle
                  key={i}
                  cx={c.x}
                  cy={c.y}
                  r="5"
                  fill="white"
                  stroke={s.color}
                  strokeWidth="2.5"
                />
              );
            })}
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hoverIdx !== null && (
        <div
          className="absolute pointer-events-none z-10 max-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-xl"
          style={{
            left: `${Math.min(82, Math.max(18, ((padding.left + hoverIdx * xStep) / width) * 100))}%`,
            top: 8,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-xs font-semibold text-slate-800 mb-1.5 whitespace-nowrap">
            {labels[hoverIdx]}
          </div>
          <div className="space-y-1">
            {points.map((s, i) => (
              <div key={i} className="flex items-center gap-2 whitespace-nowrap">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-xs text-slate-600">{s.name}</span>
                <span className="text-xs font-semibold text-slate-800">{s.values[hoverIdx] == null ? "—" : formatValue(s.values[hoverIdx] as number)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
