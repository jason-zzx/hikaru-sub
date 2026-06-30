const LIBASS_CANVAS_CLASS =
  "absolute inset-0 h-full w-full pointer-events-none";

export function createFreshLibassCanvas(
  host: HTMLElement,
  createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): HTMLCanvasElement {
  const canvas = createCanvas();
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = LIBASS_CANVAS_CLASS;
  host.replaceChildren(canvas);
  return canvas;
}
