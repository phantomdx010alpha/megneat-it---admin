/**
 * Badge — small inline status chip.
 *
 * tone: "default" | "accent" | "success" | "warning" | "danger" | "muted"
 *
 * No hardcoded colors. All from tokens.
 */

const TONE_STYLES = {
  default: {
    background: 'var(--surface)',
    color: 'var(--text-secondary)',
    boxShadow: 'var(--shadow-flat)',
  },
  accent: {
    background: 'var(--accent-muted)',
    color: 'var(--accent)',
    boxShadow: 'none',
  },
  success: {
    background: 'rgba(45, 155, 106, 0.12)',
    color: 'var(--color-success)',
    boxShadow: 'none',
  },
  warning: {
    background: 'rgba(196, 138, 0, 0.12)',
    color: 'var(--color-warning)',
    boxShadow: 'none',
  },
  danger: {
    background: 'rgba(217, 79, 79, 0.12)',
    color: 'var(--color-danger)',
    boxShadow: 'none',
  },
  muted: {
    background: 'transparent',
    color: 'var(--text-muted)',
    boxShadow: 'none',
  },
};

export default function Badge({
  tone = 'default',
  size = 'md',
  className = '',
  style,
  children,
  ...rest
}) {
  const toneStyle = TONE_STYLES[tone] ?? TONE_STYLES.default;

  const badgeStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    padding: size === 'sm'
      ? '2px var(--space-2)'
      : 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--radius-full)',
    fontSize: size === 'sm' ? 'var(--font-size-xs)' : 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    lineHeight: '1.2',
    whiteSpace: 'nowrap',
    ...toneStyle,
    ...style,
  };

  return (
    <span className={className} style={badgeStyle} {...rest}>
      {children}
    </span>
  );
}
