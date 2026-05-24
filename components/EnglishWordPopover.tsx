"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HighlightPalette } from "@/components/HighlightPalette";

const POPOVER_MARGIN = 8;
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function EnglishWordPopover({
  word,
  activeColor,
  onPick,
  onClear,
  onClose
}: {
  word: string;
  activeColor: string | null;
  onPick: (color: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [horizontalAlign, setHorizontalAlign] = useState<"left" | "right">("left");

  useIsomorphicLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const overflowsRight = rect.right > window.innerWidth - POPOVER_MARGIN;
    setHorizontalAlign(overflowsRight ? "right" : "left");
  }, []);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      const node = containerRef.current;
      if (!node) return;
      const scope = node.parentElement ?? node;
      if (event.target instanceof Node && !scope.contains(event.target)) {
        onClose();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className={`absolute top-full z-20 mt-2 origin-top animate-popover-in rounded-md border border-stone-300 bg-white p-3 shadow-xl ${
        horizontalAlign === "right" ? "right-0" : "left-0"
      }`}
    >
      <div className="mb-2 max-w-[18rem] truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
        {word}
      </div>
      <HighlightPalette
        activeColor={activeColor}
        onPick={(color) => {
          onPick(color);
          onClose();
        }}
        onClear={() => {
          onClear();
          onClose();
        }}
      />
    </div>
  );
}
