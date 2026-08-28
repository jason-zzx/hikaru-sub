// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./select-adapter";

afterEach(cleanup);

describe("Select adapter unavailable values", () => {
  it("keeps a disabled persisted option visible without changing it", () => {
    const onChange = vi.fn();
    render(
      <Select
        value="qwen3-asr"
        onChange={onChange}
        options={[
          { value: "faster-whisper", label: "faster-whisper" },
          {
            value: "qwen3-asr",
            label: "qwen3（该引擎将在后续版本支持）",
            disabled: true,
          },
        ]}
      />,
    );

    expect(screen.getByRole("combobox").textContent).toContain("qwen3");
    expect(screen.getByRole("combobox").textContent).toContain("后续版本支持");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows an unknown persisted value instead of normalizing it", () => {
    const onChange = vi.fn();
    render(
      <Select
        value="legacy-device"
        onChange={onChange}
        options={[{ value: "cpu", label: "CPU" }]}
      />,
    );

    expect(screen.getByRole("combobox").textContent).toContain("legacy-device");
    expect(onChange).not.toHaveBeenCalled();
  });
});
