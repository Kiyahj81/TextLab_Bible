// eval/references.ts
import { formatReference, parseReference } from "@/lib/references";

export function canonicalizeReference(input: string): string | null {
  const parsed = parseReference(input);
  if (!parsed) return null;
  return formatReference(parsed.book, parsed.chapter, parsed.verse);
}

export function referenceSet(refs: string[]): Set<string> {
  const set = new Set<string>();
  for (const ref of refs) {
    const canonical = canonicalizeReference(ref);
    if (canonical) set.add(canonical);
  }
  return set;
}

export function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const value of a) if (b.has(value)) count++;
  return count;
}
