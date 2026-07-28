/**
 * Input — neumorphic inset text/number input.
 *
 * The inset shadow makes it feel pressed into the surface — standard neumorphic
 * pattern for editable fields, distinguishing them from raised (read-only) surfaces.
 *
 * No hardcoded colors. All values from tokens.
 */

import { useState } from 'react';

export default function Input({
  label,
  id,
  type = 'text',
  placeholder,
  value,
  onChange,
  disabled = false,
  error,
  hint,
  prefix,
  suffix,
  style,
  className = '',
  inputStyle,
  ...rest
}) {
  const [focused, setFocused] = useState(false);

  const wrapperStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    ...style,
  };

  const labelStyle = {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    color: error ? 'var(--color-danger)' : 'var(--text-secondary)',
    letterSpacing: 'var(--letter-spacing-wider)',
    textTransform: 'uppercase',
  };

  const inputRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    background: 'var(--surface-inset)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: focused
      ? `var(--shadow-inset), 0 0 0 2px var(--accent)`
      : error
      ? `var(--shadow-inset), 0 0 0 2px var(--color-danger)`
      : 'var(--shadow-inset)',
    padding: '0 var(--space-4)',
    minHeight: '44px',
    transition: `box-shadow var(--transition-base)`,
    opacity: disabled ? 0.5 : 1,
  };

  const fieldStyle = {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 'var(--font-size-base)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-family)',
    padding: 'var(--space-3) 0',
    cursor: disabled ? 'not-allowed' : 'text',
    ...inputStyle,
  };

  const hintStyle = {
    fontSize: 'var(--font-size-xs)',
    color: error ? 'var(--color-danger)' : 'var(--text-muted)',
    lineHeight: 'var(--line-height-base)',
  };

  return (
    <div style={wrapperStyle} className={className}>
      {label && (
        <label htmlFor={id} style={labelStyle}>
          {label}
        </label>
      )}
      <div style={inputRowStyle}>
        {prefix && (
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', flexShrink: 0 }}>
            {prefix}
          </span>
        )}
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          style={fieldStyle}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
        {suffix && (
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', flexShrink: 0 }}>
            {suffix}
          </span>
        )}
      </div>
      {(error || hint) && (
        <span style={hintStyle}>{error || hint}</span>
      )}
    </div>
  );
}
