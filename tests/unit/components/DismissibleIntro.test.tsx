// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DismissibleIntro } from "@/components/DismissibleIntro";

describe("DismissibleIntro", () => {
  it("renders nothing on first paint when defaultDismissed is true", () => {
    const { container } = render(
      <DismissibleIntro id="read" defaultDismissed>hello</DismissibleIntro>
    );
    expect(container.firstChild).toBeNull();
  });
  it("renders the intro when not dismissed", () => {
    const { getByText } = render(<DismissibleIntro id="read">hello</DismissibleIntro>);
    expect(getByText("hello")).toBeTruthy();
  });
});
