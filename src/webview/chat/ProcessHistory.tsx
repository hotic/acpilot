import type { ReactNode } from 'react';
import { t } from '../i18n';

// Expanded process content participates in the conversation's normal scroll flow.
export function ProcessHistory({ children }: { children: ReactNode }) {
  return (
    <div className="process-history" role="region" aria-label={t('turns.processHistory')}>
      <div className="process-content flex flex-col">{children}</div>
    </div>
  );
}
