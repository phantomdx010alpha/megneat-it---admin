/**
 * Button — neumorphic interactive button primitive.
 *
 * variant:
 *   "primary" — accent fill, most prominent action
 *   "raised"  — neumorphic raised surface, secondary action
 *   "inset"   — neumorphic inset (pressed-in feel), tertiary action
 *   "ghost"   — no shadow, text-only, least prominent
 *   "danger"  — accent fill in danger red
 *
 * size: "sm" | "md" | "lg"
 *
 * No hardcoded colors anywhere — every value from tokens.
 */

import { useState } from 'react';

const SIZE = {
  sm: {
    padding: 'var(--space-2) var(--space-4)',
    fontSize: 'var(--font-size-sm)',
    minHeight: '36px',
    borderRadius: 'var(--radius-sm)',
  },
  md: {
    padding: 'var(--space-3) var(--space-6)',
    fontSize: 'var(--font-size-base)',
    minHeight: '44px',
    borderRadius: 'var(--radius)',
  },
  lg: {
    padding: 'var(--space-4) var(--space-8)',
    fontSize: 'var(--font-size-md)',
    minHeight: '52px',
    borderRadius: 'var(--radius-md)',
  },
};

function getVariantStyle(variant, pressed) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'var(--font-family)',
    fontWeight: 'var(--font-weight-semibold)',
    letterSpacing: 'var(--letter-spacing-wide)',
    transition: `box-shadow var(--transition-base), background var(--transition-base), transform var(--transition-fast)`,
    userSelect: 'none',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    transform: pressed ? 'scale(0.97)' : 'scale(1)',
  };

  switch (variant) {
    case 'primary':
      return {
        ...base,
        background: pressed ? 'var(--accent-active)' : 'var(--accent)',
        color: 'var(--accent-contrast)',
        boxShadow: pressed
          ? 'var(--shadow-inset)'
          : `var(--shadow-raised), 0 0 0 0 var(--accent-muted)`,
      };

    case 'danger':
      return {
        ...base,
        background: 'var(--color-danger)',
        color: 'var(--text-on-accent)',
        boxShadow: pressed ? 'var(--shadow-inset)' : 'var(--shadow-raised)',
      };

    case 'raised':
      return {
        ...base,
        background: 'var(--surface)',
        color: 'var(--text-primary)',
        boxShadow: pressed ? 'var(--shadow-inset)' : 'var(--shadow-raised)',
      };

    case 'inset':
      return {
        ...base,
        background: 'var(--surface-inset)',
        color: 'var(--text-secondary)',
        boxShadow: 'var(--shadow-inset)',
      };

    case 'ghost':
      return {
        ...base,
        background: 'transparent',
        color: 'var(--accent)',
        boxShadow: 'none',
      };

    default:
      return {
        ...base,
        background: 'var(--surface)',
        color: 'var(--text-primary)',
        boxShadow: pressed ? 'var(--shadow-inset)' : 'var(--shadow-raised)',
      };
  }
}

export default function Button({
  variant = 'raised',
  size = 'md',
  disabled = false,
  fullWidth = false,
  style,
  className = '',
  children,
  onClick,
  type = 'button',
  ...rest
}) {
  const [pressed, setPressed] = useState(false);

  const variantStyle = getVariantStyle(variant, pressed && !disabled);
  const sizeStyle = SIZE[size] ?? SIZE.md;

  const merged = {
    ...variantStyle,
    ...sizeStyle,
    ...(fullWidth ? { width: '100%' } : {}),
    ...(disabled
      ? {
          opacity: 0.45,
          cursor: 'not-allowed',
          pointerEvents: 'none',
          boxShadow: 'none',
        }
      : {}),
    ...style,
  };

  return (
    <button
      type={type}
      className={className}
      style={merged}
      disabled={disabled}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
