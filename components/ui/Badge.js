"use client";

const tones = {
  neutral: "bg-[var(--warm-100)] text-[var(--warm-700)]",
  success: "bg-[var(--success-soft)] text-[var(--success-text)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning-text)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
  info: "bg-[var(--info-soft)] text-[var(--info-text)]",
  brand: "bg-[var(--brand-soft)] text-[var(--brand-press)]",
};

const solidTones = {
  neutral: "bg-[var(--ink)] text-white",
  success: "bg-[var(--success)] text-white",
  warning: "bg-[var(--warning)] text-[var(--ink)]",
  danger: "bg-[var(--danger)] text-white",
  info: "bg-[var(--info)] text-white",
  brand: "bg-[var(--brand)] text-white",
};

export default function Badge({
  children,
  tone = "neutral",
  variant = "soft",
  size = "md",
  dot = false,
  className = "",
  ...rest
}) {
  const isLarge = size === "lg";
  const toneClasses = variant === "solid" ? solidTones[tone] : variant === "outline"
    ? "bg-transparent border-[var(--border-strong)] text-[var(--text-body)]"
    : tones[tone];

  const classes = [
    "inline-flex items-center gap-1.5",
    "font-semibold leading-none tracking-[0.005em]",
    "rounded-full whitespace-nowrap",
    "border border-transparent",
    isLarge ? "text-sm py-[7px] px-[14px]" : "text-xs py-[5px] px-[11px]",
    toneClasses,
    className,
  ].filter(Boolean).join(" ");

  return (
    <span className={classes} {...rest}>
      {dot && <span className="w-[7px] h-[7px] rounded-full bg-current flex-none" />}
      {children}
    </span>
  );
}
