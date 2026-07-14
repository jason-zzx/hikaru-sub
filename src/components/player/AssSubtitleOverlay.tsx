import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AssScriptInfo, AssStyle, SubtitleCue } from "@/lib/ass";
import { assStyleToCss, resolveAssRenderItems, type AssViewport } from "../../utils/assStyleCss";
import { AssStyledText } from "./AssStyledText";

interface AssSubtitleOverlayProps {
  cue: SubtitleCue;
  styles: AssStyle[];
  scriptInfo: AssScriptInfo | null;
  mergeMode: "inline" | "separate";
  className?: string;
  style?: CSSProperties;
}

const FALLBACK_VIEWPORT: AssViewport = { width: 1920, height: 1080 };

function viewportFromStyle(style?: CSSProperties): AssViewport | null {
  const width = typeof style?.width === "number" ? style.width : null;
  const height = typeof style?.height === "number" ? style.height : null;
  if (width && width > 0 && height && height > 0) {
    return { width, height };
  }
  return null;
}

function hasExplicitBounds(style?: CSSProperties): boolean {
  return viewportFromStyle(style) !== null;
}

export function AssSubtitleOverlay({
  cue,
  styles,
  scriptInfo,
  mergeMode,
  className,
  style,
}: AssSubtitleOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<AssViewport>(
    () => viewportFromStyle(style) ?? FALLBACK_VIEWPORT,
  );

  useEffect(() => {
    const element = overlayRef.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewport({ width: rect.width, height: rect.height });
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [style?.width, style?.height]);

  const items = resolveAssRenderItems(cue, styles, mergeMode);
  const bounded = hasExplicitBounds(style);
  const rootClassName =
    className ??
    (bounded
      ? "pointer-events-none absolute overflow-hidden"
      : "pointer-events-none absolute inset-0 overflow-hidden");
  const rootStyle: CSSProperties = bounded
    ? { right: "auto", bottom: "auto", ...style }
    : (style ?? {});

  return (
    <div ref={overlayRef} className={rootClassName} style={rootStyle}>
      {items.map((item) => (
        <div
          key={item.key}
          style={assStyleToCss(item.style, scriptInfo, viewport)}
        >
          <AssStyledText
            text={item.text}
            style={item.style}
            styles={styles}
            scriptInfo={scriptInfo}
            viewport={viewport}
          />
        </div>
      ))}
    </div>
  );
}
