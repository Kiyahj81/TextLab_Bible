import { useEffect, type Dispatch, type SetStateAction } from "react";

const DEFAULT_DISMISS_MS = 4000;

/**
 * Auto-clears a single status string after `ms` of inactivity.
 *
 * The compare-then-clear guard means a freshly-set value won't be wiped by
 * a stale timer left over from a previous status.
 */
export function useAutoDismissString(
  value: string | null | undefined,
  setValue: Dispatch<SetStateAction<string | null>>,
  ms = DEFAULT_DISMISS_MS
) {
  useEffect(() => {
    if (!value) return;
    const timer = window.setTimeout(() => {
      setValue((current) => (current === value ? null : current));
    }, ms);
    return () => window.clearTimeout(timer);
  }, [value, setValue, ms]);
}

/**
 * Auto-clears entries in a status map after `ms` per entry (effectively per
 * "wave" — every map change resets the timer, so adding a new entry extends
 * the dismissal window of older entries until the next quiet period).
 */
export function useAutoDismissMap(
  values: Record<string, string>,
  setValues: Dispatch<SetStateAction<Record<string, string>>>,
  ms = DEFAULT_DISMISS_MS
) {
  useEffect(() => {
    const entries = Object.entries(values).filter(([, value]) => value);
    if (entries.length === 0) return;
    const timer = window.setTimeout(() => {
      setValues((current) => {
        const next = { ...current };
        let mutated = false;
        for (const [key, snapshot] of entries) {
          if (next[key] === snapshot) {
            delete next[key];
            mutated = true;
          }
        }
        return mutated ? next : current;
      });
    }, ms);
    return () => window.clearTimeout(timer);
  }, [values, setValues, ms]);
}
