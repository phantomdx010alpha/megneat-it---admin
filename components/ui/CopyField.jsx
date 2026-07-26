'use client';

/**
 * CopyField — a read-only value with a one-click copy button.
 *
 * Built for Phase 6's "show the generated license key and password
 * clearly, with a one-click copy button — this needs to be effortless to
 * grab correctly" requirement. Kept as its own primitive rather than
 * inlined in app/(app)/clients/new/page.js since Phase 7's client list is
 * likely to want the same "show + copy a license key" pattern later —
 * built once here, correctly, rather than duplicated when that phase
 * lands.
 *
 * No hardcoded colors — all values from tokens, matching every other
 * primitive's own stated convention.
 */

import { useState } from 'react';
import { Copy, Check } from '@phosphor-icons/react';

export default function CopyField({ label, value, monospace = true, className = '', style }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (non-HTTPS, permissions denied).
      // The value is still visible and selectable on-screen, so this
      // isn't a dead end — just no one-click shortcut this time.
    }
  }

  const wrapperStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style };

  const labelStyle = {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--text-secondary)',
    letterSpacing: 'var(--letter-spacing-wider)',
    textTransform: 'uppercase',
  };

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    background: 'var(--surface-inset)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-inset)',
    padding: '0 var(--space-2) 0 var(--space-4)',
    minHeight: '44px',
  };

  const valueStyle = {
    flex: 1,
    fontSize: 'var(--font-size-base)',
    color: 'var(--text-primary)',
    fontFamily: monospace ? 'var(--font-family-mono, monospace)' : 'var(--font-family)',
    overflow: 'auto',
    whiteSpace: 'nowrap',
    userSelect: 'all',
  };

  const buttonStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: copied ? 'var(--color-success)' : 'var(--accent)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    padding: 'var(--space-2) var(--space-3)',
    flexShrink: 0,
  };

  return (
    <div className={className} style={wrapperStyle}>
      {label && <span style={labelStyle}>{label}</span>}
      <div style={rowStyle}>
        <span style={valueStyle}>{value}</span>
        <button type="button" style={buttonStyle} onClick={handleCopy} aria-label={`Copy ${label ?? 'value'}`}>
          {copied ? (
            <>
              <Check size={16} weight="bold" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy size={16} weight="bold" aria-hidden="true" />
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}
