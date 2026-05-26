# Custom Sign-In Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, styled `/signin` page so users (and the dev environment) actually have a usable login surface, replacing the empty default Auth.js page currently served at `/api/auth/signin`.

**Architecture:** Custom Auth.js v5 sign-in page wired via `pages.signIn`. The page is a server component that conditionally renders provider blocks based on env (`AUTH_DEV_ENABLED`, `GITHUB_CLIENT_ID`/`SECRET`). Sign-in submissions go through Next.js Server Actions that wrap Auth.js's `signIn()` and surface inline errors via `useActionState`. A minimal sign-out control is added to the global header so the round-trip works end-to-end. CSRF is handled automatically by Next.js Server Actions; no manual token plumbing required.

**Tech Stack:** Next.js 15 App Router, React 19 (`useActionState`), TypeScript, Auth.js v5 (`next-auth@5.0.0-beta.31`), Tailwind (stone/slate + `accent-*` palette, Spectral display font via `font-display`), Vitest + jsdom for unit/component tests.

**Why this matters now:** Sprints 1–3 introduced auth-gated routes via `requirePageAuth` (`lib/auth.ts:23-30`) that redirect unauthenticated users to `/api/auth/signin`. Because `auth.ts:7-49` only adds a provider when env vars are present and `.env` has neither `AUTH_DEV_ENABLED=1` nor `GITHUB_CLIENT_ID/SECRET`, the default Auth.js page renders zero buttons — visible as the empty pill in the bug screenshot. Users cannot sign in, which blocks **all** protected pages (Reader, Search, Notes, Assistant).

---

## File Map

| File | Action | Why |
|---|---|---|
| `.env` | Modify | Set `AUTH_DEV_ENABLED=1` so dev credentials provider is registered locally |
| `auth.ts` | Modify | Add `pages: { signIn: "/signin", error: "/signin" }` to `authConfig` |
| `lib/auth.ts` | Modify | Change `requirePageAuth` redirect target from `/api/auth/signin` to `/signin` |
| `tests/unit/lib/auth.test.ts` | Modify | Update redirect assertion to `/signin` |
| `app/signin/page.tsx` | Create | Server component rendering provider blocks; reads env to decide what to show; shows error from `searchParams.error` |
| `app/signin/actions.ts` | Create | Server actions `devSignIn(prevState, formData)` and `githubSignIn(callbackUrl)` wrapping `signIn()` with `AuthError` handling |
| `app/signin/loading.tsx` | Create | Tiny skeleton so the route never flashes empty |
| `tests/unit/app/signin-actions.test.ts` | Create | TDD tests for action error handling (AuthError → string, other errors re-thrown) |
| `components/SignInForm.tsx` | Create | `"use client"` component wrapping the dev login form with `useActionState` for inline error display |
| `tests/unit/components/SignInForm.test.tsx` | Create | Renders inputs, surfaces error string from action state |
| `components/UserMenu.tsx` | Create | Server component that, when signed in, shows the email and a sign-out form posting to `/api/auth/signout`; when signed out, links to `/signin` |
| `app/layout.tsx` | Modify | Mount `<UserMenu />` in the header so signed-in users can sign out |
| `README.md` | Modify | Note that the local sign-in flow lives at `/signin` and requires `AUTH_DEV_ENABLED=1` |

---

## Out of Scope (deliberately not in this plan)

- Email/magic-link provider (separate provider work).
- Password reset, account self-service, or registration UI distinct from sign-in.
- Visual polish beyond matching the existing palette/typography (no new design system tokens).
- Middleware-level redirect (the Sprint 1–3 plan explicitly notes middleware "must not be the only enforcement layer"; per-page `requirePageAuth` already enforces — we only retarget its destination).
- Per-route `callbackUrl` integration beyond honoring `searchParams.callbackUrl` (already supplied by Auth.js when it redirects). No deep-link preservation rewrite.

---

## Task 0: Enable the dev credentials provider locally

**Files:**
- Modify: `.env` (line 3 trailing — append new line)

- [ ] **Step 1: Add `AUTH_DEV_ENABLED=1` to `.env`**

`.env` currently is:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/textlab_bible?schema=public"
OPENAI_API_KEY=""
AUTH_SECRET="UkkT4yrjQwR2TvNSyG41sh+znVxOtn/SV+vrwSMlnFs="
```

Append:
```
AUTH_DEV_ENABLED=1
AUTH_URL="http://localhost:3000"
```

- [ ] **Step 2: Restart the dev server (if running) so Next.js picks up env**

Run:
```
# Stop the existing `npm run dev` then restart:
npm run dev
```
Expected: server starts on `http://localhost:3000` without env errors.

- [ ] **Step 3: Confirm the provider list now includes "dev"**

Run:
```
curl -s http://localhost:3000/api/auth/providers
```
Expected output contains a JSON object with a `dev` key:
```json
{"dev":{"id":"dev","name":"Dev login","type":"credentials","signinUrl":"...","callbackUrl":"..."}}
```

- [ ] **Step 4: Do not commit `.env`**

`.env` is local-only (only `.env.example` is committed). Verify:
```
git status --short
```
Expected: `.env` does not appear under "Changes not staged" because it's gitignored. If it does appear, stop and check `.gitignore`.

---

## Task 1: Wire `authConfig.pages.signIn` to the custom route

**Files:**
- Modify: `auth.ts:53-78` (insert `pages` block inside `authConfig`)

- [ ] **Step 1: Add the `pages` block to `authConfig`**

In `auth.ts`, between the `session` block and the `cookies` block (after line 58, before line 68), add:

```ts
  // Custom sign-in surface. Without this, Auth.js serves its own page at
  // /api/auth/signin which renders one button per configured provider — and
  // produces a blank page when no providers are configured. Routing here
  // also lets us style the page and add a sign-out control in the header.
  pages: {
    signIn: "/signin",
    error: "/signin"
  },
```

- [ ] **Step 2: Type-check passes**

Run:
```
npx tsc --noEmit
```
Expected: no errors. (`pages` is a known field on `NextAuthConfig`.)

- [ ] **Step 3: Commit**

```bash
git add auth.ts
git commit -m "Route Auth.js signin/error to /signin"
```

---

## Task 2: Retarget `requirePageAuth` redirect

**Files:**
- Modify: `lib/auth.ts:27`
- Modify: `tests/unit/lib/auth.test.ts:46`

- [ ] **Step 1: Update the test first (TDD)**

In `tests/unit/lib/auth.test.ts`, change line 46 from:
```ts
    expect(redirectMock).toHaveBeenCalledWith("/api/auth/signin");
```
to:
```ts
    expect(redirectMock).toHaveBeenCalledWith("/signin");
```

- [ ] **Step 2: Run the test, watch it fail**

Run:
```
npm run test:unit -- tests/unit/lib/auth.test.ts
```
Expected: the `requirePageAuth › redirects when no session` test fails with a mismatch on the redirect URL.

- [ ] **Step 3: Update `lib/auth.ts`**

In `lib/auth.ts`, change line 27 from:
```ts
    redirect("/api/auth/signin");
```
to:
```ts
    redirect("/signin");
```

- [ ] **Step 4: Re-run the test, watch it pass**

Run:
```
npm run test:unit -- tests/unit/lib/auth.test.ts
```
Expected: all three describe blocks pass.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts tests/unit/lib/auth.test.ts
git commit -m "Redirect unauthenticated pages to /signin"
```

---

## Task 3: Server actions for sign-in

**Files:**
- Create: `app/signin/actions.ts`
- Create: `tests/unit/app/signin-actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/app/signin-actions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthError } from "next-auth";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock("@/auth", () => ({ signIn: signInMock }));

import { devSignIn } from "@/app/signin/actions";

function makeAuthError(type: string): Error {
  const err = Object.create(AuthError.prototype) as Error & { type: string };
  err.message = type;
  err.type = type;
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("devSignIn", () => {
  it("returns 'Invalid credentials.' when AuthError of type CredentialsSignin", async () => {
    signInMock.mockRejectedValue(makeAuthError("CredentialsSignin"));
    const fd = new FormData();
    fd.append("email", "bad");
    const result = await devSignIn(null, fd);
    expect(result).toBe("Invalid credentials.");
  });

  it("returns generic message for other AuthError types", async () => {
    signInMock.mockRejectedValue(makeAuthError("Configuration"));
    const fd = new FormData();
    fd.append("email", "x@y");
    const result = await devSignIn(null, fd);
    expect(result).toBe("Something went wrong signing you in.");
  });

  it("re-throws non-AuthError exceptions (incl. NEXT_REDIRECT)", async () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/read;307;" });
    signInMock.mockRejectedValue(redirectErr);
    const fd = new FormData();
    fd.append("email", "x@y");
    await expect(devSignIn(null, fd)).rejects.toThrow("NEXT_REDIRECT");
  });

  it("returns 'Email is required.' before calling signIn when email missing", async () => {
    const fd = new FormData();
    fd.append("email", "");
    const result = await devSignIn(null, fd);
    expect(result).toBe("Email is required.");
    expect(signInMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run:
```
npm run test:unit -- tests/unit/app/signin-actions.test.ts
```
Expected: fails because `@/app/signin/actions` does not exist.

- [ ] **Step 3: Implement the actions**

Create `app/signin/actions.ts`:

```ts
"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

// State shape for useActionState: null = pristine, string = error message.
export type SignInState = string | null;

const DEFAULT_REDIRECT = "/read";

function safeCallbackUrl(raw: FormDataEntryValue | null): string {
  // Only allow same-origin relative paths so a crafted ?callbackUrl=
  // can never bounce a user to an external host post-login.
  if (typeof raw !== "string") return DEFAULT_REDIRECT;
  if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_REDIRECT;
  return raw;
}

export async function devSignIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = formData.get("email");
  if (typeof email !== "string" || email.trim() === "") {
    return "Email is required.";
  }

  try {
    await signIn("dev", {
      email,
      name: formData.get("name") ?? "",
      redirectTo: safeCallbackUrl(formData.get("callbackUrl"))
    });
    return null;
  } catch (error) {
    if (error instanceof AuthError) {
      // Auth.js wraps Credentials authorize() rejections as CredentialsSignin.
      // Other AuthError subtypes (Configuration, AccessDenied, ...) are
      // either dev-environment or provider issues — show a neutral message.
      if ((error as AuthError & { type?: string }).type === "CredentialsSignin") {
        return "Invalid credentials.";
      }
      return "Something went wrong signing you in.";
    }
    // Re-throw redirect "errors" thrown by signIn() so Next.js can handle
    // the navigation, plus any unexpected runtime errors.
    throw error;
  }
}

export async function githubSignIn(callbackUrl?: string): Promise<void> {
  await signIn("github", {
    redirectTo: safeCallbackUrl(callbackUrl ?? null)
  });
}
```

- [ ] **Step 4: Run the test, watch it pass**

Run:
```
npm run test:unit -- tests/unit/app/signin-actions.test.ts
```
Expected: all four cases pass.

- [ ] **Step 5: Run full unit suite and type-check**

Run:
```
npm run test:unit && npx tsc --noEmit
```
Expected: green on both.

- [ ] **Step 6: Commit**

```bash
git add app/signin/actions.ts tests/unit/app/signin-actions.test.ts
git commit -m "Add sign-in server actions for dev credentials and GitHub"
```

---

## Task 4: `SignInForm` client component

**Files:**
- Create: `components/SignInForm.tsx`
- Create: `tests/unit/components/SignInForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/SignInForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SignInForm } from "@/components/SignInForm";

describe("SignInForm", () => {
  it("renders email and name inputs with the action wired", () => {
    const action = vi.fn(async () => null);
    const { getByLabelText, getByRole } = render(
      <SignInForm action={action} callbackUrl="/read" />
    );
    expect(getByLabelText(/email/i)).toBeTruthy();
    expect(getByLabelText(/display name/i)).toBeTruthy();
    expect(getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("renders a hidden callbackUrl input matching prop", () => {
    const action = vi.fn(async () => null);
    const { container } = render(<SignInForm action={action} callbackUrl="/notes" />);
    const hidden = container.querySelector('input[name="callbackUrl"]') as HTMLInputElement | null;
    expect(hidden?.value).toBe("/notes");
  });

  it("surfaces error string returned by the action via initialState prop", () => {
    const action = vi.fn(async () => "Invalid credentials.");
    const { getByText } = render(
      <SignInForm action={action} callbackUrl="/read" initialError="Invalid credentials." />
    );
    expect(getByText(/invalid credentials/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test, watch it fail**

Run:
```
npm run test:unit -- tests/unit/components/SignInForm.test.tsx
```
Expected: fails because `@/components/SignInForm` does not exist.

- [ ] **Step 3: Implement `SignInForm`**

Create `components/SignInForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import type { SignInState } from "@/app/signin/actions";

type Props = {
  action: (prev: SignInState, formData: FormData) => Promise<SignInState>;
  callbackUrl: string;
  // initialError lets the page surface server-side ?error= reads on first paint.
  initialError?: SignInState;
};

export function SignInForm({ action, callbackUrl, initialError = null }: Props) {
  const [state, formAction, isPending] = useActionState<SignInState, FormData>(action, initialError);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.dev"
          className="block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-200"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="name" className="block text-sm font-medium text-slate-700">
          Display name <span className="text-xs font-normal text-slate-500">(optional)</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          className="block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-200"
        />
      </div>
      {state ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-accent-600 px-3 py-2 font-medium text-white shadow-sm transition-colors hover:bg-accent-700 focus:outline-none focus:ring-2 focus:ring-accent-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run the test, watch it pass**

Run:
```
npm run test:unit -- tests/unit/components/SignInForm.test.tsx
```
Expected: all three cases pass.

- [ ] **Step 5: Commit**

```bash
git add components/SignInForm.tsx tests/unit/components/SignInForm.test.tsx
git commit -m "Add SignInForm client component with inline error display"
```

---

## Task 5: `/signin` page (server component)

**Files:**
- Create: `app/signin/page.tsx`
- Create: `app/signin/loading.tsx`

- [ ] **Step 1: Implement the loading skeleton**

Create `app/signin/loading.tsx`:

```tsx
export default function SignInLoading() {
  return (
    <div className="mx-auto mt-16 max-w-md animate-pulse rounded-lg border border-stone-300 bg-white p-8 shadow-sm">
      <div className="h-6 w-32 rounded bg-stone-200" />
      <div className="mt-6 h-10 rounded bg-stone-100" />
      <div className="mt-3 h-10 rounded bg-stone-100" />
      <div className="mt-6 h-10 rounded bg-stone-200" />
    </div>
  );
}
```

- [ ] **Step 2: Implement the page**

Create `app/signin/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInForm } from "@/components/SignInForm";
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

function safeCallback(raw: string | undefined): string {
  if (!raw) return "/read";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/read";
  return raw;
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  // Already signed in? Skip the page.
  const session = await auth();
  if (session?.user?.id) {
    redirect("/read");
  }

  const params = await searchParams;
  const callbackUrl = safeCallback(firstParam(params.callbackUrl));
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
            <SignInForm action={devSignIn} callbackUrl={callbackUrl} initialError={initialError} />
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
```

- [ ] **Step 3: Type-check + lint**

Run:
```
npx tsc --noEmit && npm run lint
```
Expected: no errors, no warnings.

- [ ] **Step 4: Manual browser check**

With `npm run dev` running:
1. Visit `http://localhost:3000/signin` → page should render the styled card with email/name inputs and a "Sign in" button (since `AUTH_DEV_ENABLED=1`).
2. Submit with an empty email → inline error "Email is required."
3. Submit with `you@example.dev` and name "Tester" → redirected to `/read` and reader content loads.
4. Hit `http://localhost:3000/signin?error=CredentialsSignin` directly → page shows "Invalid credentials." in red on first paint.
5. Visit `http://localhost:3000/signin` while signed in → redirected to `/read`.

- [ ] **Step 5: Commit**

```bash
git add app/signin/page.tsx app/signin/loading.tsx
git commit -m "Add styled /signin page wired to dev and GitHub providers"
```

---

## Task 6: Sign-out control in the global header

**Files:**
- Create: `components/UserMenu.tsx`
- Modify: `app/layout.tsx:43-60` (header block)

- [ ] **Step 1: Implement `UserMenu`**

Create `components/UserMenu.tsx`:

```tsx
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
```

- [ ] **Step 2: Mount `UserMenu` in the header**

In `app/layout.tsx`, change the header block (lines 43–60) from:
```tsx
        <header className="border-b border-stone-300 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/read" className="font-display text-xl font-semibold tracking-tight text-slate-900">
              TextLab Bible
            </Link>
            <nav className="flex flex-wrap gap-2 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md border border-stone-300 px-3 py-2 text-slate-700 transition-colors hover:border-accent-600 hover:bg-accent-50 hover:text-accent-800"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
```
to:
```tsx
        <header className="border-b border-stone-300 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/read" className="font-display text-xl font-semibold tracking-tight text-slate-900">
              TextLab Bible
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <nav className="flex flex-wrap gap-2 text-sm">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md border border-stone-300 px-3 py-2 text-slate-700 transition-colors hover:border-accent-600 hover:bg-accent-50 hover:text-accent-800"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <UserMenu />
            </div>
          </div>
        </header>
```

And add the import at the top with the other imports:
```tsx
import { UserMenu } from "@/components/UserMenu";
```

- [ ] **Step 3: Type-check + lint**

Run:
```
npx tsc --noEmit && npm run lint
```
Expected: no errors, no warnings.

- [ ] **Step 4: Manual browser check (signed-in round-trip)**

With `npm run dev` running:
1. From `/read` (signed in from Task 5), confirm the header shows your email and a "Sign out" button.
2. Click "Sign out" → redirected to `/signin`, header now shows "Sign in" link.
3. Click "Sign in" → land on `/signin`, sign in again, header reverts to signed-in state.

- [ ] **Step 5: Commit**

```bash
git add components/UserMenu.tsx app/layout.tsx
git commit -m "Add header sign-in/sign-out control"
```

---

## Task 7: README + final verification

**Files:**
- Modify: `README.md` (the auth section near line 49–52)

- [ ] **Step 1: Update README to point at `/signin`**

In `README.md`, replace the existing "For local sign-in" bullet (around line 51) with:

```
- For local sign-in without a real OAuth provider, set `AUTH_DEV_ENABLED=1`. The sign-in page lives at `/signin`. **Never set this in production.**
```

And in the same section, add right after:

```
- Protected pages (`/read`, `/search`, `/notes`, `/assistant`) redirect unauthenticated visitors to `/signin`. After sign-in, the header offers a "Sign out" button.
```

- [ ] **Step 2: Run the full local verification gates**

Run, in order:
```
npm run lint
npx tsc --noEmit
npm run test:unit
npm run build
```
Expected:
- `lint`: zero warnings.
- `tsc`: zero errors.
- `test:unit`: all tests green (including the new `signin-actions` and `SignInForm` suites and the updated `auth.test.ts`).
- `build`: clean compile; `/signin` appears in the route list.

- [ ] **Step 3: Manual end-to-end smoke (golden path)**

With `npm run dev`:
1. Open an incognito window. Visit `http://localhost:3000/read` → redirected to `/signin?callbackUrl=%2Fread`.
2. Sign in as `smoke@example.dev` with name `Smoke`. → land on `/read`, header shows the email.
3. Click "Notes", "Search", "Assistant" → no auth bounce, each page loads.
4. Click "Sign out" → land on `/signin`. Header shows "Sign in" link.
5. Manually visit `/read` again → redirected to `/signin`.

- [ ] **Step 4: Manual end-to-end smoke (negative paths)**

1. On `/signin`, submit empty form → inline "Email is required.", no network request to `/api/auth`.
2. Visit `/signin?callbackUrl=https://evil.example.com` and sign in → land on `/read`, not the external URL.
3. Visit `/signin?error=CredentialsSignin` → page renders with the red error banner on first paint.

- [ ] **Step 5: Commit and (optionally) open PR**

```bash
git add README.md
git commit -m "Document /signin flow and dev login requirement"
```

If a PR is desired, push and open one per the project's normal workflow.

---

## Self-Review Notes

- **Spec coverage:** Every promised piece of the chosen option lands somewhere:
  - Custom styled `/signin` page → Task 5 (`app/signin/page.tsx` + `app/signin/loading.tsx`) + Task 4 (`SignInForm`).
  - Wire `pages.signIn` → Task 1.
  - Redirect `requirePageAuth` to `/signin` → Task 2 (with TDD update to `auth.test.ts`).
  - Enable `AUTH_DEV_ENABLED=1` in `.env` → Task 0.
  - Match the app's design (stone/slate + `accent-*` + `font-display`) → component classnames in Tasks 4–6 use exclusively these tokens.
  - End-to-end usable flow (sign-in **and** sign-out) → Task 6 adds the sign-out affordance; without it the user gets locked into a signed-in state with no exit.
- **Placeholder scan:** No TBDs, no "implement appropriate X", no "similar to Task N". All code blocks contain full content.
- **Type consistency:** `SignInState`, `devSignIn`, `githubSignIn`, `SignInForm.action`, and `useActionState`'s generics line up across Tasks 3–5. `safeCallbackUrl` (action-side) and `safeCallback` (page-side) deliberately duplicate the relative-path check so neither layer trusts the other's input.
- **Test realism:** Tests follow the existing project patterns — `vi.hoisted` + `vi.mock("@/auth", ...)` mirrors `tests/unit/lib/auth.test.ts:3-7`; the jsdom component test mirrors `tests/unit/components/ReaderControls.test.tsx`.
- **No scope creep:** Email/magic-link, registration, middleware redirects, and password flows are explicitly carved out above so a fresh implementer doesn't pull them in.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-custom-signin-page.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
