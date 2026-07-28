/**
 * LoadingState — neumorphic pulse animation skeleton.
 *
 * No external spinner library.
 * Uses the `neu-pulse` keyframe defined in tokens.css.
 * No hardcoded colors — all from tokens.
 */

function PulseBlock({ width = '100%', height = '20px', radius, style }) {
  return (
    <div
      className="neu-pulse"
      style={{
        width,
        height,
        borderRadius: radius ?? 'var(--radius-sm)',
        background: 'var(--surface-inset)',
        ...style,
      }}
    />
  );
}

/**
 * preset:
 *   "list"    — skeleton that looks like a 3-row list
 *   "card"    — skeleton that looks like a data card
 *   "inline"  — single pulsing line (for inline use)
 *   "custom"  — renders children as-is within the wrapper
 */
export default function LoadingState({
  preset = 'list',
  label = 'Loading',
  rows = 3,
  className = '',
  style,
  children,
}) {
  const wrapperStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    ...style,
  };

  function renderSkeleton() {
    if (preset === 'custom') return children;

    if (preset === 'inline') {
      return <PulseBlock height="16px" width="60%" />;
    }

    if (preset === 'card') {
      return (
        <>
          <PulseBlock height="14px" width="40%" />
          <PulseBlock height="28px" width="70%" />
          <PulseBlock height="12px" width="55%" />
        </>
      );
    }

    // "list" — n rows each with a leading circle + two lines
    return Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <PulseBlock
          width="36px"
          height="36px"
          radius="var(--radius-full)"
          style={{ flexShrink: 0 }}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <PulseBlock height="14px" width={`${65 + (i % 3) * 10}%`} />
          <PulseBlock height="11px" width={`${40 + (i % 2) * 15}%`} />
        </div>
      </div>
    ));
  }

  return (
    <div
      className={className}
      style={wrapperStyle}
      role="status"
      aria-label={label}
      aria-live="polite"
    >
      {renderSkeleton()}
    </div>
  );
}
