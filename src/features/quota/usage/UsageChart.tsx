import { useId, useMemo, useState, type PointerEvent } from 'react';
import { buildSmoothLinePath } from '@/features/dashboard/components/curve';
import { niceCeil } from '@/features/dashboard/utils';
import styles from './TokenUsage.module.scss';

export type UsageChartSeries = {
  id: string;
  label: string;
  color: string;
  values: number[];
};

type UsageChartProps = {
  dates: string[];
  series: UsageChartSeries[];
  formatValue: (value: number) => string;
  formatDate: (date: string) => string;
  ariaLabel: string;
};

/** Horizontal gridline intervals (TICK_INTERVALS + 1 labels, including zero). */
const TICK_INTERVALS = 3;
/** SVG user space; stretched to the container with preserveAspectRatio="none". */
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 200;

const xFor = (index: number, count: number) =>
  count <= 1 ? VIEW_WIDTH / 2 : (index / (count - 1)) * VIEW_WIDTH;

const xPercent = (index: number, count: number) => (xFor(index, count) / VIEW_WIDTH) * 100;

export function UsageChart({ dates, series, formatValue, formatDate, ariaLabel }: UsageChartProps) {
  const gradientId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const count = dates.length;

  const scaleMax = useMemo(() => {
    const peak = Math.max(0, ...series.flatMap((item) => item.values));
    return peak > 0 ? niceCeil(peak / TICK_INTERVALS) * TICK_INTERVALS : 1;
  }, [series]);

  const ticks = useMemo(
    () =>
      Array.from({ length: TICK_INTERVALS + 1 }, (_, index) => {
        const ratio = 1 - index / TICK_INTERVALS;
        return { ratio, value: scaleMax * ratio };
      }),
    [scaleMax]
  );

  const paths = useMemo(
    () =>
      series.map((item) => {
        const points = item.values.map((value, index) => ({
          x: xFor(index, count),
          y: VIEW_HEIGHT - (value / scaleMax) * VIEW_HEIGHT,
        }));
        const line = buildSmoothLinePath(points, 0, VIEW_HEIGHT);
        const first = points[0];
        const last = points[points.length - 1];
        const area =
          first && last
            ? `${line} L${last.x.toFixed(2)} ${VIEW_HEIGHT} L${first.x.toFixed(2)} ${VIEW_HEIGHT} Z`
            : '';
        return { ...item, line, area };
      }),
    [series, count, scaleMax]
  );

  const xTicks = useMemo(() => {
    if (count === 0) return [];
    const positions = [0, Math.floor((count - 1) / 2), count - 1];
    return Array.from(new Set(positions)).map((index) => ({
      index,
      label: formatDate(dates[index]),
    }));
  }, [count, dates, formatDate]);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const index = Math.round(Math.max(0, Math.min(1, fraction)) * (count - 1));
    setActiveIndex(index);
  };

  const activeLeft = activeIndex === null ? 0 : xPercent(activeIndex, count);

  return (
    <figure className={styles.chart}>
      <div className={styles.plot}>
        <div className={styles.yAxis} aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.ratio}
              className={styles.yTick}
              style={{ top: `${(1 - tick.ratio) * 100}%` }}
            >
              {formatValue(tick.value)}
            </span>
          ))}
        </div>

        <div
          className={styles.canvas}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setActiveIndex(null)}
        >
          {ticks.map((tick) => (
            <span
              key={tick.ratio}
              className={styles.gridline}
              style={{ top: `${(1 - tick.ratio) * 100}%` }}
              aria-hidden="true"
            />
          ))}

          <svg
            className={styles.svg}
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              {paths.map((item, index) => (
                <linearGradient
                  key={item.id}
                  id={`${gradientId}-${index}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={item.color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={item.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {paths.map((item, index) => (
              <g key={item.id}>
                <path d={item.area} fill={`url(#${gradientId}-${index})`} />
                <path
                  d={item.line}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>

          {activeIndex !== null && (
            <>
              <span
                className={styles.guide}
                style={{ left: `${activeLeft}%` }}
                aria-hidden="true"
              />
              {series.map((item) => (
                <span
                  key={item.id}
                  className={styles.marker}
                  style={{
                    left: `${activeLeft}%`,
                    top: `${100 - (item.values[activeIndex] / scaleMax) * 100}%`,
                    background: item.color,
                  }}
                  aria-hidden="true"
                />
              ))}
              <div
                className={styles.tooltip}
                style={{
                  left: `${activeLeft}%`,
                  transform:
                    activeLeft < 15
                      ? 'translateX(8px)'
                      : activeLeft > 85
                        ? 'translateX(calc(-100% - 8px))'
                        : 'translateX(-50%)',
                }}
                role="status"
              >
                <span className={styles.tooltipDate}>{formatDate(dates[activeIndex])}</span>
                {series.map((item) => (
                  <span key={item.id} className={styles.tooltipRow}>
                    <span
                      className={styles.dot}
                      style={{ background: item.color }}
                      aria-hidden="true"
                    />
                    {item.label}
                    <b>{formatValue(item.values[activeIndex])}</b>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.xAxis} aria-hidden="true">
        {xTicks.map((tick) => (
          <span
            key={tick.index}
            className={styles.xTick}
            data-edge={tick.index === 0 ? 'start' : tick.index === count - 1 ? 'end' : undefined}
            style={{ left: `${xPercent(tick.index, count)}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
