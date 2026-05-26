import { localUserId } from "@/lib/user";

export type AuthContext = {
  userId: string;
};

// Stub for Sprint 1. Sprint 2 replaces this with a real session lookup
// (Auth.js v5). All handler code is written against this contract so the
// swap is a single-file change.
export async function requireUserId(): Promise<string> {
  return localUserId;
}

export async function getOptionalUserId(): Promise<string | null> {
  return localUserId;
}
