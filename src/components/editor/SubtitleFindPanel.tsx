import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { usePlaybackStore } from "../../stores/playbackStore";
import { useProjectStore } from "../../stores/projectStore";
import {
  applyReplace,
  collectMatches,
  findAdjacentMatch,
  replaceInCues,
  type SubtitleFilters,
} from "../../utils/subtitleSearch";
import { runQcChecks, type QcRule } from "../../utils/subtitleQc";
import {
  formatTimeInput,
  parseTimeInput,
  TIME_INPUT_TEMPLATE,
} from "../../utils/timeInput";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select-adapter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import type { EditorToastVariant } from "./EditorToast";

export interface SubtitleFindPanelHandle {
  openAndFocus: () => void;
}

interface SubtitleFindPanelProps {
  onNotify?: (variant: EditorToastVariant, text: string) => void;
}

export const SubtitleFindPanel = forwardRef<
  SubtitleFindPanelHandle,
  SubtitleFindPanelProps
>(function SubtitleFindPanel({ onNotify }, ref) {
  const cues = useProjectStore((s) => s.cues);
  const assStyles = useProjectStore((s) => s.assStyles);
  const updateCue = useProjectStore((s) => s.updateCue);
  const replaceCues = useProjectStore((s) => s.replaceCues);
  const selectedCueId = usePlaybackStore((s) => s.selectedCueId);
  const setSelectedCueId = usePlaybackStore((s) => s.setSelectedCueId);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const durationMs = usePlaybackStore((s) => s.durationMs);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("find");
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  /** "__all__" = no style filter (Radix Select forbids empty value). */
  const [style, setStyle] = useState("__all__");
  const [emptyOnly, setEmptyOnly] = useState(false);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const queryRef = useRef<HTMLInputElement>(null);

  // 任何路径打开都聚焦查找输入框，让 Esc 由卡片捕获
  const openAndFocusPanel = () => {
    setOpen(true);
    setTab("find");
    requestAnimationFrame(() => queryRef.current?.focus());
  };

  useImperativeHandle(ref, () => ({
    openAndFocus: openAndFocusPanel,
  }));

  const filters = useMemo((): SubtitleFilters => {
    const timeRange: SubtitleFilters["timeRange"] = {};
    const start = startText.trim() ? parseTimeInput(startText) : null;
    const end = endText.trim() ? parseTimeInput(endText) : null;
    if (start?.ok) timeRange.startMs = start.valueMs;
    if (end?.ok) timeRange.endMs = end.valueMs;
    return {
      style: style !== "__all__" ? style : undefined,
      emptyOnly: emptyOnly || undefined,
      timeRange:
        timeRange.startMs !== undefined || timeRange.endMs !== undefined
          ? timeRange
          : undefined,
    };
  }, [style, emptyOnly, startText, endText]);

  const matchIds = useMemo(
    () => collectMatches(cues, query, filters),
    [cues, query, filters],
  );

  const styleOptions = useMemo(() => {
    const names = new Set<string>();
    for (const s of assStyles) names.add(s.name);
    for (const c of cues) if (c.style) names.add(c.style);
    return [
      { value: "__all__", label: "全部样式" },
      ...[...names].sort().map((name) => ({ value: name, label: name })),
    ];
  }, [assStyles, cues]);

  const qcIssues = useMemo(
    () =>
      runQcChecks(cues, {
        durationMs,
        knownStyles: assStyles.map((s) => s.name),
      }),
    [cues, durationMs, assStyles],
  );

  const locate = (cueId: string | null) => {
    if (!cueId) {
      onNotify?.("info", "无匹配项");
      return;
    }
    setSelectedCueId(cueId);
    // 与 SubtitleList 选中行为一致：定位同时移动播放头
    const cue = cues.find((c) => c.id === cueId);
    if (cue) setCurrentTime(cue.startMs);
  };

  const goAdjacent = (dir: 1 | -1) => {
    locate(findAdjacentMatch(matchIds, selectedCueId, dir));
  };

  const replaceCurrent = () => {
    const q = query.trim();
    if (!q) {
      onNotify?.("info", "请输入查找内容");
      return;
    }
    const id =
      selectedCueId && matchIds.includes(selectedCueId)
        ? selectedCueId
        : findAdjacentMatch(matchIds, selectedCueId, 1);
    if (!id) {
      onNotify?.("info", "无匹配项");
      return;
    }
    const cue = cues.find((c) => c.id === id);
    if (!cue) return;
    const primaryText = applyReplace(cue.primaryText, q, replaceText);
    if (primaryText === cue.primaryText) {
      onNotify?.("info", "当前行无需替换");
      return;
    }
    updateCue(id, { primaryText });
    setSelectedCueId(id);
  };

  const replaceAll = () => {
    const q = query.trim();
    if (!q) {
      onNotify?.("info", "请输入查找内容");
      return;
    }
    if (matchIds.length === 0) {
      onNotify?.("info", "无匹配项");
      return;
    }
    const next = replaceInCues(cues, matchIds, q, replaceText);
    if (next === cues) {
      onNotify?.("info", "无需替换");
      return;
    }
    replaceCues(next);
    onNotify?.("success", `已替换 ${matchIds.length} 处`);
  };

  const onQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      goAdjacent(e.shiftKey ? -1 : 1);
    }
  };

  const blurNormalizeTime = (field: "start" | "end") => {
    const text = field === "start" ? startText : endText;
    if (!text.trim()) return;
    const parsed = parseTimeInput(text);
    if (parsed.ok) {
      const normalized = formatTimeInput(parsed.valueMs);
      if (field === "start") setStartText(normalized);
      else setEndText(normalized);
    }
  };

  // Esc / 点卡片头栏收起；不回移焦点（避免头栏亮起 focus 环）
  const closePanel = () => setOpen(false);

  return (
    <div className="relative h-7 shrink-0 border-b border-border">
      <div
        className={
          open ? "absolute inset-x-0 top-0 z-20 py-1 pl-1 pr-2" : ""
        }
        onKeyDown={(e) => {
          if (open && e.key === "Escape") {
            e.stopPropagation();
            closePanel();
          }
        }}
      >
        <div
          className={
            open
              ? "flex max-h-[min(60vh,480px)] flex-col overflow-hidden rounded-lg border border-border bg-popover/80 shadow-xl backdrop-blur-sm ring-1 ring-foreground/10"
              : ""
          }
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start rounded-none px-3 text-left text-xs font-normal text-text-muted hover:bg-muted/40"
            onClick={(e) => {
              if (open) e.currentTarget.blur();
              open ? closePanel() : openAndFocusPanel();
            }}
            aria-expanded={open}
          >
            <Search className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium uppercase tracking-wider">
              查找 / 质检
              {qcIssues.length > 0 ? ` · ${qcIssues.length}` : ""}
            </span>
            {open ? (
              <ChevronUp className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" aria-hidden />
            )}
          </Button>

          {open && (
            <div className="min-h-0 overflow-y-auto border-t border-border px-3 pb-2 pt-1.5">
              <Tabs value={tab} onValueChange={setTab} className="min-w-0 w-full flex-col">
            <TabsList className="h-7 w-full">
              <TabsTrigger value="find" className="flex-1 text-xs">
                查找替换
              </TabsTrigger>
              <TabsTrigger value="qc" className="flex-1 text-xs">
                质检 ({qcIssues.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="find" className="mt-2 min-w-0 space-y-2.5">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="space-y-1">
                  <Label className="text-xs text-text-muted">查找</Label>
                  <Input
                    ref={queryRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onQueryKeyDown}
                    placeholder="查找内容…"
                    className="h-8 w-full min-w-0 text-sm"
                    aria-label="查找内容"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-text-muted">替换为</Label>
                  <Input
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                    placeholder="替换为…"
                    className="h-8 w-full min-w-0 text-sm"
                    aria-label="替换为"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-text-muted">样式</Label>
                <Select
                  value={style}
                  onChange={setStyle}
                  options={styleOptions}
                  className="h-8 w-full min-w-0 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-text-muted">
                <Checkbox
                  checked={emptyOnly}
                  onCheckedChange={(v) => setEmptyOnly(v === true)}
                  aria-label="仅空文本"
                />
                仅空文本
              </label>

              <div className="grid grid-cols-2 gap-1.5">
                <div className="space-y-1">
                  <Label className="text-xs text-text-muted">时间起</Label>
                  <Input
                    value={startText}
                    onChange={(e) => setStartText(e.target.value)}
                    onBlur={() => blurNormalizeTime("start")}
                    placeholder={TIME_INPUT_TEMPLATE}
                    inputMode="numeric"
                    className="h-8 w-full min-w-0 font-mono text-sm"
                    aria-label="筛选开始时间"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-text-muted">时间止</Label>
                  <Input
                    value={endText}
                    onChange={(e) => setEndText(e.target.value)}
                    onBlur={() => blurNormalizeTime("end")}
                    placeholder={TIME_INPUT_TEMPLATE}
                    inputMode="numeric"
                    className="h-8 w-full min-w-0 font-mono text-sm"
                    aria-label="筛选结束时间"
                  />
                </div>
              </div>

              <p className="text-[11px] leading-snug text-text-muted">
                命中 {matchIds.length} 处
                {query.trim() ? "" : "（无关键词时为筛选结果）"}
              </p>

              <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => goAdjacent(-1)}
                  >
                    上一处
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => goAdjacent(1)}
                  >
                    下一处
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={replaceCurrent}
                  >
                    替换当前
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 min-w-0 px-2 text-xs"
                    onClick={replaceAll}
                  >
                    <span className="truncate">
                      全部替换
                      {matchIds.length > 0 && query.trim()
                        ? ` (${matchIds.length})`
                        : ""}
                    </span>
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="qc" className="mt-2 min-w-0">
              {qcIssues.length === 0 ? (
                <p className="py-4 text-center text-xs text-text-muted">
                  未发现问题
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {qcIssues.map((issue, i) => (
                    <li key={`${issue.cueId}-${issue.rule}-${i}`}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto w-full items-start justify-start whitespace-normal rounded px-1.5 py-1.5 text-left text-xs font-normal leading-snug text-warning hover:bg-muted/50"
                        onClick={() => locate(issue.cueId)}
                      >
                        <span className="text-text-muted">
                          {QC_RULE_LABELS[issue.rule]}
                        </span>{" "}
                        <span className="break-words">{issue.message}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const QC_RULE_LABELS: Record<QcRule, string> = {
  empty: "空字幕",
  "bad-timing": "时间",
  "beyond-duration": "超时长",
  overlap: "重叠",
  "high-cps": "CPS",
  "long-line": "过长",
  "many-lines": "多行",
  "unknown-style": "样式",
};
