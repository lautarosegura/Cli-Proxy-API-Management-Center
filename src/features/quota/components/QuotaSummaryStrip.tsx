/**
 * Summary strip: one column per provider with the binding limit summed across
 * its credentials, one bar segment per credential, and the soonest reset.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import type { LedgerProviderSummary, LedgerSummaryLimit } from '../ledgerModel';
import styles from './QuotaSummaryStrip.module.scss';

export type QuotaSummaryStripProps = {
  summaries: LedgerProviderSummary[];
  resolvedTheme: ResolvedTheme;
  now: number;
};

const formatTotal = (value: number) => `${Math.round(value)}%`;

const segmentToneClass = (remaining: number) =>
  remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD
    ? styles.fillHigh
    : remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
      ? styles.fillMedium
      : styles.fillLow;

function ResetLine({ limit, now }: { limit: LedgerSummaryLimit | null; now: number }) {
  const { i18n } = useTranslation();
  const display = limit
    ? buildResetDisplay(null, limit.soonestResetMs, now, i18n.resolvedLanguage)
    : null;
  if (!display) return <span className={styles.resetPlaceholder} aria-hidden="true" />;
  return (
    <span className={styles.reset}>
      {display.relative && <span className={styles.resetRelative}>{display.relative}</span>}
      <span className={styles.resetAbsolute}>{display.absolute}</span>
    </span>
  );
}

function SummaryColumn({
  summary,
  resolvedTheme,
  now,
}: {
  summary: LedgerProviderSummary;
  resolvedTheme: ResolvedTheme;
  now: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const iconSrc = getAuthFileIcon(summary.type, resolvedTheme);
  const typeLabel = getTypeLabel(t, summary.type);
  const capacity = summary.credentialCount * 100;
  const [firstOther, ...restOthers] = summary.others;

  return (
    <section className={styles.column} aria-label={typeLabel}>
      <header className={styles.head}>
        <span
          className={styles.iconWrap}
          style={
            isThemeSurfaceIconProvider(summary.type)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className={styles.name}>{typeLabel}</span>
        <span className={styles.count}>
          {t('quota_management.summary_credentials', { count: summary.credentialCount })}
        </span>
      </header>

      <span className={styles.limitLabel}>
        {summary.primary?.label ?? t('quota_management.summary_not_loaded')}
      </span>
      <div className={styles.figure}>
        <strong className={summary.primary ? styles.value : `${styles.value} ${styles.valueEmpty}`}>
          {summary.primary ? formatTotal(summary.primary.total) : '--'}
        </strong>
        <span className={styles.capacity}>
          {t('quota_management.summary_of', { total: formatTotal(capacity) })}
        </span>
      </div>

      <div className={styles.segments} aria-hidden="true">
        {summary.segments.map((remaining, index) => (
          <span key={index} className={styles.segment}>
            {remaining !== null && (
              <span
                className={`${styles.segmentFill} ${segmentToneClass(remaining)}`}
                style={{ width: `${Math.max(0, Math.min(100, remaining))}%` }}
              />
            )}
          </span>
        ))}
      </div>

      <ResetLine limit={summary.primary} now={now} />

      {firstOther && (
        <div className={styles.others}>
          <div className={styles.otherRow}>
            <span className={styles.otherLabel}>{firstOther.label}</span>
            <span className={styles.otherValue}>{formatTotal(firstOther.total)}</span>
            {restOthers.length > 0 && (
              <button
                type="button"
                className={styles.toggle}
                aria-expanded={expanded}
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? t('quota_management.summary_hide') : t('quota_management.summary_show')}
              </button>
            )}
          </div>
          {expanded &&
            restOthers.map((limit) => (
              <div key={limit.id} className={styles.otherRow}>
                <span className={styles.otherLabel}>{limit.label}</span>
                <span className={styles.otherValue}>{formatTotal(limit.total)}</span>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

export function QuotaSummaryStrip({ summaries, resolvedTheme, now }: QuotaSummaryStripProps) {
  if (summaries.length === 0) return null;
  return (
    <div className={styles.strip}>
      {summaries.map((summary) => (
        <SummaryColumn
          key={summary.type}
          summary={summary}
          resolvedTheme={resolvedTheme}
          now={now}
        />
      ))}
    </div>
  );
}
