'use client';

/**
 * BottomSheet — single responsive modal/sheet container.
 *
 * Phase 67 (Milestone 6 — Voucher Write UI), part 2 of the new UI
 * primitives pair started in Phase 66. Per PHASES.md's Phase 67 entry:
 * slides up from the bottom on mobile, renders as a centered modal on
 * desktop; traps focus while open; closes on backdrop tap or Escape; is
 * what Phase 66's `Select` opens inside of on mobile (a full list is
 * easier to search/scroll in a full-height sheet than an inline dropdown
 * on a small screen).
 *
 * Neumorphic, token-driven — no hardcoded colors, matching every existing
 * primitive's own stated convention. The mobile-vs-desktop layout switch
 * (bottom sheet vs. centered modal, different border-radius and enter
 * animation on each) can't be expressed with inline styles alone since
 * inline styles don't support media queries, so this file follows the same
 * plain `<style>` + `@media` pattern already established in this project
 * (see app/(app)/local-db/page.js's own ".md-show"/`@media (min-width:
 * 768px)` block) rather than reaching for a new approach.
 *
 * Rendered via a portal into document.body, same reasoning any modal
 * needs: escape the parent's stacking/overflow context entirely rather
 * than risk being clipped by an ancestor's `overflow: hidden` (several
 * Card/Surface-wrapped screens in this app could otherwise clip it).
 *
 * This phase's own scope is the container only — no voucher-specific
 * content lives here. Phase 66's `Select` is demoed opening inside this
 * component in this phase's dev preview page, proving the pairing works,
 * without either component importing the other (Select stays a pure
 * primitive with no BottomSheet awareness; callers choose whether to wrap
 * it, exactly as Phase 66's own "Out of scope" line deferred this
 * decision to this phase).
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  className = '',
  style,
  contentStyle,
}) {
  const panelRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Body scroll lock + focus trap + Escape-to-close, all scoped to the
  // lifetime of `open`. Restores the previously-focused element on close,
  // standard modal-accessibility hygiene.
  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function getFocusable() {
      return Array.from(panelRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) ?? []);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    // Focus the first focusable element inside the panel (or the panel
    // itself if it has none) once it's actually mounted.
    const focusTimer = setTimeout(() => {
      const focusable = getFocusable();
      (focusable[0] ?? panelRef.current)?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
      clearTimeout(focusTimer);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  return createPortal(
    <div className={`magneatit-bottomsheet-backdrop ${className}`} style={style} onMouseDown={handleBackdropClick}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Dialog'}
        tabIndex={-1}
        className="magneatit-bottomsheet-panel"
        style={contentStyle}
      >
        <div className="magneatit-bottomsheet-handle" aria-hidden="true" />

        {(title || onClose) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-4)',
              flexShrink: 0,
            }}
          >
            {title && (
              <h2
                style={{
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--text-primary)',
                  margin: 0,
                }}
              >
                {title}
              </h2>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '36px',
                  height: '36px',
                  flexShrink: 0,
                  marginLeft: 'auto',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--surface-inset)',
                  boxShadow: 'var(--shadow-inset)',
                  cursor: 'pointer',
                }}
              >
                <X size={16} weight="bold" color="var(--text-secondary)" />
              </button>
            )}
          </div>
        )}

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>{children}</div>
      </div>

      {/*
       * Responsive layout + animation — see this file's own header comment
       * for why this can't be plain inline styles. Mirrors the breakpoint
       * (768px) every other responsive piece of this app already uses
       * (components/layout/AppShell.jsx's `md:` Tailwind classes,
       * app/(app)/local-db/page.js's own raw `@media (min-width: 768px)`
       * block).
       */}
      <style>{`
        .magneatit-bottomsheet-backdrop {
          position: fixed;
          inset: 0;
          z-index: var(--z-modal);
          background: var(--overlay-backdrop);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: magneatit-bottomsheet-fade-in var(--transition-base) ease;
        }
        .magneatit-bottomsheet-panel {
          position: relative;
          width: 100%;
          max-height: 85vh;
          background: var(--surface);
          box-shadow: var(--shadow-raised);
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          padding: var(--space-6);
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
          animation: magneatit-bottomsheet-slide-up var(--transition-slow) ease;
        }
        .magneatit-bottomsheet-handle {
          width: 40px;
          height: 4px;
          border-radius: var(--radius-full);
          background: var(--surface-inset);
          box-shadow: var(--shadow-inset);
          margin: 0 auto;
          flex-shrink: 0;
        }
        @keyframes magneatit-bottomsheet-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes magneatit-bottomsheet-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes magneatit-bottomsheet-scale-in {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        @media (min-width: 768px) {
          .magneatit-bottomsheet-backdrop {
            align-items: center;
          }
          .magneatit-bottomsheet-panel {
            width: auto;
            min-width: 420px;
            max-width: 560px;
            max-height: 80vh;
            border-radius: var(--radius-lg);
            animation: magneatit-bottomsheet-scale-in var(--transition-base) ease;
          }
          .magneatit-bottomsheet-handle {
            display: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .magneatit-bottomsheet-backdrop,
          .magneatit-bottomsheet-panel {
            animation: none;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
