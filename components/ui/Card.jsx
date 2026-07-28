/**
 * Card — neumorphic content card.
 * A thin wrapper around Surface with sane default padding.
 *
 * padding: "none" | "sm" | "md" | "lg"
 */

import Surface from './Surface';

const PADDING = {
  none: '0',
  sm: 'var(--space-4)',
  md: 'var(--space-6)',
  lg: 'var(--space-8)',
};

export default function Card({
  variant = 'raised',
  padding = 'md',
  className = '',
  style,
  children,
  ...rest
}) {
  return (
    <Surface
      variant={variant}
      padding={PADDING[padding] ?? PADDING.md}
      className={className}
      style={style}
      {...rest}
    >
      {children}
    </Surface>
  );
}
