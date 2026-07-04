export interface ToggleOverrideTag {
  startTag: string;
  endTag: string;
}

export interface ToggleOverrideResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function commandName(tag: string): string {
  const match = tag.match(/\\([A-Za-z]+)/);
  return match?.[1] ?? "";
}

function isCommandOpenBeforeCursor(text: string, tag: ToggleOverrideTag): boolean {
  const command = commandName(tag.startTag);
  if (!command) return false;

  const pattern = new RegExp(
    `\\{[^}]*\\\\${escapeRegExp(command)}([01])[^}]*\\}`,
    "g",
  );
  let open = false;
  for (const match of text.matchAll(pattern)) {
    open = match[1] === "1";
  }
  return open;
}

export function applyToggleOverrideTag(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  tag: ToggleOverrideTag,
): ToggleOverrideResult {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));

  if (start !== end) {
    const nextText =
      text.slice(0, start) +
      tag.startTag +
      text.slice(start, end) +
      tag.endTag +
      text.slice(end);
    const nextCursor = end + tag.startTag.length + tag.endTag.length;
    return {
      text: nextText,
      selectionStart: nextCursor,
      selectionEnd: nextCursor,
    };
  }

  const nextTag = isCommandOpenBeforeCursor(text.slice(0, start), tag)
    ? tag.endTag
    : tag.startTag;
  const nextText = text.slice(0, start) + nextTag + text.slice(start);
  const nextCursor = start + nextTag.length;
  return {
    text: nextText,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}
