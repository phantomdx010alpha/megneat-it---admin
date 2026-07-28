/**
 * Select — searchable, mobile-first picker primitive.
 *
 * Phase 66 (Milestone 6 — Voucher Write UI). The single most-reused new UI
 * element this milestone needs: choosing one item from a long list (ledgers,
 * stock items, voucher types). Built once here, correctly, before anything
 * depends on it — see PHASES.md's Phase 66 entry.
 *
 * Neumorphic, token-driven (no hardcoded colors — matches every existing
 * primitive's own stated convention, e.g. Input.jsx's inset-on-focus
 * pattern, reused directly below for the trigger and search field).
 *
 * Takes plain `{ value, label }[]` options only — no Dexie/Supabase
 * awareness inside the component itself, per this project's own layering
 * discipline (CLAUDE_MUST_READ.md §4.3): a UI primitive never imports
 * lib/localDb/* or lib/data/* itself. The caller (a later phase's screen,
 * or this phase's own demo page) is responsible for fetching options via
 * lib/localDb/vouchers.js and mapping rows to { value, label } before
 * handing them to this component.
 *
 * Supports:
 *   - search-as-you-type filtering over the supplied option list
 *   - keyboard navigation (ArrowUp/ArrowDown + Enter + Escape)
 *   - a clear "no results" state (reuses EmptyState, not a bespoke one)
 *   - a loading state (reuses LoadingState, preset="list")
 *
 * Out of scope this phase (per PHASES.md): any voucher-specific data
 * wiring, and the modal/bottom-sheet surface this renders inside of on
 * mobile — that's Phase 67's BottomSheet. This phase's dropdown is a plain
 * inline absolutely-positioned panel; Phase 67 will let a later screen swap
 * that panel for BottomSheet on small viewports without changing this
 * component's own public API (value/onChange/options contract stays put).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CaretDown, Check, MagnifyingGlass, X } from '@phosphor-icons/react';
import EmptyState from './EmptyState';
import LoadingState from './LoadingState';

export default function Select({
  label,
  options = [],
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  loading = false,
  disabled = false,
  error,
  hint,
  clearable = false,
  emptyTitle = 'No matches',
  emptyMessage = 'Try a different search term.',
  className = '',
  style,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  const reactId = useId();
  const listboxId = `select-listbox-${reactId}`;

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Reset the highlighted row whenever the visible list changes, so a stale
  // index from a previous query never points at the wrong row.
  useEffect(() => {
    setActiveIndex(filteredOptions.length > 0 ? 0 : -1);
  }, [filteredOptions]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        closeDropdown();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open]);

  // Focus the search field the moment the panel opens.
  useEffect(() => {
    if (open) {
      // Deferred one tick so the input exists in the DOM before focusing.
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Keep the highlighted row scrolled into view during keyboard nav.
  useEffect(() => {
    if (!open || activeIndex < 0 || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-option-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function openDropdown() {
    if (disabled) return;
    setQuery('');
    setOpen(true);
  }

  function closeDropdown() {
    setOpen(false);
    setQuery('');
  }

  function selectOption(option) {
    onChange?.(option.value, option);
    closeDropdown();
  }

  function handleTriggerKeyDown(e) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openDropdown();
    }
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (filteredOptions.length === 0 ? -1 : Math.min(i + 1, filteredOptions.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (filteredOptions.length === 0 ? -1 : Math.max(i - 1, 0)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && filteredOptions[activeIndex]) {
        selectOption(filteredOptions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    } else if (e.key === 'Tab') {
      closeDropdown();
    }
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange?.(null, null);
  }

  // ── Styles (all token-driven, no hardcoded colors) ─────────────────────

  const wrapperStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style };

  const labelStyle = {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    color: error ? 'var(--color-danger)' : 'var(--text-secondary)',
    letterSpacing: 'var(--letter-spacing-wider)',
    textTransform: 'uppercase',
  };

  const rootStyle = { position: 'relative' };

  const triggerStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    background: 'var(--surface-inset)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: open
      ? `var(--shadow-inset), 0 0 0 2px var(--accent)`
      : error
      ? `var(--shadow-inset), 0 0 0 2px var(--color-danger)`
      : 'var(--shadow-inset)',
    padding: '0 var(--space-4)',
    minHeight: '44px',
    transition: `box-shadow var(--transition-base)`,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };

  const triggerLabelStyle = {
    flex: 1,
    fontSize: 'var(--font-size-base)',
    color: selectedOption ? 'var(--text-primary)' : 'var(--text-muted)',
    fontFamily: 'var(--font-family)',
    padding: 'var(--space-3) 0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const panelStyle = {
    position: 'absolute',
    top: 'calc(100% + var(--space-2))',
    left: 0,
    right: 0,
    zIndex: 'var(--z-overlay)',
    background: 'var(--surface)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-raised)',
    padding: 'var(--space-3)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    maxHeight: '360px',
  };

  const searchRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    background: 'var(--surface-inset)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-inset)',
    padding: '0 var(--space-3)',
    minHeight: '40px',
    flexShrink: 0,
  };

  const searchFieldStyle = {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 'var(--font-size-base)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-family)',
    padding: 'var(--space-2) 0',
  };

  const listStyle = {
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  };

  function optionRowStyle(isActive, isSelected) {
    return {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-2)',
      padding: 'var(--space-3)',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: isActive ? 'var(--accent-muted)' : 'transparent',
      color: isSelected ? 'var(--accent)' : 'var(--text-primary)',
      fontWeight: isSelected ? 'var(--font-weight-semibold)' : 'var(--font-weight-regular)',
      fontSize: 'var(--font-size-base)',
    };
  }

  const hintStyle = {
    fontSize: 'var(--font-size-xs)',
    color: error ? 'var(--color-danger)' : 'var(--text-muted)',
    lineHeight: 'var(--line-height-base)',
  };

  return (
    <div className={className} style={wrapperStyle}>
      {label && <label style={labelStyle}>{label}</label>}

      <div ref={rootRef} style={rootStyle}>
        <div
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          style={triggerStyle}
          onClick={openDropdown}
          onKeyDown={handleTriggerKeyDown}
        >
          <span style={triggerLabelStyle}>{selectedOption ? selectedOption.label : placeholder}</span>
          {clearable && selectedOption && !disabled && (
            <X
              size={16}
              weight="bold"
              color="var(--text-muted)"
              onClick={handleClear}
              aria-label="Clear selection"
              style={{ flexShrink: 0, cursor: 'pointer' }}
            />
          )}
          <CaretDown
            size={16}
            weight="bold"
            color="var(--text-muted)"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform var(--transition-base)',
            }}
          />
        </div>

        {open && (
          <div style={panelStyle}>
            <div style={searchRowStyle}>
              <MagnifyingGlass size={16} weight="light" color="var(--text-muted)" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                placeholder={searchPlaceholder}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                style={searchFieldStyle}
                aria-label={searchPlaceholder}
                role="searchbox"
                aria-controls={listboxId}
                aria-activedescendant={
                  activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
                }
              />
            </div>

            {loading ? (
              <LoadingState preset="list" rows={4} label="Loading options" />
            ) : filteredOptions.length === 0 ? (
              <EmptyState title={emptyTitle} message={emptyMessage} />
            ) : (
              <ul id={listboxId} role="listbox" ref={listRef} style={listStyle}>
                {filteredOptions.map((option, index) => {
                  const isSelected = option.value === value;
                  const isActive = index === activeIndex;
                  return (
                    <li
                      key={option.value}
                      id={`${listboxId}-option-${index}`}
                      data-option-index={index}
                      role="option"
                      aria-selected={isSelected}
                      style={optionRowStyle(isActive, isSelected)}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectOption(option)}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {option.label}
                      </span>
                      {isSelected && (
                        <Check size={16} weight="bold" color="var(--accent)" aria-hidden="true" style={{ flexShrink: 0 }} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {(error || hint) && <span style={hintStyle}>{error || hint}</span>}
    </div>
  );
}
