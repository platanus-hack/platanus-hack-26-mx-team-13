"use client";

const variants = {
  subtle: "bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-strong)]",
  outline: "bg-transparent text-[var(--text-muted)] border-[var(--border-default)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]",
  solid: "bg-[var(--ink)] text-white hover:bg-[var(--warm-800)]",
  brand: "bg-[var(--brand)] text-white shadow-[var(--shadow-brand)] hover:bg-[var(--brand-hover)]",
};

const sizes = {
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-12 h-12",
};

export default function IconButton({
  children,
  variant = "subtle",
  size = "md",
  label,
  className = "",
  ...rest
}) {
  const classes = [
    "inline-grid place-items-center flex-none",
    "rounded-full border border-transparent",
    "cursor-pointer p-0",
    "transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]",
    "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
    "active:translate-y-px",
    variants[variant] || variants.subtle,
    sizes[size] || sizes.md,
    className,
  ].filter(Boolean).join(" ");

  return (
    <button type="button" className={classes} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
