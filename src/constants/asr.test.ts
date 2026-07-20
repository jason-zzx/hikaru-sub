import { describe, expect, it } from "vitest";
import {
  ASR_ENGINE_MODELS,
  ASR_ENGINE_OPTIONS,
  KOTOBA_FASTER_WHISPER_DESCRIPTION,
  REAZONSPEECH_NEMO_DESCRIPTION,
  asrModelOptions,
  defaultAsrModel,
} from "./asr";

const KOTOBA_ENGINE = "kotoba-faster-whisper";
const KOTOBA_MODEL = "kotoba-tech/kotoba-whisper-v2.0-faster";
const REAZON_ENGINE = "reazonspeech-nemo";
const REAZON_MODEL = "reazon-research/reazonspeech-nemo-v2";

describe("kotoba-faster-whisper constants", () => {
  it("registers a separately displayed engine", () => {
    expect(ASR_ENGINE_OPTIONS).toContainEqual({
      value: KOTOBA_ENGINE,
      label: KOTOBA_ENGINE,
    });
  });

  it("exposes only the supported official model", () => {
    expect(ASR_ENGINE_MODELS[KOTOBA_ENGINE]).toEqual([
      {
        value: KOTOBA_MODEL,
        label: "kotoba-whisper-v2.0-faster",
      },
    ]);
    expect(asrModelOptions(KOTOBA_ENGINE)).toEqual(ASR_ENGINE_MODELS[KOTOBA_ENGINE]);
    expect(defaultAsrModel(KOTOBA_ENGINE)).toBe(KOTOBA_MODEL);
  });

  it("defines the approved description", () => {
    expect(KOTOBA_FASTER_WHISPER_DESCRIPTION).toBe(
      "基于 faster-whisper 的日语优化模型",
    );
  });
});

describe("faster-whisper models", () => {
  it("includes large-v3-turbo without changing the large-v3 default", () => {
    const values = ASR_ENGINE_MODELS["faster-whisper"].map((m) => m.value);
    expect(values).toContain("large-v3-turbo");
    expect(values).toContain("large-v3");
    expect(defaultAsrModel("faster-whisper")).toBe("large-v3");
  });
});

describe("reazonspeech-nemo constants", () => {
  it("registers the engine and sole official model", () => {
    expect(ASR_ENGINE_OPTIONS).toContainEqual({
      value: REAZON_ENGINE,
      label: "ReazonSpeech NeMo",
    });
    expect(ASR_ENGINE_MODELS[REAZON_ENGINE]).toEqual([
      {
        value: REAZON_MODEL,
        label: "reazonspeech-nemo-v2",
      },
    ]);
    expect(defaultAsrModel(REAZON_ENGINE)).toBe(REAZON_MODEL);
    expect(REAZONSPEECH_NEMO_DESCRIPTION).toContain("原生整段推理");
  });
});
