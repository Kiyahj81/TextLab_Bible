// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  getStoredHighlightColor,
  isHighlightColor,
  setStoredHighlightColor
} from "@/lib/highlight";

beforeEach(() => {
  window.localStorage.clear();
});

describe("HIGHLIGHT_COLORS palette", () => {
  it("ships six swatches with the default first", () => {
    expect(HIGHLIGHT_COLORS).toHaveLength(6);
    expect(HIGHLIGHT_COLORS[0].value).toBe(DEFAULT_HIGHLIGHT_COLOR);
  });

  it("includes Orange", () => {
    expect(HIGHLIGHT_COLORS.find((c) => c.label === "Orange")?.value).toBe("#fed7aa");
  });

  it("each swatch has a value and label", () => {
    for (const swatch of HIGHLIGHT_COLORS) {
      expect(typeof swatch.value).toBe("string");
      expect(swatch.value.length).toBeGreaterThan(0);
      expect(typeof swatch.label).toBe("string");
      expect(swatch.label.length).toBeGreaterThan(0);
    }
  });
});

describe("isHighlightColor", () => {
  it("accepts palette values", () => {
    expect(isHighlightColor(HIGHLIGHT_COLORS[0].value)).toBe(true);
    expect(isHighlightColor(HIGHLIGHT_COLORS[3].value)).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isHighlightColor("#000000")).toBe(false);
    expect(isHighlightColor("")).toBe(false);
    expect(isHighlightColor(null)).toBe(false);
    expect(isHighlightColor(undefined)).toBe(false);
    expect(isHighlightColor(123 as unknown)).toBe(false);
  });
});

describe("getStoredHighlightColor / setStoredHighlightColor", () => {
  it("defaults when nothing is stored", () => {
    expect(getStoredHighlightColor()).toBe(DEFAULT_HIGHLIGHT_COLOR);
  });

  it("persists a palette color and reads it back", () => {
    const target = HIGHLIGHT_COLORS[2].value;
    setStoredHighlightColor(target);
    expect(getStoredHighlightColor()).toBe(target);
  });

  it("ignores attempts to persist an unknown color", () => {
    setStoredHighlightColor("#000000");
    expect(getStoredHighlightColor()).toBe(DEFAULT_HIGHLIGHT_COLOR);
  });

  it("falls back to default when stored value is no longer in the palette", () => {
    window.localStorage.setItem("textlab-highlight-color", "#deadbe");
    expect(getStoredHighlightColor()).toBe(DEFAULT_HIGHLIGHT_COLOR);
  });
});
