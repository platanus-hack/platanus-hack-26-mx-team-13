"use client";

export default function Card({
  children,
  title,
  subtitle,
  headerRight,
  variant = "raised",
  padding = "md",
  interactive = false,
  accent,
  className = "",
  style,
  ...rest
}) {
  const variantClasses = {
    raised: "shadow-[var(--shadow-sm)]",
    flat: "",
    inset: "bg-[var(--bg-subtle)] shadow-none",
  };

  const paddingClasses = {
    sm: "p-4",
    md: "p-6",
    lg: "p-8",
  };

  const classes = [
    "bg-white border border-[var(--border-subtle)]",
    "rounded-[var(--radius-2xl)] box-border",
    "transition-all duration-[var(--dur-base)] ease-[var(--ease-out)]",
    variantClasses[variant] || variantClasses.raised,
    paddingClasses[padding] || paddingClasses.md,
    interactive ? "cursor-pointer hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5 hover:border-[var(--border-default)]" : "",
    accent ? "border-t-[3px]" : "",
    className,
  ].filter(Boolean).join(" ");

  const mergedStyle = accent ? { ...style, borderTopColor: accent } : style;

  return (
    <div className={classes} style={mergedStyle} {...rest}>
      {(title || headerRight) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            {title && (
              <h3 className="m-0 font-semibold text-lg tracking-tight text-[var(--text-strong)]" style={{ fontFamily: "var(--font-display)" }}>
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-sm text-[var(--text-muted)] mt-1 mb-0 leading-normal">
                {subtitle}
              </p>
            )}
          </div>
          {headerRight}
        </div>
      )}
      {children}
    </div>
  );
}
