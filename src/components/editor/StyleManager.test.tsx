// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createDefaultStyles, type AssStyle } from "@/lib/ass";
import { useProjectStore } from "../../stores/projectStore";
import { useUiStore } from "../../stores/uiStore";
import { StyleManager } from "./StyleManager";

vi.mock("../../services/styleLibrary", () => ({
  loadStyleLibrary: vi.fn(),
  saveStyleLibrary: vi.fn(),
}));

vi.mock("../../hooks/usePreviewFontNames", () => ({
  usePreviewFontNames: () => ["Arial", "Noto Sans SC"],
}));

const { loadStyleLibrary, saveStyleLibrary } = await import(
  "../../services/styleLibrary"
);

function sample(overrides: Partial<AssStyle> = {}): AssStyle {
  return { ...createDefaultStyles()[0], ...overrides };
}

function openManager() {
  act(() => {
    if (!useUiStore.getState().styleManagerOpen) {
      useUiStore.getState().toggleStyleManager();
    }
  });
}

function closeManager() {
  act(() => {
    if (useUiStore.getState().styleManagerOpen) {
      useUiStore.getState().toggleStyleManager();
    }
  });
}

async function selectTab(label: string) {
  await userEvent.click(screen.getByRole("tab", { name: label }));
}

function expectDisabled(el: HTMLElement) {
  expect((el as HTMLButtonElement).disabled).toBe(true);
}

function expectEnabled(el: HTMLElement) {
  expect((el as HTMLButtonElement).disabled).toBe(false);
}

describe("StyleManager library integration", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(loadStyleLibrary).mockReset();
    vi.mocked(saveStyleLibrary).mockReset();
    vi.mocked(loadStyleLibrary).mockResolvedValue(createDefaultStyles());
    vi.mocked(saveStyleLibrary).mockResolvedValue(undefined);

    useProjectStore.setState({
      assStyles: createDefaultStyles(),
      cues: [],
      isDirty: false,
    } as never);
    useUiStore.setState({ styleManagerOpen: false });
  });

  afterEach(() => {
    cleanup();
    closeManager();
  });

  it("opens on Current Document within the existing drawer width", async () => {
    openManager();
    render(<StyleManager />);

    expect(
      screen.getByRole("tab", { name: "当前文档" }).getAttribute("data-state"),
    ).toBe("active");
    expect(document.querySelector("aside")?.className).toContain("w-[440px]");
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalledTimes(1));
  });

  it("keeps document non-name edits live and unconfirmed deletion", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await userEvent.click(screen.getByText("Primary"));
    const fontSize = screen.getByDisplayValue("54");
    fireEvent.change(fontSize, { target: { value: "60" } });

    expect(
      useProjectStore.getState().assStyles.find((s) => s.name === "Primary")
        ?.fontSize,
    ).toBe(60);

    await userEvent.click(screen.getByLabelText("删除样式 Primary"));
    expect(
      useProjectStore.getState().assStyles.some((s) => s.name === "Primary"),
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "删除样式" })).toBeNull();
  });

  it("does not flash a duplicate-name warning when switching document styles", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await userEvent.click(screen.getByText("Primary"));
    const warnings: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.textContent?.includes("样式名已存在")) {
            warnings.push("样式名已存在");
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    await userEvent.click(screen.getByText("Secondary"));
    await act(async () => {});
    observer.disconnect();

    expect(screen.getByDisplayValue("Secondary")).toBeTruthy();
    expect(warnings).toEqual([]);
  });

  it("loads library once and does not reload on close/reopen of mounted drawer", async () => {
    openManager();
    const { rerender } = render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalledTimes(1));

    closeManager();
    rerender(<StyleManager />);
    openManager();
    rerender(<StyleManager />);
    await act(async () => {});
    expect(loadStyleLibrary).toHaveBeenCalledTimes(1);
  });

  it("persists library field edits immediately", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    await userEvent.click(screen.getByText("Primary"));
    fireEvent.change(screen.getByDisplayValue("54"), {
      target: { value: "70" },
    });

    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalled());
    const saved = vi.mocked(saveStyleLibrary).mock.calls[0][0];
    expect(saved.find((s) => s.name === "Primary")?.fontSize).toBe(70);
    expectEnabled(screen.getByRole("button", { name: "添加到当前文档" }));
  });

  it("disables library editing while a live save is pending", async () => {
    let resolveSave!: () => void;
    vi.mocked(saveStyleLibrary).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    await userEvent.click(screen.getByText("Primary"));
    const initialFontSize = screen.getByDisplayValue("54");
    act(() => {
      fireEvent.change(initialFontSize, { target: { value: "70" } });
      fireEvent.change(initialFontSize, { target: { value: "71" } });
    });

    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalledTimes(1));
    const fontSize = screen.getByDisplayValue("70") as HTMLInputElement;
    const fieldset = fontSize.closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
    expectDisabled(screen.getByRole("button", { name: "添加到当前文档" }));
    const createButtons = screen.getAllByRole("button", { name: /新建样式/ });
    expectDisabled(createButtons[createButtons.length - 1]!);

    await selectTab("当前文档");
    await userEvent.click(screen.getByText("Primary"));
    fireEvent.change(screen.getByDisplayValue("54"), {
      target: { value: "60" },
    });
    expect(
      useProjectStore.getState().assStyles.find((style) => style.name === "Primary")
        ?.fontSize,
    ).toBe(60);

    resolveSave();
    await selectTab("样式库");
    await waitFor(() =>
      expect(
        (screen.getByDisplayValue("70").closest("fieldset") as HTMLFieldSetElement)
          .disabled,
      ).toBe(false),
    );
  });

  it("keeps UI values and shows alert after library save failure", async () => {
    vi.mocked(saveStyleLibrary).mockRejectedValueOnce(new Error("写盘失败"));
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    await userEvent.click(screen.getByText("Primary"));
    fireEvent.change(screen.getByDisplayValue("54"), {
      target: { value: "88" },
    });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("写盘失败"),
    );
    const fontSize = screen.getByDisplayValue("88");
    fireEvent.change(fontSize, { target: { value: "89" } });

    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalledTimes(2));
    const retried = vi.mocked(saveStyleLibrary).mock.calls[1][0];
    expect(retried.find((style) => style.name === "Primary")?.fontSize).toBe(89);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("disables document-to-library copy on load failure", async () => {
    vi.mocked(loadStyleLibrary).mockRejectedValueOnce(new Error("无法读取"));
    openManager();
    render(<StyleManager />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("无法读取"),
    );

    await userEvent.click(screen.getByText("Primary"));
    expectDisabled(screen.getByRole("button", { name: "保存到样式库" }));
    expect(saveStyleLibrary).not.toHaveBeenCalled();
  });

  it("copies document style into library with name-only overwrite", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await userEvent.click(screen.getByText("Primary"));
    fireEvent.change(screen.getByDisplayValue("54"), {
      target: { value: "61" },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存到样式库" }));

    expect(
      await screen.findByRole("button", { name: "覆盖样式" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "覆盖样式" }));
    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalled());
    const calls = vi.mocked(saveStyleLibrary).mock.calls;
    const saved = calls[calls.length - 1]?.[0] ?? [];
    expect(saved.find((s: AssStyle) => s.name === "Primary")?.fontSize).toBe(61);
  });

  it("cancels overwrite via Escape without writing", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await userEvent.click(screen.getByText("Primary"));
    await userEvent.click(screen.getByRole("button", { name: "保存到样式库" }));
    expect(
      await screen.findByRole("button", { name: "覆盖样式" }),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "覆盖样式" })).toBeNull(),
    );
    expect(saveStyleLibrary).not.toHaveBeenCalled();
  });

  it("adds library style to document without explicit save and overwrites by name", async () => {
    vi.mocked(loadStyleLibrary).mockResolvedValueOnce([
      sample({ name: "LibraryOnly", fontSize: 33 }),
      sample({ name: "Primary", fontSize: 12 }),
    ]);
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    await userEvent.click(screen.getByText("LibraryOnly"));
    await userEvent.click(
      screen.getByRole("button", { name: "添加到当前文档" }),
    );
    expect(
      useProjectStore.getState().assStyles.some((s) => s.name === "LibraryOnly"),
    ).toBe(true);

    await userEvent.click(screen.getByText("Primary"));
    await userEvent.click(
      screen.getByRole("button", { name: "添加到当前文档" }),
    );
    expect(
      await screen.findByRole("button", { name: "覆盖样式" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "覆盖样式" }));
    expect(
      useProjectStore.getState().assStyles.find((s) => s.name === "Primary")
        ?.fontSize,
    ).toBe(12);
  });

  it("copies the current library entry after a live field edit", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    await userEvent.click(screen.getByText("Secondary"));
    fireEvent.change(screen.getByDisplayValue("44"), {
      target: { value: "50" },
    });
    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalled());

    useProjectStore.getState().deleteStyle("Secondary");
    await userEvent.click(
      screen.getByRole("button", { name: "添加到当前文档" }),
    );
    expect(
      useProjectStore.getState().assStyles.find((s) => s.name === "Secondary")
        ?.fontSize,
    ).toBe(50);
  });

  it("does not prompt discard when switching styles/tabs/closing after edit", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    await userEvent.click(screen.getByText("Primary"));
    fireEvent.change(screen.getByDisplayValue("54"), {
      target: { value: "99" },
    });
    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalled());

    await userEvent.click(screen.getByText("Secondary"));
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
    expect(screen.getByDisplayValue("44")).toBeTruthy();

    await selectTab("当前文档");
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "当前文档" }).getAttribute("data-state"),
    ).toBe("active");

    await userEvent.click(screen.getByLabelText("关闭样式管理"));
    await waitFor(() =>
      expect(useUiStore.getState().styleManagerOpen).toBe(false),
    );
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull();
  });

  it("confirms library deletion and updates only after write success", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    await userEvent.click(screen.getByLabelText("删除样式 Secondary"));
    expect(
      await screen.findByRole("button", { name: "删除样式" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "删除样式" }));
    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalled());
    const calls = vi.mocked(saveStyleLibrary).mock.calls;
    const saved = calls[calls.length - 1]?.[0] ?? [];
    expect(saved.map((s: AssStyle) => s.name)).toEqual(["Primary"]);
  });

  it("shows document-to-library failure on Current Document tab", async () => {
    vi.mocked(loadStyleLibrary).mockResolvedValueOnce([
      sample({ name: "Other", fontSize: 10 }),
    ]);
    vi.mocked(saveStyleLibrary).mockRejectedValueOnce(new Error("保存失败"));
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await userEvent.click(screen.getByText("Primary"));
    await userEvent.click(screen.getByRole("button", { name: "保存到样式库" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("保存失败"),
    );
    expect(
      screen.getByRole("tab", { name: "当前文档" }).getAttribute("data-state"),
    ).toBe("active");
    fireEvent.change(screen.getByDisplayValue("54"), {
      target: { value: "55" },
    });
    expect(
      useProjectStore.getState().assStyles.find((s) => s.name === "Primary")
        ?.fontSize,
    ).toBe(55);
  });

  it("keeps loaded library when ASS document styles change", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    expect(screen.getByText("Primary")).toBeTruthy();

    act(() => {
      useProjectStore.setState({
        assStyles: [sample({ name: "OnlyDoc", fontSize: 20 })],
      } as never);
    });

    await selectTab("当前文档");
    expect(screen.getByText("OnlyDoc")).toBeTruthy();
    await selectTab("样式库");
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.queryByText("OnlyDoc")).toBeNull();
  });

  it("keeps an existing empty library empty", async () => {
    vi.mocked(loadStyleLibrary).mockResolvedValueOnce([]);
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());
    await selectTab("样式库");
    expect(screen.getByText("样式库为空")).toBeTruthy();
    expect(saveStyleLibrary).not.toHaveBeenCalled();
  });

  it("creates a library style immediately and rejects duplicate rename", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());
    await selectTab("样式库");

    const createButtons = screen.getAllByRole("button", { name: /新建样式/ });
    await userEvent.click(createButtons[createButtons.length - 1]!);
    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalled());
    const created = vi.mocked(saveStyleLibrary).mock.calls[0][0];
    expect(created.some((s) => s.name.startsWith("New Style"))).toBe(true);

    const nameInput = screen.getByDisplayValue(/New Style/);
    fireEvent.change(nameInput, { target: { value: "Primary" } });
    expect(screen.getByText("样式名已存在")).toBeTruthy();
    fireEvent.blur(nameInput);
    // Duplicate rename must not write again under the conflicting name.
    const callsAfterBlur = vi.mocked(saveStyleLibrary).mock.calls.length;
    expect(callsAfterBlur).toBe(1);
  });

  it("renames a library style on blur and persists", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());
    await selectTab("样式库");
    await userEvent.click(screen.getByText("Secondary"));

    const nameInput = screen.getByDisplayValue("Secondary");
    fireEvent.change(nameInput, { target: { value: "Alt Secondary" } });
    fireEvent.blur(nameInput);

    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalled());
    const calls = vi.mocked(saveStyleLibrary).mock.calls;
    const saved = calls[calls.length - 1]?.[0] ?? [];
    expect(saved.map((s: AssStyle) => s.name)).toEqual([
      "Primary",
      "Alt Secondary",
    ]);
    expect(screen.getByDisplayValue("Alt Secondary")).toBeTruthy();
  });

  it("refreshes selected library entry after document overwrite of that name", async () => {
    openManager();
    render(<StyleManager />);
    await waitFor(() => expect(loadStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    await userEvent.click(screen.getByText("Primary"));
    await selectTab("当前文档");
    await userEvent.click(screen.getByText("Primary"));
    fireEvent.change(screen.getByDisplayValue("54"), {
      target: { value: "77" },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存到样式库" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "覆盖样式" }),
    );
    await waitFor(() => expect(saveStyleLibrary).toHaveBeenCalled());

    await selectTab("样式库");
    expect(screen.getByDisplayValue("77")).toBeTruthy();
    expectEnabled(screen.getByRole("button", { name: "添加到当前文档" }));
  });
});
