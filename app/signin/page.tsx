import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInForm } from "@/components/SignInForm";
import { safeInternalPath } from "@/lib/http/safe-redirect";
import { devSignIn, githubSignIn } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Invalid credentials.",
  OAuthAccountNotLinked:
    "That account is registered with a different provider. Sign in the original way.",
  Configuration: "Sign-in is misconfigured. Check server logs.",
  default: "Something went wrong signing you in."
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  // Already signed in? Skip the page.
  const session = await auth();
  if (session?.user?.id) {
    redirect("/read");
  }

  const params = await searchParams;
  const callbackUrl = safeInternalPath(firstParam(params.callbackUrl));
  const errorCode = firstParam(params.error);
  const initialError = errorCode ? ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.default : null;

  const devEnabled = process.env.AUTH_DEV_ENABLED === "1";
  const githubEnabled = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  const noProviders = !devEnabled && !githubEnabled;

  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="rounded-lg border border-stone-300 bg-white p-8 shadow-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-accent-700">
          TextLab Bible
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950">
          Sign in
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in to read passages, save notes, and use the assistant.
        </p>

        {noProviders ? (
          <p
            role="alert"
            className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            No sign-in providers are configured. Set <code>AUTH_DEV_ENABLED=1</code> in
            <code>.env</code> (local) or supply <code>GITHUB_CLIENT_ID</code> and
            <code>GITHUB_CLIENT_SECRET</code> (production), then restart the server.
          </p>
        ) : null}

        {/* Surface OAuth ?error= codes (e.g. OAuthAccountNotLinked) here so they
            show in GitHub-only deployments, not just the dev-credentials form. */}
        {initialError ? (
          <p
            role="alert"
            className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {initialError}
          </p>
        ) : null}

        {githubEnabled ? (
          <form
            action={async () => {
              "use server";
              await githubSignIn(callbackUrl);
            }}
            className="mt-6"
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 py-2 font-medium text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              Continue with GitHub
            </button>
          </form>
        ) : null}

        {devEnabled && githubEnabled ? (
          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-slate-500">
            <span className="h-px flex-1 bg-stone-300" />
            or
            <span className="h-px flex-1 bg-stone-300" />
          </div>
        ) : null}

        {devEnabled ? (
          <div className={githubEnabled ? "" : "mt-6"}>
            <SignInForm action={devSignIn} callbackUrl={callbackUrl} />
            <p className="mt-3 text-xs text-slate-500">
              Dev login is enabled. Any email signs in and creates/looks up its user
              record. Never enable this in production.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
