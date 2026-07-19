/** Compare dotted versions (optional leading `v`, ignore pre-release/+build). */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string): number[] => {
    const core = value.trim().replace(/^v/i, "").split(/[-+]/)[0] ?? "";
    return core.split(".").map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  };

  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const lv = left[i] ?? 0;
    const rv = right[i] ?? 0;
    if (lv !== rv) return lv < rv ? -1 : 1;
  }
  return 0;
}
