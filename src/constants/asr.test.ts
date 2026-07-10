import { describe, expect, it } from "vitest";
import {
  ASR_ENGINE_MODELS,
  ASR_ENGINE_OPTIONS,
  KOTOBA_FASTER_WHISPER_DESCRIPTION,
  asrModelOptions,
  defaultAsrModel,
} from "./asr";

const ENGINE = "kotoba-faster-whisper";
const MODEL = "kotoba-tech/kotoba-whisper-v2.0-faster";

describe("kotoba-faster-whisper constants", () => {
  it("registers a separately displayed engine", () => {
    expect(ASR_ENGINE_OPTIONS).toContainEqual({
      value: ENGINE,
      label: ENGINE,
    });
  });

  it("exposes only the supported official model", () => {
    expect(ASR_ENGINE_MODELS[ENGINE]).toEqual([
      {
        value: MODEL,
        label: "kotoba-whisper-v2.0-faster",
      },
    ]);
    expect(asrModelOptions(ENGINE)).toEqual(ASR_ENGINE_MODELS[ENGINE]);
    expect(defaultAsrModel(ENGINE)).toBe(MODEL);
  });

  it("defines the approved description", () => {
    expect(KOTOBA_FASTER_WHISPER_DESCRIPTION).toBe(
      "基于 faster-whisper 的日语优化模型",
    );
  });
});
