export type HighlightColor = {
  value: string;
  label: string;
};

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  { value: "#fde68a", label: "Yellow" },
  { value: "#fed7aa", label: "Orange" },
  { value: "#bfdbfe", label: "Blue" },
  { value: "#bbf7d0", label: "Green" },
  { value: "#fecaca", label: "Red" },
  { value: "#e9d5ff", label: "Purple" }
];

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].value;

const STORAGE_KEY = "textlab-highlight-color";

const ALLOWED_VALUES = new Set(HIGHLIGHT_COLORS.map((entry) => entry.value));

export function isHighlightColor(value: unknown): value is string {
  return typeof value === "string" && ALLOWED_VALUES.has(value);
}

export function getStoredHighlightColor(): string {
  if (typeof window === "undefined") return DEFAULT_HIGHLIGHT_COLOR;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isHighlightColor(stored) ? stored : DEFAULT_HIGHLIGHT_COLOR;
}

export function setStoredHighlightColor(value: string): void {
  if (typeof window === "undefined") return;
  if (!isHighlightColor(value)) return;
  window.localStorage.setItem(STORAGE_KEY, value);
}
