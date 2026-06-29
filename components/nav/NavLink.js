"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Inbox, Building2 } from "lucide-react";

const icons = {
  dashboard: LayoutGrid,
  inbox: Inbox,
  building: Building2,
};

// Active-state nav link. Default is a horizontal pill (header); pass `block` for a
// full-width vertical row (sidebar). `onClick` lets the mobile drawer close on tap.
export function NavLink({ href, icon, label, block = false, onClick }) {
  const pathname = usePathname();
  const isActive = pathname === href;
  const Icon = icons[icon];

  const base =
    "flex items-center gap-2 text-sm font-semibold no-underline transition-all";
  const shape = block
    ? "w-full py-2.5 px-3 rounded-[var(--radius-md)]"
    : "py-2 px-[14px] rounded-full";
  const state = isActive
    ? "bg-[var(--bg-inset)] text-[var(--text-strong)]"
    : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]";

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={`${base} ${shape} ${state}`}
    >
      {Icon && <Icon className="w-[17px] h-[17px]" strokeWidth={1.9} />}
      {label}
    </Link>
  );
}
