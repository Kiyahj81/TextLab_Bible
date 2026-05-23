// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useAutoDismissMap, useAutoDismissString } from "@/lib/useAutoDismissStatus";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoDismissString", () => {
  it("clears a non-empty status after the configured delay", () => {
    const { result } = renderHook(() => {
      const [value, setValue] = useState<string | null>("saved.");
      useAutoDismissString(value, setValue, 200);
      return { value, setValue };
    });

    expect(result.current.value).toBe("saved.");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.value).toBeNull();
  });

  it("does not schedule a clear when the value is null", () => {
    const { result } = renderHook(() => {
      const [value, setValue] = useState<string | null>(null);
      useAutoDismissString(value, setValue, 200);
      return { value, setValue };
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.value).toBeNull();
  });

  it("does not clear a value that was replaced after the timer started", () => {
    const { result } = renderHook(() => {
      const [value, setValue] = useState<string | null>("first");
      useAutoDismissString(value, setValue, 200);
      return { value, setValue };
    });

    act(() => {
      vi.advanceTimersByTime(100);
      result.current.setValue("second");
    });

    // Original 100 ms timer would have fired at 200 ms but the new value
    // resets the schedule. After another 100 ms (total 200 ms), nothing clears
    // because the effect re-ran with the new "second" snapshot.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.value).toBe("second");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.value).toBeNull();
  });
});

describe("useAutoDismissMap", () => {
  it("clears each entry after the configured delay", () => {
    const { result } = renderHook(() => {
      const [value, setValue] = useState<Record<string, string>>({ a: "saved" });
      useAutoDismissMap(value, setValue, 200);
      return { value, setValue };
    });

    expect(result.current.value).toEqual({ a: "saved" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.value).toEqual({});
  });

  it("does not clear entries whose value changed after the timer started", () => {
    const { result } = renderHook(() => {
      const [value, setValue] = useState<Record<string, string>>({ a: "first" });
      useAutoDismissMap(value, setValue, 200);
      return { value, setValue };
    });

    act(() => {
      vi.advanceTimersByTime(100);
      result.current.setValue({ a: "second" });
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.value).toEqual({ a: "second" });
  });

  it("is inert when the map is empty", () => {
    const { result } = renderHook(() => {
      const [value, setValue] = useState<Record<string, string>>({});
      useAutoDismissMap(value, setValue, 200);
      return { value };
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.value).toEqual({});
  });
});
