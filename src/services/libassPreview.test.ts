import { describe, expect, it, vi } from "vitest";
import {
  createDefaultLibassController,
  createLibassController,
} from "./libassPreview";

const jassubMock = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  destroy: vi.fn(),
  resize: vi.fn(),
  setTrack: vi.fn(),
}));

vi.mock("jassub", () => {
  class FakeJassub {
    ready = Promise.resolve();
    renderer = { setTrack: jassubMock.setTrack };
    resize = jassubMock.resize;
    destroy = jassubMock.destroy;

    constructor(options: Record<string, unknown>) {
      jassubMock.calls.push(options);
    }
  }

  return { default: FakeJassub };
});

describe("createLibassController", () => {
  it("creates, updates, resizes, and destroys a JASSUB-backed renderer", async () => {
    const setTrack = vi.fn();
    const manualRender = vi.fn();
    const resize = vi.fn();
    const destroy = vi.fn();
    const calls: Array<Record<string, unknown>> = [];

    class FakeRenderer {
      ready = Promise.resolve();
      renderer = { setTrack };
      manualRender = manualRender;
      resize = resize;
      destroy = destroy;

      constructor(options: Record<string, unknown>) {
        calls.push(options);
      }
    }

    const canvas = {} as HTMLCanvasElement;
    const controller = await createLibassController({
      Renderer: FakeRenderer,
      canvas,
      assText: "[Script Info]\nTitle: Test",
      fontUrls: ["http://127.0.0.1/font.ttf"],
      availableFonts: {
        ".苹方-简": "http://127.0.0.1/font.ttf",
      },
      defaultFont: "Noto Sans SC",
      workerUrl: "/worker.js",
      wasmUrl: "/worker.wasm",
      modernWasmUrl: "/worker-modern.wasm",
    });

    expect(calls[0]).toEqual(
      expect.objectContaining({
        canvas,
        subContent: "[Script Info]\nTitle: Test",
        fonts: ["http://127.0.0.1/font.ttf"],
        availableFonts: {
          ".苹方-简": "http://127.0.0.1/font.ttf",
        },
        defaultFont: "Noto Sans SC",
        workerUrl: "/worker.js",
        wasmUrl: "/worker.wasm",
        modernWasmUrl: "/worker-modern.wasm",
        queryFonts: false,
      }),
    );

    await controller.setAssText("[Script Info]\nTitle: Updated");
    expect(setTrack).toHaveBeenCalledWith("[Script Info]\nTitle: Updated");

    await controller.resize(640, 360);
    expect(resize).toHaveBeenCalledWith(true, 640, 360);

    await controller.render(1234, 640, 360);
    expect(manualRender).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaTime: 1.234,
        width: 640,
        height: 360,
      }),
      true,
    );

    await controller.destroy();
    expect(destroy).toHaveBeenCalled();
  });

  it("loads the default JASSUB renderer through Vite dependency handling", async () => {
    jassubMock.calls.length = 0;
    jassubMock.resize.mockClear();
    jassubMock.destroy.mockClear();

    const canvas = {} as HTMLCanvasElement;
    const controller = await createDefaultLibassController({
      canvas,
      assText: "[Script Info]\nTitle: Default",
      fontUrls: ["http://127.0.0.1/font.ttf"],
      availableFonts: {
        "Custom Font": "http://127.0.0.1/font.ttf",
      },
    });

    expect(jassubMock.calls[0]).toEqual(
      expect.objectContaining({
        canvas,
        subContent: "[Script Info]\nTitle: Default",
        fonts: ["http://127.0.0.1/font.ttf"],
        availableFonts: {
          "Custom Font": "http://127.0.0.1/font.ttf",
        },
        queryFonts: false,
      }),
    );
    expect(jassubMock.calls[0]?.workerUrl).toEqual(expect.any(String));
    expect(jassubMock.calls[0]?.wasmUrl).toEqual(expect.any(String));
    expect(jassubMock.calls[0]?.modernWasmUrl).toEqual(expect.any(String));

    await controller.destroy();
    expect(jassubMock.destroy).toHaveBeenCalled();
  });
});
