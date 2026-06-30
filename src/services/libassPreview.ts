import JASSUB from "jassub";
import workerUrl from "jassub/dist/worker/worker.js?url";
import modernWasmUrl from "jassub/dist/wasm/jassub-worker-modern.wasm?url";
import wasmUrl from "jassub/dist/wasm/jassub-worker.wasm?url";

type MaybePromise<T> = T | Promise<T>;

type JassubRenderer = {
  setTrack?: (assText: string) => MaybePromise<void>;
};

type JassubRenderMetadata = {
  expectedDisplayTime: number;
  width: number;
  height: number;
  mediaTime: number;
};

type JassubInstance = {
  ready: Promise<void>;
  renderer?: JassubRenderer;
  manualRender?: (
    data: JassubRenderMetadata,
    repaint?: boolean,
  ) => MaybePromise<void>;
  resize: (
    forceRepaint?: boolean,
    renderWidth?: number,
    renderHeight?: number,
  ) => MaybePromise<void>;
  destroy: () => MaybePromise<void>;
};

type JassubConstructor = new (options: Record<string, unknown>) => JassubInstance;

interface CreateLibassControllerArgs {
  Renderer: JassubConstructor;
  canvas: HTMLCanvasElement;
  assText: string;
  fontUrls: string[];
  defaultFont?: string;
  workerUrl: string;
  wasmUrl: string;
  modernWasmUrl: string;
}

export interface CreateDefaultLibassControllerArgs {
  canvas: HTMLCanvasElement;
  assText: string;
  fontUrls: string[];
  defaultFont?: string;
}

export interface LibassController {
  setAssText: (assText: string) => Promise<void>;
  render: (timeMs: number, width: number, height: number) => Promise<void>;
  resize: (width: number, height: number) => Promise<void>;
  destroy: () => Promise<void>;
}

export async function createLibassController({
  Renderer,
  canvas,
  assText,
  fontUrls,
  defaultFont,
  workerUrl,
  wasmUrl,
  modernWasmUrl,
}: CreateLibassControllerArgs): Promise<LibassController> {
  const instance = new Renderer({
    canvas,
    subContent: assText,
    fonts: fontUrls,
    defaultFont,
    workerUrl,
    wasmUrl,
    modernWasmUrl,
    queryFonts: false,
  });

  await instance.ready;

  return {
    async setAssText(nextAssText) {
      if (!instance.renderer?.setTrack) {
        throw new Error("jASSUB renderer does not support setTrack");
      }
      await instance.renderer.setTrack(nextAssText);
    },
    async render(timeMs, width, height) {
      if (!instance.manualRender) {
        throw new Error("jASSUB renderer does not support manualRender");
      }
      await instance.manualRender(
        {
          expectedDisplayTime:
            typeof performance !== "undefined" ? performance.now() : Date.now(),
          mediaTime: timeMs / 1000,
          width,
          height,
        },
        true,
      );
    },
    async resize(width, height) {
      await instance.resize(true, width, height);
    },
    async destroy() {
      await instance.destroy();
    },
  };
}

export function createDefaultLibassController(
  args: CreateDefaultLibassControllerArgs,
): Promise<LibassController> {
  return createLibassController({
    ...args,
    Renderer: JASSUB as unknown as JassubConstructor,
    workerUrl,
    wasmUrl,
    modernWasmUrl,
  });
}
