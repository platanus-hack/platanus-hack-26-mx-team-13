"use client";

import { ArrowRight } from "lucide-react";

const variants = {
  primary: "bg-[var(--brand)] text-white shadow-[var(--shadow-brand)] hover:bg-[var(--brand-hover)] active:bg-[var(--brand-press)]",
  secondary: "bg-white text-[var(--text-strong)] border border-[var(--border-default)] shadow-[var(--shadow-xs)] hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]",
  ghost: "bg-transparent text-[var(--text-strong)] border border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]",
  coral: "bg-[var(--coral-200)] text-[var(--coral-700)] hover:bg-[var(--coral-300)]",
  quiet: "bg-transparent text-[var(--text-muted)] border-transparent hover:bg-[var(--bg-subtle)] hover:text-[var(--text-strong)] shadow-none px-3",
};

const sizes = {
  sm: "py-2 px-4 text-[13px] gap-2",
  md: "py-3 px-[22px] text-[15px] gap-2.5",
  lg: "py-[15px] px-7 text-[17px] gap-3",
};

const arrowSizes = {
  sm: "w-6 h-6",
  md: "w-[30px] h-[30px]",
  lg: "w-[34px] h-[34px]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  arrow = false,
  loading = false,
  fullWidth = false,
  iconLeft = null,
  as = "button",
  className = "",
  ...rest
}) {
  const Tag = as;

  const baseClasses = [
    "inline-flex items-center justify-center",
    "font-semibold leading-none tracking-[-0.005em]",
    "rounded-full border-[1.5px] border-transparent",
    "cursor-pointer whitespace-nowrap no-underline",
    "transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]",
    "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
    "active:translate-y-px",
    "disabled:opacity-50 disabled:pointer-events-none",
    variants[variant] || variants.primary,
    sizes[size] || sizes.md,
    fullWidth ? "w-full" : "",
    arrow ? "pr-2" : "",
    className,
  ].filter(Boolean).join(" ");

  const arrowBg = {
    primary: "bg-black/20",
    coral: "bg-[var(--coral-500)] text-white",
    secondary: "bg-[var(--ink)] text-white",
    ghost: "bg-[var(--ink)] text-white",
    quiet: "bg-[var(--ink)] text-white",
  };

  return (
    <Tag className={baseClasses} {...rest}>
      {loading ? (
        <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : iconLeft}
      <span>{children}</span>
      {arrow && !loading && (
        <span
          className={`rounded-full flex-none grid place-items-center ml-0.5 ${arrowSizes[size]} ${arrowBg[variant] || arrowBg.primary}`}
        >
          <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
        </span>
      )}
    </Tag>
  );
}
