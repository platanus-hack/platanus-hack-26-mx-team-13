"use client";

import { signIn } from "next-auth/react";

// Kicks off the Google OAuth flow and lands the user on /dashboard.
export default function SignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
      className="flex h-12 items-center justify-center gap-2 rounded-full bg-black px-6 text-base font-medium text-white transition-colors hover:bg-zinc-800"
    >
      Sign in with Google
    </button>
  );
}
