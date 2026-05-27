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
