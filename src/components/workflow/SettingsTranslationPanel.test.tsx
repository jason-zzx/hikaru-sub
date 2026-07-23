// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings } from "@/types";
import { SettingsTranslationPanel } from "./SettingsTranslationPanel";

const baseSettings: AppSettings = {
  asrEngine: "faster-whisper",
  asrModel: "synthetic",
  asrDevice: "cpu",
  translationProviders: [],
  defaultSourceLang: "ja",
  defaultTargetLang: "zh-CN",
  translationBatchSize: 25,
  translationContextWindow: 2,
  subtitleMergeMode: "inline",
  subtitleTextOrder: "translation-first",
  editorHotkeys: [],
};

const update = <K extends keyof AppSettings>(
  _key: K,
  _value: AppSettings[K],
) => undefined;

afterEach(cleanup);

describe("SettingsTranslationPanel", () => {
  it("shows order only for supported merge modes", () => {
    const { rerender } = render(
      <SettingsTranslationPanel settings={baseSettings} update={update} />,
    );

    expect(screen.getByText("原文/译文顺序")).toBeTruthy();

    rerender(
      <SettingsTranslationPanel
        settings={{ ...baseSettings, subtitleMergeMode: "separate" }}
        update={update}
      />,
    );
    expect(screen.getByText("原文/译文顺序")).toBeTruthy();

    rerender(
      <SettingsTranslationPanel
        settings={{ ...baseSettings, subtitleMergeMode: "translation-only" }}
        update={update}
      />,
    );
    expect(screen.queryByText("原文/译文顺序")).toBeNull();
  });
});
