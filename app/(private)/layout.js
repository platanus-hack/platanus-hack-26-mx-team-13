import { redirect } from "next/navigation";
import { auth, signOut } from "@/libs/core/auth";
import { LogOut } from "lucide-react";
import { AppShell } from "@/components/nav/AppShell";

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

// Server-side gate for every authenticated page. Unauthenticated users are bounced
// to the landing page (`/`). The shell (sidebar + mobile drawer) lives in the client
// AppShell; the signOut server action is passed down as a slot so AppShell stays a
// client component without losing the server-action form.
export default async function PrivateLayout({ children }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const user = session.user;
  const initials = getInitials(user.name);

  const signOutSlot = (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="inline-grid place-items-center w-9 h-9 rounded-lg border cursor-pointer transition-all flex-none"
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
  );

  return (
    <AppShell
      user={{ name: user.name, email: user.email, initials }}
      signOutSlot={signOutSlot}
    >
      {children}
    </AppShell>
  );
}
