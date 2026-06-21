import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/libs/core/auth";
import { LayoutGrid, Inbox, LogOut } from "lucide-react";
import { NavLink } from "@/components/nav/NavLink";
import { IconButton } from "@/components/ui";

// Session-gated routes depend on request cookies, so never prerender them.
export const dynamic = "force-dynamic";

function getInitials(name) {
  if (!name) return "U";
  const parts = name.split(" ");
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

// Server-side gate for every authenticated page. Unauthenticated users are
// bounced to the landing page (`/`). Renders a minimal shell: a header with
// the signed-in user's name and a sign-out button, then the page below.
export default async function PrivateLayout({ children }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const user = session.user;
  const initials = getInitials(user.name);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg-page)", fontFamily: "var(--font-sans)" }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between gap-4 px-7 py-[14px]"
        style={{
          background: "color-mix(in srgb, var(--paper) 86%, transparent)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-7">
          {/* Logo */}
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
                fontSize: 26,
                letterSpacing: "-0.015em",
                color: "var(--ink)",
                lineHeight: 1,
              }}
            >
              Factur<span style={{ color: "var(--brand)" }}>i</span>n
            </span>
          </Link>

          {/* Nav */}
          <nav className="flex gap-1">
            <NavLink href="/dashboard" icon="dashboard" label="Inicio" />
            <NavLink href="/tickets" icon="inbox" label="Tickets" />
          </nav>
        </div>

        {/* Right: User */}
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight whitespace-nowrap">
            <div className="text-[13px] font-semibold" style={{ color: "var(--text-strong)" }}>
              {user.name}
            </div>
            {user.email && (
              <div className="text-[11px] font-mono" style={{ color: "var(--text-faint)" }}>
                {user.email.length > 20 ? user.email.substring(0, 20) + "..." : user.email}
              </div>
            )}
          </div>
          <span
            className="w-[38px] h-[38px] rounded-full grid place-items-center text-white text-sm font-bold flex-none"
            style={{
              background: "linear-gradient(135deg, var(--coral-400), var(--amber-400))",
            }}
          >
            {initials}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="inline-grid place-items-center w-9 h-9 rounded-lg border cursor-pointer transition-all"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border-default)",
                color: "var(--text-muted)",
              }}
              aria-label="Cerrar sesion"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.8} />
            </button>
          </form>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
