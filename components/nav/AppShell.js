"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { NavLink } from "@/components/nav/NavLink";

const NAV = [
  { href: "/dashboard", icon: "dashboard", label: "Inicio" },
  { href: "/tickets", icon: "inbox", label: "Tickets" },
  { href: "/empresas", icon: "building", label: "Mis Empresas" },
];

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
      <span
        className="w-7 h-7 rounded-lg grid place-items-center text-white flex-none"
        style={{
          background: "var(--brand)",
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 18,
          boxShadow: "var(--shadow-brand)",
        }}
      >
        F
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 24,
          letterSpacing: "-0.015em",
          color: "var(--ink)",
          lineHeight: 1,
        }}
      >
        Factur<span style={{ color: "var(--brand)" }}>i</span>n
      </span>
    </Link>
  );
}

function UserBlock({ user, signOutSlot }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-[38px] h-[38px] rounded-full grid place-items-center text-white text-sm font-bold flex-none"
        style={{ background: "linear-gradient(135deg, var(--coral-400), var(--amber-400))" }}
      >
        {user.initials}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[13px] font-semibold truncate" style={{ color: "var(--text-strong)" }}>
          {user.name}
        </div>
        {user.email && (
          <div className="text-[11px] font-mono truncate" style={{ color: "var(--text-faint)" }}>
            {user.email}
          </div>
        )}
      </div>
      {signOutSlot}
    </div>
  );
}

// Authenticated app shell: a persistent left rail on desktop (lg+), a slim top bar +
// slide-in drawer on mobile. Server-owned bits (the signOut server action) are passed
// in as `signOutSlot` so this stays a client component for the drawer interactivity.
export function AppShell({ user, signOutSlot, children }) {
  const [open, setOpen] = useState(false);

  // The drawer closes on nav tap (each NavLink's onClick) and on Escape/overlay
  // click below — no pathname effect needed.

  // Escape closes the drawer; lock body scroll while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => (
        <NavLink key={n.href} {...n} block onClick={() => setOpen(false)} />
      ))}
    </nav>
  );

  return (
    <div
      className="min-h-screen lg:flex"
      style={{ background: "var(--bg-page)", fontFamily: "var(--font-sans)" }}
    >
      {/* Desktop rail */}
      <aside
        className="hidden lg:flex lg:flex-col lg:w-[240px] lg:shrink-0 lg:h-screen lg:sticky lg:top-0 px-3 py-5 gap-6"
        style={{ background: "var(--bg-surface)", borderRight: "1px solid var(--border-subtle)" }}
      >
        <div className="px-2">
          <Logo />
        </div>
        {nav}
        <div className="mt-auto pt-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <UserBlock user={user} signOutSlot={signOutSlot} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header
        className="lg:hidden sticky top-0 z-20 flex items-center justify-between gap-4 px-5 py-3"
        style={{
          background: "color-mix(in srgb, var(--paper) 86%, transparent)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <button
          type="button"
          aria-label="Abrir menú"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="w-9 h-9 grid place-items-center rounded-lg border cursor-pointer"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-default)",
            color: "var(--text-muted)",
          }}
        >
          <Menu className="w-[18px] h-[18px]" strokeWidth={1.9} />
        </button>
        <Logo />
        <span
          className="w-9 h-9 rounded-full grid place-items-center text-white text-[13px] font-bold flex-none"
          style={{ background: "linear-gradient(135deg, var(--coral-400), var(--amber-400))" }}
        >
          {user.initials}
        </span>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Menú"
        >
          <div
            className="absolute inset-0"
            style={{ background: "rgba(26,23,20,0.5)", backdropFilter: "blur(4px)" }}
            onClick={() => setOpen(false)}
          />
          <aside
            className="absolute left-0 top-0 h-full w-[260px] flex flex-col px-3 py-5 gap-6"
            style={{ background: "var(--bg-surface)", borderRight: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center justify-between px-2">
              <Logo />
              <button
                type="button"
                aria-label="Cerrar menú"
                onClick={() => setOpen(false)}
                className="w-9 h-9 grid place-items-center rounded-lg border cursor-pointer"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: "var(--border-default)",
                  color: "var(--text-muted)",
                }}
              >
                <X className="w-[18px] h-[18px]" strokeWidth={1.9} />
              </button>
            </div>
            {nav}
            <div className="mt-auto pt-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <UserBlock user={user} signOutSlot={signOutSlot} />
            </div>
          </aside>
        </div>
      )}

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

export default AppShell;
