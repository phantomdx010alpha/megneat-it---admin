/**
 * Surface — neumorphic container primitive.
 * All surfaces in the app derive from this component.
 *
 * variant:
 *   "raised" — default, floats above the page  (box-shadow outward)
 *   "inset"  — pressed into the page           (box-shadow inward)
 *   "flat"   — subtle, minimal depth
 *
 * Never pass color/shadow/radius props directly.
 * Override via tokens.css variables if a reskin is needed.
 */

const VARIANT_STYLES = {
  raised: {
    background: 'var(--surface)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-raised)',
  },
  inset: {
    background: 'var(--surface-inset)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-inset)',
  },
  flat: {
    background: 'var(--surface)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-flat)',
  },
};

export default function Surface({
  variant = 'raised',
  radius,
  padding,
  style,
  className = '',
  children,
  ...rest
}) {
  const variantStyle = VARIANT_STYLES[variant] ?? VARIANT_STYLES.raised;

  const merged = {
    ...variantStyle,
    ...(radius ? { borderRadius: radius } : {}),
    ...(padding !== undefined ? { padding } : {}),
    ...style,
  };

  return (
    <div className={className} style={merged} {...rest}>
      {children}
    </div>
  );
}
