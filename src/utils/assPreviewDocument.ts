import {
  serializeAss,
  type AssScriptInfo,
  type AssStyle,
  type SubtitleCue,
} from "@hikaru/ass-core";
import { resolveAssDocumentForSave } from "./assDocument";

interface BuildPreviewAssTextArgs {
  cues: SubtitleCue[];
  styles: AssStyle[];
  scriptInfo: AssScriptInfo | null;
  mergeMode: "inline" | "separate";
}

export function buildPreviewAssText({
  cues,
  styles,
  scriptInfo,
  mergeMode,
}: BuildPreviewAssTextArgs): string {
  const doc = resolveAssDocumentForSave(cues, scriptInfo, styles);
  return serializeAss(doc, { mergeMode });
}
