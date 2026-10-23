/**
 * Token usage section: estimated API-rate cost and token volume per provider
 * over the last 7/30/90 days, from `observability/usage/history`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usageHistoryApi } from '@/services/api';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuthStore } from '@/stores';
import type { ApiError } from '@/types';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import { providerLabel } from '@/features/dashboard/utils';
import { USAGE_METRICS, USAGE_RANGES, type UsageMetric, type UsageRange } from '../constants';
import { readQuotaUiState, writeQuotaUiState } from '../uiState';
import {
  cacheMultiplier,
  cachedInputShare,
  localDateKey,
  parseUsageHistory,
  summarizeUsage,
  type UsageHistory,
} from './model';
import { UsageChart, type UsageChartSeries } from './UsageChart';
import styles from './TokenUsage.module.scss';

const PROVIDER_COLORS: Record<string, string> = {
  codex: '#4a8fe7',
  claude: '#d97757',
  gemini: '#9b87f5',
  xai: '#a8a29e',
};
const FALLBACK_COLORS = ['#2bb39a', '#e0a83c', '#c86fb6', '#6cb6d9'];

type LoadState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'ready'; history: UsageHistory; days: UsageRange; today: string };

/** Fetches history for `days`; refetches when `reloadToken` changes. Stale responses are dropped. */
function useUsageHistory(days: UsageRange, enabled: boolean, reloadToken: number) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    const now = new Date();
    try {
      const raw = await usageHistoryApi.getHistory(days, -now.getTimezoneOffset());
      if (requestId !== requestRef.current) return;
      setState({
        status: 'ready',
        history: parseUsageHistory(raw),
        days,
        today: localDateKey(now),
      });
    } catch (err: unknown) {
      if (requestId !== requestRef.current) return;
      if ((err as ApiError | undefined)?.status === 404) {
        setState({ status: 'unavailable' });
        return;
      }
      setState({ status: 'error' });
    }
  }, [days]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [enabled, load, reloadToken]);

  return { state, load };
}

type TokenUsageProps = {
  /** Bumped by the page's header refresh to refetch. */
  reloadToken: number;
};

export function TokenUsage({ reloadToken }: TokenUsageProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [metric, setMetric] = useState<UsageMetric>(
    () => readQuotaUiState()?.usageMetric ?? 'cost'
  );
  const [range, setRange] = useState<UsageRange>(() => readQuotaUiState()?.usageRange ?? 30);
  const { state, load } = useUsageHistory(range, connected, reloadToken);

  const summary = useMemo(
    () =>
      state.status === 'ready' ? summarizeUsage(state.history.rows, state.days, state.today) : null,
    [state]
  );

  const formatters = useMemo(() => {
    const whole = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
    const cents = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    return {
      cost: (value: number) => (value >= 10 || value === 0 ? whole : cents).format(value),
      date: (key: string) => {
        const [year, month, date] = key.split('-').map(Number);
        return day.format(new Date(year, month - 1, date));
      },
    };
  }, [locale]);

  const formatMetric = useCallback(
    (value: number) => (metric === 'cost' ? formatters.cost(value) : formatCompactNumber(value)),
    [metric, formatters]
  );

  const chartSeries = useMemo<UsageChartSeries[]>(() => {
    if (!summary) return [];
    let fallback = 0;
    return summary.series.map((item) => ({
      id: item.provider,
      label: providerLabel(item.provider, item.provider),
      color: PROVIDER_COLORS[item.provider] ?? FALLBACK_COLORS[fallback++ % FALLBACK_COLORS.length],
      values: metric === 'cost' ? item.dailyCost : item.dailyTokens,
    }));
  }, [summary, metric]);

  if (!connected) return null;

  const handleMetric = (next: UsageMetric) => {
    setMetric(next);
    writeQuotaUiState({ usageMetric: next });
  };
  const handleRange = (next: UsageRange) => {
    setRange(next);
    writeQuotaUiState({ usageRange: next });
  };

  const hasData = Boolean(summary && summary.totals.processed > 0);
  const metricLabel = t(`quota_management.usage_metric_${metric}`);

  let body: ReactNode;
  if (state.status === 'loading') {
    body = <Skeleton height={236} rounded={12} />;
  } else if (state.status === 'unavailable') {
    body = <p className={styles.empty}>{t('quota_management.usage_unavailable')}</p>;
  } else if (state.status === 'error') {
    body = (
      <p className={styles.empty} role="alert">
        {t('quota_management.usage_error')}
        <button type="button" className={styles.retry} onClick={() => void load()}>
          {t('common.refresh')}
        </button>
      </p>
    );
  } else if (!summary || !hasData) {
    body = (
      <p className={styles.empty}>
        {state.history.startedAt === null
          ? t('quota_management.usage_empty')
          : t('quota_management.usage_empty_range')}
      </p>
    );
  } else {
    const { totals } = summary;
    const grandTotal = metric === 'cost' ? totals.cost : totals.processed;
    const multiplier = cacheMultiplier(totals);
    const stats = [
      { key: 'processed', value: formatCompactNumber(totals.processed) },
      {
        key: 'cached',
        value: `${formatCompactNumber(totals.cachedInput)} · ${formatPercent(cachedInputShare(totals) * 100, 0)}`,
      },
      { key: 'uncached', value: formatCompactNumber(totals.uncachedInput) },
      { key: 'output', value: formatCompactNumber(totals.output) },
      {
        key: 'savings',
        value:
          multiplier === null
            ? formatters.cost(totals.cacheSavings)
            : `${formatters.cost(totals.cacheSavings)} · ${multiplier.toFixed(1)}x`,
      },
    ];

    body = (
      <div className={styles.card}>
        <div className={styles.overview}>
          <div className={styles.totals}>
            <strong className={styles.total}>
              {metric === 'cost'
                ? `${formatters.cost(grandTotal)}*`
                : formatCompactNumber(grandTotal)}
            </strong>
            <span className={styles.footnote}>
              {metric === 'cost'
                ? t('quota_management.usage_cost_footnote')
                : t('quota_management.usage_stat_processed')}
            </span>
            {metric === 'cost' && summary.unpricedModels.length > 0 && (
              <span className={styles.footnote} title={summary.unpricedModels.join(', ')}>
                {t('quota_management.usage_unpriced', { count: summary.unpricedModels.length })}
              </span>
            )}
            <ul className={styles.providers}>
              {summary.series.map((item, index) => {
                const value = metric === 'cost' ? item.cost : item.tokens;
                return (
                  <li key={item.provider} className={styles.provider}>
                    <span
                      className={styles.dot}
                      style={{ background: chartSeries[index]?.color }}
                      aria-hidden="true"
                    />
                    <span className={styles.providerName}>{chartSeries[index]?.label}</span>
                    <span className={styles.providerValue}>{formatMetric(value)}</span>
                    <span className={styles.providerShare}>
                      {grandTotal > 0 ? formatPercent((value / grandTotal) * 100, 0) : '-'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <UsageChart
            dates={summary.dates}
            series={chartSeries}
            formatValue={formatMetric}
            formatDate={formatters.date}
            ariaLabel={t('quota_management.usage_chart_label', { metric: metricLabel })}
          />
        </div>
        <dl className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.key} className={styles.stat}>
              <dt>{t(`quota_management.usage_stat_${stat.key}`)}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  const rangeDates = summary?.dates;

  return (
    <section className={styles.usage} aria-labelledby="token-usage-title">
      <header className={styles.head}>
        <div>
          <h2 id="token-usage-title" className={styles.title}>
            {t('quota_management.usage_title')}
          </h2>
          {rangeDates && rangeDates.length > 0 && (
            <p className={styles.range}>
              {formatters.date(rangeDates[0])} –{' '}
              {formatters.date(rangeDates[rangeDates.length - 1])}
            </p>
          )}
        </div>
        {state.status !== 'unavailable' && (
          <div className={styles.controls}>
            <div
              className={styles.modes}
              role="group"
              aria-label={t('quota_management.usage_metric_label')}
            >
              {USAGE_METRICS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={metric === value}
                  onClick={() => handleMetric(value)}
                >
                  {t(`quota_management.usage_metric_${value}`)}
                </button>
              ))}
            </div>
            <div
              className={styles.modes}
              role="group"
              aria-label={t('quota_management.usage_range_label')}
            >
              {USAGE_RANGES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={range === value}
                  onClick={() => handleRange(value)}
                >
                  {t('quota_management.usage_range_days', { count: value })}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>
      {body}
    </section>
  );
}
