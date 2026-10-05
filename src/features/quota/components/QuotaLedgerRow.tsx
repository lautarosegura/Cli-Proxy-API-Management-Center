/**
 * Ledger row: credential identity, the provider body laid out as meter lanes,
 * and the refresh action. Same states and actions contract as QuotaCard; the
 * Claude reset-grant flow stays in the Cards view.
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { resolveCodexPlanLabel } from '../providers/codex/planLabel';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { resolveLedgerPlanLabel } from '../ledgerModel';
import bodyStyles from './QuotaLedgerBody.module.scss';
import styles from './QuotaLedgerRow.module.scss';

const ledgerClasses = bindQuotaClasses(bodyStyles, 'QuotaLedgerBody.module.scss');

export type QuotaLedgerRowProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
};

export function QuotaLedgerRow(props: QuotaLedgerRowProps) {
  const { entry, quota, canRefresh, resetting, onRefresh, onReset } = props;
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const displayName = getQuotaDisplayName(entry.file);
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const planLabel = resolveLedgerPlanLabel(entry.type, quota, t, (planType) =>
    resolveCodexPlanLabel(t, planType)
  );
  const showReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));

  return (
    <article className={styles.row} aria-busy={loading || undefined}>
      <div className={styles.identity}>
        <span className={styles.fileName} title={displayName}>
          {displayName}
        </span>
        {planLabel && <span className={styles.plan}>{planLabel}</span>}
      </div>

      <div
        className={styles.meters}
        style={
          {
            '--ledger-no-reset': JSON.stringify(t('quota_management.no_reset_pending')),
          } as CSSProperties
        }
      >
        {status === 'idle' ? (
          <button type="button" className={styles.idle} onClick={onRefresh} disabled={!canRefresh}>
            {t(`${adapter.i18nPrefix}.idle`)}
          </button>
        ) : loading ? (
          <>
            <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1, 2].map((lane) => (
              <span key={lane} className={styles.skeletonLane} aria-hidden="true">
                <span className={styles.skeletonLabel} />
                <span className={styles.skeletonTrack} />
              </span>
            ))}
          </>
        ) : status === 'error' ? (
          <span className={styles.error} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, {
              message: resolveQuotaErrorMessage(
                t,
                quota?.errorStatus,
                quota?.error || t('common.unknown_error')
              ),
            })}
          </span>
        ) : quota ? (
          <adapter.Body quota={quota} classes={ledgerClasses} />
        ) : null}
      </div>

      <div className={styles.actions}>
        {showReset && (
          <button
            type="button"
            className={styles.action}
            onClick={onReset}
            disabled={!canRefresh || loading || resetting}
            title={t('codex_quota.reset_button')}
          >
            <IconRefreshCw size={13} className={resetting ? styles.spinning : undefined} />
            {t('codex_quota.reset_button')}
          </button>
        )}
        <button
          type="button"
          className={styles.action}
          onClick={onRefresh}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting)}
          title={t('auth_files.quota_refresh_hint')}
        >
          <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
          {t('auth_files.quota_refresh_single')}
        </button>
      </div>
    </article>
  );
}
