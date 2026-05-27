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
