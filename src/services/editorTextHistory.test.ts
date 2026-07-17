import { describe, expect, it } from "vitest";
import {
  TEXT_GROUP_IDLE_MS,
  canContinueTextGroup,
  classifyInputType,
  makeTextOp,
  nextTextGroup,
  type ActiveTextGroup,
  type TextSelection,
} from "./editorTextHistory";

const sel = (start: number, end = start): TextSelection => ({ start, end });

function op(
  partial: Partial<Parameters<typeof makeTextOp>[0]> & {
    before: TextSelection;
    after: TextSelection;
  },
) {
  return makeTextOp({
    cueId: "c1",
    inputType: "insertText",
    timestampMs: 1000,
    ...partial,
  });
}

describe("classifyInputType", () => {
  it("classifies insert/backspace/delete when collapsed", () => {
    expect(classifyInputType("insertText", sel(0))).toBe("insert");
    expect(classifyInputType("insertCompositionText", sel(2))).toBe("insert");
    expect(classifyInputType("deleteContentBackward", sel(3))).toBe("backspace");
    expect(classifyInputType("deleteContentForward", sel(3))).toBe("delete");
  });

  it("treats selection replacement and unknown/missing types as discrete", () => {
    expect(classifyInputType("insertText", sel(0, 3))).toBe("discrete");
    expect(classifyInputType("deleteContentBackward", sel(1, 4))).toBe("discrete");
    expect(classifyInputType("insertLineBreak", sel(0))).toBe("discrete");
    expect(classifyInputType("insertFromPaste", sel(0))).toBe("discrete");
    expect(classifyInputType("deleteByCut", sel(0, 2))).toBe("discrete");
    expect(classifyInputType("deleteWordBackward", sel(5))).toBe("discrete");
    expect(classifyInputType("insertReplacementText", sel(0))).toBe("discrete");
    expect(classifyInputType("insertFromDrop", sel(0))).toBe("discrete");
    expect(classifyInputType(null, sel(0))).toBe("discrete");
    expect(classifyInputType(undefined, sel(0))).toBe("discrete");
    expect(classifyInputType("historyUndo", sel(0))).toBe("discrete");
  });
});

describe("canContinueTextGroup / nextTextGroup", () => {
  it("coalesces adjacent insertions", () => {
    const first = op({ before: sel(0), after: sel(1), timestampMs: 1000 });
    const group = nextTextGroup(first)!;
    expect(group).toEqual({
      kind: "insert",
      cueId: "c1",
      caret: 1,
      lastTimestampMs: 1000,
    });

    const second = op({ before: sel(1), after: sel(2), timestampMs: 1100 });
    expect(canContinueTextGroup(group, second)).toBe(true);
    const g2 = nextTextGroup(second)!;
    expect(g2.caret).toBe(2);
  });

  it("coalesces consecutive backspaces by positional continuity", () => {
    // Multi-code-unit: delete 2 UTF-16 units at once (emoji), then one more.
    let group: ActiveTextGroup = {
      kind: "backspace",
      cueId: "c1",
      caret: 4,
      lastTimestampMs: 1000,
    };
    const b1 = op({
      inputType: "deleteContentBackward",
      before: sel(4),
      after: sel(2), // emoji removed
      timestampMs: 1050,
    });
    expect(canContinueTextGroup(group, b1)).toBe(true);
    group = nextTextGroup(b1)!;
    expect(group.caret).toBe(2);

    const b2 = op({
      inputType: "deleteContentBackward",
      before: sel(2),
      after: sel(1),
      timestampMs: 1100,
    });
    expect(canContinueTextGroup(group, b2)).toBe(true);
  });

  it("coalesces consecutive forward deletes at the same caret", () => {
    let group: ActiveTextGroup = {
      kind: "delete",
      cueId: "c1",
      caret: 2,
      lastTimestampMs: 1000,
    };
    const d1 = op({
      inputType: "deleteContentForward",
      before: sel(2),
      after: sel(2),
      timestampMs: 1050,
    });
    expect(canContinueTextGroup(group, d1)).toBe(true);
    group = nextTextGroup(d1)!;
    expect(group.caret).toBe(2);
  });

  it("starts a new group on operation type change", () => {
    const group: ActiveTextGroup = {
      kind: "insert",
      cueId: "c1",
      caret: 3,
      lastTimestampMs: 1000,
    };
    const del = op({
      inputType: "deleteContentBackward",
      before: sel(3),
      after: sel(2),
      timestampMs: 1100,
    });
    expect(canContinueTextGroup(group, del)).toBe(false);
  });

  it("starts a new group on non-contiguous positions", () => {
    const group: ActiveTextGroup = {
      kind: "insert",
      cueId: "c1",
      caret: 3,
      lastTimestampMs: 1000,
    };
    // Caret jumped away then typed
    const jumped = op({ before: sel(0), after: sel(1), timestampMs: 1100 });
    expect(canContinueTextGroup(group, jumped)).toBe(false);
  });

  it("rejects selection replacement, line break, paste, cut as discrete", () => {
    const group: ActiveTextGroup = {
      kind: "insert",
      cueId: "c1",
      caret: 0,
      lastTimestampMs: 1000,
    };
    for (const inputType of [
      "insertLineBreak",
      "insertFromPaste",
      "deleteByCut",
      "deleteWordBackward",
      "insertReplacementText",
      "insertFromDrop",
    ]) {
      const d = op({
        inputType,
        before: sel(0),
        after: sel(1),
        timestampMs: 1100,
      });
      expect(d.kind).toBe("discrete");
      expect(canContinueTextGroup(group, d)).toBe(false);
      expect(nextTextGroup(d)).toBeNull();
    }
  });

  it("rejects cue changes and idle boundary", () => {
    const group: ActiveTextGroup = {
      kind: "insert",
      cueId: "c1",
      caret: 1,
      lastTimestampMs: 1000,
    };
    const otherCue = op({
      cueId: "c2",
      before: sel(1),
      after: sel(2),
      timestampMs: 1100,
    });
    expect(canContinueTextGroup(group, otherCue)).toBe(false);

    const idle = op({
      before: sel(1),
      after: sel(2),
      timestampMs: 1000 + TEXT_GROUP_IDLE_MS,
    });
    expect(canContinueTextGroup(group, idle)).toBe(false);

    const almost = op({
      before: sel(1),
      after: sel(2),
      timestampMs: 1000 + TEXT_GROUP_IDLE_MS - 1,
    });
    expect(canContinueTextGroup(group, almost)).toBe(true);
  });

  it("returns false for null group and unknown input", () => {
    const o = op({ before: sel(0), after: sel(1), inputType: null });
    expect(o.kind).toBe("discrete");
    expect(canContinueTextGroup(null, o)).toBe(false);
  });
});
