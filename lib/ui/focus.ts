// lib/ui/focus.ts
// Shared keyboard-focus styling so every interactive control gets the same
// visible ring. Defined once; Tailwind scans lib/** so these classes ship.
export const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

export const FOCUS_RING_INPUT =
  "focus:outline-none focus:border-accent-600 focus-visible:ring-2 focus-visible:ring-accent-400";
