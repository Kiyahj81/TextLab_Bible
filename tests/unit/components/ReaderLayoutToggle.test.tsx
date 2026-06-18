// tests/unit/components/ReaderLayoutToggle.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ReaderLayoutToggle } from "@/components/ReaderLayoutToggle";

describe("ReaderLayoutToggle", () => {
  afterEach(() => { cleanup(); });

  it("disables Continuous when continuousDisabled is set", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <ReaderLayoutToggle layout="study" onChange={onChange} continuousDisabled />
    );
    const cont = getByRole("radio", { name: "Continuous" });
    expect((cont as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(cont);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("fires onChange when an enabled option is clicked", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<ReaderLayoutToggle layout="study" onChange={onChange} />);
    fireEvent.click(getByRole("radio", { name: "Continuous" }));
    expect(onChange).toHaveBeenCalledWith("continuous");
  });
});
