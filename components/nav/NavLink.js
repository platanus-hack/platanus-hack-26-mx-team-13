"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Inbox } from "lucide-react";

const icons = {
  dashboard: LayoutGrid,
  inbox: Inbox,
};

export function NavLink({ href, icon, label }) {
  const pathname = usePathname();
  const isActive = pathname === href;
  const Icon = icons[icon];

  return (
    <Link
      href={href}
      className={`flex items-center gap-2 py-2 px-[14px] rounded-full text-sm font-semibold no-underline transition-all ${
        isActive
          ? "bg-[var(--bg-inset)] text-[var(--text-strong)]"
          : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-strong)]"
      }`}
    >
      {Icon && <Icon className="w-[17px] h-[17px]" strokeWidth={1.9} />}
      {label}
    </Link>
  );
}
