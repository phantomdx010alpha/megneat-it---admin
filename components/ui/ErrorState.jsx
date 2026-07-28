/**
 * ErrorState — displayed when a data fetch or operation fails.
 *
 * No emoji. Phosphor WarningCircle icon (duotone weight for illustrative moments).
 * No hardcoded colors — all from tokens.
 */

import { WarningCircle } from '@phosphor-icons/react';
import Button from './Button';

export default function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
  className = '',
  style,
}) {
  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-4)',
    padding: 'var(--space-12) var(--space-6)',
    textAlign: 'center',
    ...style,
  };

  const titleStyle = {
    fontSize: 'var(--font-size-md)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-danger)',
    margin: 0,
  };

  const messageStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--text-muted)',
    lineHeight: 'var(--line-height-loose)',
    margin: 0,
    maxWidth: '280px',
  };

  return (
    <div className={className} style={containerStyle} role="alert">
      <WarningCircle size={64} color="var(--color-danger)" weight="duotone" aria-hidden="true" />
      <p style={titleStyle}>{title}</p>
      {message && <p style={messageStyle}>{message}</p>}
      {onRetry && (
        <Button variant="raised" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
