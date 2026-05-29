"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { safeInternalPath } from "@/lib/http/safe-redirect";

// State shape for useActionState: null = pristine, string = error message.
export type SignInState = string | null;

export async function devSignIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = formData.get("email");
  if (typeof email !== "string" || email.trim() === "") {
    return "Email is required.";
  }

  try {
    await signIn("dev", {
      email,
      name: formData.get("name") ?? "",
      redirectTo: safeInternalPath(formData.get("callbackUrl"))
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
    redirectTo: safeInternalPath(callbackUrl)
  });
}
