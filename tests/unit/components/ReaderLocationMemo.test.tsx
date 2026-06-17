// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { ReaderLocationMemo } from "@/components/ReaderLocationMemo";

beforeEach(() => {
  document.cookie = "textlab-reader-last-passage=; max-age=0; path=/";
});

describe("ReaderLocationMemo", () => {
  it("writes the current passage to the last-passage cookie", () => {
    render(<ReaderLocationMemo book="Rom" chapter={5} />);
    expect(decodeURIComponent(document.cookie)).toContain('textlab-reader-last-passage={"book":"Rom","chapter":5}');
  });
});
