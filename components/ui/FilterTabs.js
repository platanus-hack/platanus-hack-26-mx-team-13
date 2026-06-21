"use client";

export default function FilterTabs({ tabs = [], value, onChange, className = "", ...rest }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="tablist" {...rest}>
      {tabs.map((t) => {
        const key = t.value ?? t.label;
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`
              inline-flex items-center gap-[7px]
              text-sm font-semibold leading-none
              rounded-full py-[7px] px-[15px] cursor-pointer
              border transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]
              focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]
              ${selected
                ? "bg-[var(--ink)] border-[var(--ink)] text-white"
                : "bg-transparent border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)]"
              }
            `}
            onClick={() => onChange?.(key)}
          >
            {t.label}
            {t.count != null && (
              <span
                className={`
                  font-mono text-[11px] font-bold
                  py-[1px] px-[7px] rounded-full
                  ${selected
                    ? "bg-white/[.18] text-white"
                    : "bg-[var(--bg-inset)] text-[var(--text-muted)]"
                  }
                `}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
