import { describe, expect, it } from "vitest";
import { createFreshLibassCanvas } from "./libassCanvas";

class FakeCanvas {
  className = "";
  attributes = new Map<string, string>();
  parentNode: FakeHost | null = null;

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

class FakeHost {
  children: FakeCanvas[] = [];

  replaceChildren(...children: FakeCanvas[]) {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children = children;
    for (const child of children) {
      child.parentNode = this;
    }
  }
}

describe("createFreshLibassCanvas", () => {
  it("creates a new canvas for every libass renderer setup", () => {
    const host = new FakeHost();
    const canvases: FakeCanvas[] = [];
    const createCanvas = () => {
      const canvas = new FakeCanvas();
      canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    };

    const first = createFreshLibassCanvas(
      host as unknown as HTMLElement,
      createCanvas,
    );
    const second = createFreshLibassCanvas(
      host as unknown as HTMLElement,
      createCanvas,
    );

    expect(second).not.toBe(first);
    expect(host.children).toEqual([second]);
    expect((first as unknown as FakeCanvas).parentNode).toBeNull();
    expect((second as unknown as FakeCanvas).attributes.get("aria-hidden")).toBe(
      "true",
    );
    expect((second as unknown as FakeCanvas).className).toBe(
      "absolute inset-0 h-full w-full pointer-events-none",
    );
  });
});
