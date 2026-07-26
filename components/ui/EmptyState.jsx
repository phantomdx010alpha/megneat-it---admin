/**
 * EmptyState — displayed when a list or report returns zero rows.
 *
 * No emoji. Phosphor MagnifyingGlass icon (duotone weight for illustrative moments).
 * No hardcoded colors — all from tokens.
 */

import { MagnifyingGlass } from '@phosphor-icons/react';
import Button from './Button';

export default function EmptyState({
  title = 'Nothing here yet',
  message,
  action,
  onAction,
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
    color: 'var(--text-secondary)',
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
    <div className={className} style={containerStyle} role="status" aria-label={title}>
      <MagnifyingGlass size={64} color="var(--text-muted)" weight="duotone" aria-hidden="true" />
      <p style={titleStyle}>{title}</p>
      {message && <p style={messageStyle}>{message}</p>}
      {action && onAction && (
        <Button variant="raised" size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}
