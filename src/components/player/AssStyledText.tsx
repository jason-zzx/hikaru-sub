import { useMemo } from "react";
import {
  parseAssTextLines,
  type AssScriptInfo,
  type AssStyle,
} from "@hikaru/ass-core";
import { findAssStyle } from "../../utils/assStyleCss";
import { assInlineToCss } from "../../utils/assRunCss";
import type { AssViewport } from "../../utils/assStyleCss";

interface AssStyledTextProps {
  text: string;
  style: AssStyle;
  styles: AssStyle[];
  scriptInfo: AssScriptInfo | null;
  viewport: AssViewport;
}

export function AssStyledText({
  text,
  style,
  styles,
  scriptInfo,
  viewport,
}: AssStyledTextProps) {
  const lines = useMemo(
    () =>
      parseAssTextLines(text, style, {
        resolveStyle: (name) => findAssStyle(styles, name),
      }),
    [text, style, styles],
  );

  if (lines.length === 0) return null;

  return (
    <>
      {lines.map((line, lineIndex) => (
        <div key={lineIndex}>
          {line.runs.map((run, runIndex) => (
            <span
              key={runIndex}
              style={assInlineToCss(run.style, run.inline, scriptInfo, viewport)}
            >
              {run.text}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}
