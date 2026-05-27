import Link from "next/link";
import { auth, signOut } from "@/auth";

export async function UserMenu() {
  const session = await auth();
  const user = session?.user;

  if (!user?.id) {
    return (
      <Link
        href="/signin"
        className="rounded-md border border-stone-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:border-accent-600 hover:bg-accent-50 hover:text-accent-800"
      >
        Sign in
      </Link>
    );
  }

  return (
    <form
      action={async () => {
        "use server";
        // signOut() dispatches the Auth.js `signOut` event, which is wired
        // in auth.ts to lib/auth-callbacks.ts#signOutEvent. That handler
        // bumps User.sessionsValidFrom, so a replayed copy of the current
        // JWT cookie cannot be reused after this redirect (Sprint 4
        // revocation watermark — already covered by
        // tests/unit/lib/auth-session-revocation.test.ts).
        await signOut({ redirectTo: "/signin" });
      }}
      className="flex items-center gap-2"
    >
      <span className="hidden text-sm text-slate-600 sm:inline">
        {user.email ?? user.name ?? "Signed in"}
      </span>
      <button
        type="submit"
        className="rounded-md border border-stone-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:border-accent-600 hover:bg-accent-50 hover:text-accent-800"
      >
        Sign out
      </button>
    </form>
  );
}
