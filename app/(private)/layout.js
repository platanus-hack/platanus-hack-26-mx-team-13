import { redirect } from "next/navigation";
import { auth, signOut } from "@/libs/core/auth";

// Session-gated routes depend on request cookies, so never prerender them.
export const dynamic = "force-dynamic";

// Server-side gate for every authenticated page. Unauthenticated users are
// bounced to the landing page (`/`). Renders a minimal shell: a header with
// the signed-in user's name and a sign-out button, then the page below.
export default async function PrivateLayout({ children }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
        <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          Facturín
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {session.user.name}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="rounded-full border border-solid border-black/[.08] px-4 py-2 text-sm font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
