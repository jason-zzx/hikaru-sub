import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import {
  assColorToCss,
  createDefaultStyles,
  type AssStyle,
} from "@/lib/ass";
import { usePreviewFontNames } from "../../hooks/usePreviewFontNames";
import {
  loadStyleLibrary,
  saveStyleLibrary,
} from "../../services/styleLibrary";
import { useProjectStore } from "../../stores/projectStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select-adapter";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ColorPicker } from "./ColorPicker";
import { FontComboBox } from "./FontComboBox";
import { COMMON_SUBTITLE_FONTS } from "../../utils/fontFamilyAliases";

const COMMON_FONTS = [...COMMON_SUBTITLE_FONTS, "SimHei"];

const ASS_ENCODING_OPTIONS = [
  { value: 0, label: "0 - ANSI" },
  { value: 1, label: "1 - 默认" },
  { value: 2, label: "2 - Symbol" },
  { value: 77, label: "77 - Macintosh" },
  { value: 128, label: "128 - Shift-JIS（日文）" },
  { value: 129, label: "129 - Hangul（韩文）" },
  { value: 130, label: "130 - Johab（韩文）" },
  { value: 134, label: "134 - GB2312（简体中文）" },
  { value: 136, label: "136 - Big5（繁体中文）" },
  { value: 161, label: "161 - Greek" },
  { value: 162, label: "162 - Turkish" },
  { value: 163, label: "163 - Vietnamese" },
  { value: 177, label: "177 - Hebrew" },
  { value: 178, label: "178 - Arabic" },
  { value: 186, label: "186 - Baltic" },
  { value: 204, label: "204 - Cyrillic/Russian" },
  { value: 222, label: "222 - Thai" },
  { value: 238, label: "238 - East European" },
  { value: 255, label: "255 - OEM" },
];

type StyleTab = "current" | "library";
type LibraryLoadState = "idle" | "loading" | "ready" | "error";

type PendingDialog =
  | { kind: "doc-rename"; oldName: string; proposedName: string; referencingCueCount: number }
  | { kind: "overwrite-to-library"; style: AssStyle }
  | { kind: "overwrite-to-document"; style: AssStyle }
  | { kind: "delete-library"; name: string };

function uniqueStyleName(styles: AssStyle[], base = "New Style"): string {
  const names = new Set(styles.map((style) => style.name));
  if (!names.has(base)) return base;
  let index = 1;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasNameConflict(
  styles: AssStyle[],
  name: string,
  currentName: string | null,
): boolean {
  const normalized = name.trim();
  return styles.some(
    (style) => style.name === normalized && style.name !== currentName,
  );
}

function styleSwatch(style: AssStyle) {
  return { backgroundColor: assColorToCss(style.primaryColor) };
}

export function StyleManager() {
  const open = useUiStore((state) => state.styleManagerOpen);
  const toggleStyleManager = useUiStore((state) => state.toggleStyleManager);
  const assStyles = useProjectStore((state) => state.assStyles);
  const addStyle = useProjectStore((state) => state.addStyle);
  const updateStyle = useProjectStore((state) => state.updateStyle);
  const deleteStyle = useProjectStore((state) => state.deleteStyle);
  const renameStyle = useProjectStore((state) => state.renameStyle);

  const [activeTab, setActiveTab] = useState<StyleTab>("current");

  // Document tab state
  const [editingStyleName, setEditingStyleName] = useState<string | null>(null);
  const [tempStyle, setTempStyle] = useState<AssStyle | null>(null);

  // Library tab state (live-save, mirrors document temp/selection pattern)
  const [libraryStyles, setLibraryStyles] = useState<AssStyle[]>([]);
  const [libraryLoadState, setLibraryLoadState] =
    useState<LibraryLoadState>("idle");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [librarySelectedName, setLibrarySelectedName] = useState<string | null>(
    null,
  );
  const [libraryTempStyle, setLibraryTempStyle] = useState<AssStyle | null>(
    null,
  );
  const [libraryWritePending, setLibraryWritePending] = useState(false);

  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);

  const libraryWritePendingRef = useRef(false);
  const loadStartedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset to Current Document whenever drawer opens.
  useEffect(() => {
    if (open) setActiveTab("current");
  }, [open]);

  const runLibraryLoad = useCallback(async () => {
    setLibraryLoadState("loading");
    setLibraryError(null);
    try {
      const styles = await loadStyleLibrary();
      if (!mountedRef.current) return;
      setLibraryStyles(styles);
      setLibraryLoadState("ready");
    } catch (error) {
      if (!mountedRef.current) return;
      setLibraryLoadState("error");
      setLibraryError(
        error instanceof Error ? error.message : "加载样式库失败",
      );
    }
  }, []);

  // Load once per mounted component on first open.
  useEffect(() => {
    if (!open || loadStartedRef.current) return;
    loadStartedRef.current = true;
    void runLibraryLoad();
  }, [open, runLibraryLoad]);

  const retryLibraryLoad = () => {
    loadStartedRef.current = true;
    void runLibraryLoad();
  };

  // Document: insert defaults when empty (existing behavior).
  useEffect(() => {
    if (!open || assStyles.length > 0) return;
    for (const style of createDefaultStyles()) {
      addStyle(style);
    }
  }, [addStyle, assStyles.length, open]);

  useEffect(() => {
    if (!editingStyleName) {
      setTempStyle(null);
      return;
    }
    const next = assStyles.find((style) => style.name === editingStyleName);
    setTempStyle(next ?? null);
  }, [assStyles, editingStyleName]);

  // Keep library temp in sync with the selected authoritative entry.
  useEffect(() => {
    if (!librarySelectedName) {
      setLibraryTempStyle(null);
      return;
    }
    const next = libraryStyles.find(
      (style) => style.name === librarySelectedName,
    );
    if (!next) {
      setLibraryTempStyle(null);
      setLibrarySelectedName(null);
      return;
    }
    setLibraryTempStyle((prev) => {
      // Preserve in-progress rename while a concurrent write refreshes the list.
      if (prev && prev.name !== next.name) {
        return { ...next, name: prev.name };
      }
      return next;
    });
  }, [libraryStyles, librarySelectedName]);

  const displayStyles = assStyles.length > 0 ? assStyles : createDefaultStyles();

  const docNameConflict = tempStyle
    ? hasNameConflict(displayStyles, tempStyle.name, editingStyleName)
    : false;
  const docNameEmpty = tempStyle ? tempStyle.name.trim().length === 0 : false;
  const docNameUncommitted =
    !!tempStyle &&
    !!editingStyleName &&
    tempStyle.name.trim() !== editingStyleName;

  const libNameConflict = libraryTempStyle
    ? hasNameConflict(
        libraryStyles,
        libraryTempStyle.name,
        librarySelectedName,
      )
    : false;
  const libNameEmpty = libraryTempStyle
    ? libraryTempStyle.name.trim().length === 0
    : false;
  const libNameUncommitted =
    !!libraryTempStyle &&
    !!librarySelectedName &&
    libraryTempStyle.name.trim() !== librarySelectedName;

  const libraryReady = libraryLoadState === "ready";

  const canSaveDocToLibrary =
    libraryReady &&
    !libraryWritePending &&
    !!tempStyle &&
    !!editingStyleName &&
    !docNameEmpty &&
    !docNameConflict &&
    !docNameUncommitted;

  const canAddLibraryToDoc =
    libraryReady &&
    !libraryWritePending &&
    librarySelectedName !== null &&
    !!libraryTempStyle &&
    !libNameEmpty &&
    !libNameConflict &&
    !libNameUncommitted;

  // ---- Document handlers ----

  const selectDocStyle = (name: string) => {
    const style = displayStyles.find((entry) => entry.name === name);
    if (!style) return;
    setEditingStyleName(name);
    setTempStyle(style);
  };

  const patchDocStyle = (updates: Partial<AssStyle>) => {
    if (!tempStyle || !editingStyleName) return;
    const next = { ...tempStyle, ...updates };
    setTempStyle(next);
    if (Object.prototype.hasOwnProperty.call(updates, "name")) return;
    updateStyle(editingStyleName, updates);
  };

  const commitDocNameEdit = () => {
    if (!tempStyle || !editingStyleName) return;
    const nextName = tempStyle.name.trim();
    if (!nextName || nextName === editingStyleName) return;
    if (hasNameConflict(displayStyles, nextName, editingStyleName)) return;

    const referencingCueCount = useProjectStore
      .getState()
      .cues.filter((cue) => cue.style === editingStyleName).length;

    if (referencingCueCount === 0) {
      renameStyle(editingStyleName, nextName, false);
      setEditingStyleName(nextName);
      return;
    }

    setPendingDialog({
      kind: "doc-rename",
      oldName: editingStyleName,
      proposedName: nextName,
      referencingCueCount,
    });
  };

  const handleDocCreate = () => {
    const base = displayStyles[0] ?? createDefaultStyles()[0];
    const name = uniqueStyleName(displayStyles, "New Style");
    const next: AssStyle = { ...base, name };
    addStyle(next);
    setEditingStyleName(name);
  };

  const handleDocDelete = (name: string) => {
    deleteStyle(name);
    if (editingStyleName === name) setEditingStyleName(null);
  };

  // ---- Library live-save helpers ----

  const persistLibrary = async (nextStyles: AssStyle[]): Promise<boolean> => {
    if (libraryWritePendingRef.current) return false;
    libraryWritePendingRef.current = true;
    setLibraryWritePending(true);
    setLibraryError(null);
    try {
      await saveStyleLibrary(nextStyles);
      if (!mountedRef.current) return false;
      setLibraryStyles(nextStyles);
      return true;
    } catch (error) {
      if (!mountedRef.current) return false;
      setLibraryError(
        error instanceof Error ? error.message : "保存样式库失败",
      );
      return false;
    } finally {
      libraryWritePendingRef.current = false;
      if (mountedRef.current) setLibraryWritePending(false);
    }
  };

  const selectLibraryStyle = (name: string) => {
    if (libraryWritePendingRef.current || name === librarySelectedName) return;
    const entry = libraryStyles.find((s) => s.name === name);
    if (!entry) return;
    setLibrarySelectedName(name);
    setLibraryTempStyle(entry);
  };

  const patchLibraryStyle = (updates: Partial<AssStyle>) => {
    if (
      !libraryTempStyle ||
      !librarySelectedName ||
      !libraryReady ||
      libraryWritePendingRef.current
    ) {
      return;
    }
    const next = { ...libraryTempStyle, ...updates };
    setLibraryTempStyle(next);
    // Name edits stay local until blur (like document).
    if (Object.prototype.hasOwnProperty.call(updates, "name")) return;

    const nextStyles = libraryStyles.map((style) =>
      style.name === librarySelectedName
        ? { ...next, name: librarySelectedName }
        : style,
    );
    // Optimistic local list update so list swatches stay current.
    setLibraryStyles(nextStyles);
    void persistLibrary(nextStyles);
  };

  const commitLibraryNameEdit = () => {
    if (
      !libraryTempStyle ||
      !librarySelectedName ||
      !libraryReady ||
      libraryWritePendingRef.current
    ) {
      return;
    }
    const nextName = libraryTempStyle.name.trim();
    if (!nextName || nextName === librarySelectedName) {
      // Revert empty/unchanged display to selected name.
      if (libraryTempStyle.name !== librarySelectedName) {
        setLibraryTempStyle({ ...libraryTempStyle, name: librarySelectedName });
      }
      return;
    }
    if (hasNameConflict(libraryStyles, nextName, librarySelectedName)) return;

    const renamed = { ...libraryTempStyle, name: nextName };
    const nextStyles = libraryStyles.map((style) =>
      style.name === librarySelectedName ? renamed : style,
    );
    setLibrarySelectedName(nextName);
    setLibraryTempStyle(renamed);
    setLibraryStyles(nextStyles);
    void persistLibrary(nextStyles);
  };

  const handleLibraryCreate = () => {
    if (!libraryReady || libraryWritePendingRef.current) return;
    const base =
      libraryStyles[0] ??
      libraryTempStyle ??
      createDefaultStyles()[0];
    const name = uniqueStyleName(libraryStyles, "New Style");
    const next: AssStyle = { ...base, name };
    const nextStyles = [...libraryStyles, next];
    setLibrarySelectedName(name);
    setLibraryTempStyle(next);
    setLibraryStyles(nextStyles);
    void persistLibrary(nextStyles);
  };

  const handleDeleteLibrary = async (name: string) => {
    const nextStyles = libraryStyles.filter((s) => s.name !== name);
    const ok = await persistLibrary(nextStyles);
    if (!ok) return;
    if (librarySelectedName === name) {
      setLibrarySelectedName(null);
      setLibraryTempStyle(null);
    }
  };

  const handleSaveDocToLibrary = async () => {
    if (
      !canSaveDocToLibrary ||
      !tempStyle ||
      !editingStyleName ||
      libraryWritePendingRef.current
    ) {
      return;
    }
    const source =
      assStyles.find((s) => s.name === editingStyleName) ?? tempStyle;
    const snapshot = { ...source };
    const existing = libraryStyles.find((s) => s.name === snapshot.name);
    if (existing) {
      setPendingDialog({ kind: "overwrite-to-library", style: snapshot });
      return;
    }
    const nextStyles = [...libraryStyles, snapshot];
    const ok = await persistLibrary(nextStyles);
    if (!ok) return;
    if (librarySelectedName === snapshot.name) {
      setLibraryTempStyle(snapshot);
    }
  };

  const confirmOverwriteToLibrary = async (style: AssStyle) => {
    const nextStyles = libraryStyles.map((entry) =>
      entry.name === style.name ? { ...style } : entry,
    );
    const ok = await persistLibrary(nextStyles);
    if (!ok) return;
    if (librarySelectedName === style.name) {
      setLibraryTempStyle({ ...style });
    }
  };

  const handleAddLibraryToDoc = () => {
    if (
      !canAddLibraryToDoc ||
      librarySelectedName === null ||
      libraryWritePendingRef.current
    ) {
      return;
    }
    // Use authoritative list entry (live-save keeps it current).
    const entry = libraryStyles.find((s) => s.name === librarySelectedName);
    if (!entry) return;
    const snapshot = { ...entry };
    const existing = assStyles.find((s) => s.name === snapshot.name);
    if (existing) {
      setPendingDialog({ kind: "overwrite-to-document", style: snapshot });
      return;
    }
    addStyle(snapshot);
  };

  const confirmOverwriteToDocument = (style: AssStyle) => {
    updateStyle(style.name, style);
  };

  const resolveDialog = (value: string) => {
    const dialog = pendingDialog;
    setPendingDialog(null);
    if (!dialog) return;

    switch (dialog.kind) {
      case "doc-rename": {
        if (value === "cancel") {
          if (tempStyle) setTempStyle({ ...tempStyle, name: dialog.oldName });
          return;
        }
        if (value === "yes") {
          renameStyle(dialog.oldName, dialog.proposedName, true);
          setEditingStyleName(dialog.proposedName);
          return;
        }
        if (value === "no") {
          renameStyle(dialog.oldName, dialog.proposedName, false);
          setEditingStyleName(dialog.proposedName);
        }
        return;
      }
      case "overwrite-to-library": {
        if (value === "overwrite") void confirmOverwriteToLibrary(dialog.style);
        return;
      }
      case "overwrite-to-document": {
        if (value === "overwrite") confirmOverwriteToDocument(dialog.style);
        return;
      }
      case "delete-library": {
        if (value === "delete") void handleDeleteLibrary(dialog.name);
        return;
      }
    }
  };

  const fontSeedNames = [
    ...(tempStyle?.fontName ? [tempStyle.fontName] : []),
    ...(libraryTempStyle?.fontName ? [libraryTempStyle.fontName] : []),
    ...displayStyles.map((style) => style.fontName),
    ...libraryStyles.map((style) => style.fontName),
    ...COMMON_FONTS,
  ];

  const fontOptions = usePreviewFontNames(fontSeedNames, { enabled: open });

  const activeEditStyle =
    activeTab === "current" ? tempStyle : libraryTempStyle;

  const encodingOptions =
    activeEditStyle &&
    !ASS_ENCODING_OPTIONS.some(
      (option) => option.value === activeEditStyle.encoding,
    )
      ? [
          ...ASS_ENCODING_OPTIONS,
          {
            value: activeEditStyle.encoding,
            label: `${activeEditStyle.encoding} - 当前值`,
          },
        ]
      : ASS_ENCODING_OPTIONS;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && open) toggleStyleManager();
        }}
        modal={false}
      >
        <SheetContent
          side="right"
          showOverlay={false}
          showCloseButton={false}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (pendingDialog) event.preventDefault();
          }}
          className="flex w-[440px] max-w-[calc(100vw-24px)] flex-col gap-0 bg-card p-0 sm:max-w-[440px]"
        >
          <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <SheetTitle className="text-sm font-semibold">样式管理</SheetTitle>
              <SheetDescription className="text-xs">
                {activeTab === "current"
                  ? `${displayStyles.length} 个文档样式`
                  : libraryReady
                    ? `${libraryStyles.length} 个库样式`
                    : "样式库"}
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleStyleManager}
              title="关闭"
              aria-label="关闭样式管理"
            >
              <X className="size-4" />
            </Button>
          </SheetHeader>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as StyleTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <div className="border-b border-border px-4 py-2">
              <TabsList className="w-full">
                <TabsTrigger value="current" className="flex-1">
                  当前文档
                </TabsTrigger>
                <TabsTrigger value="library" className="flex-1">
                  样式库
                </TabsTrigger>
              </TabsList>
            </div>

            {libraryError && (
              <div
                role="alert"
                className="mx-4 mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <div className="flex items-start justify-between gap-2">
                  <span>{libraryError}</span>
                  {libraryLoadState === "error" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={retryLibraryLoad}
                    >
                      重试
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              <TabsContent value="current" className="mt-0">
                <StyleListSection
                  styles={displayStyles}
                  selectedName={editingStyleName}
                  onSelect={selectDocStyle}
                  onCreate={handleDocCreate}
                  onDelete={handleDocDelete}
                />
                <section className="px-4 py-4">
                  {tempStyle ? (
                    <>
                      <StyleFields
                        style={tempStyle}
                        nameConflict={docNameConflict}
                        nameEmpty={docNameEmpty}
                        onPatch={patchDocStyle}
                        onNameBlur={commitDocNameEdit}
                        fontOptions={fontOptions}
                        encodingOptions={encodingOptions}
                      />
                      <div className="mt-4">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          disabled={!canSaveDocToLibrary}
                          onClick={() => void handleSaveDocToLibrary()}
                        >
                          保存到样式库
                        </Button>
                      </div>
                    </>
                  ) : (
                    <EmptyEditor />
                  )}
                </section>
              </TabsContent>

              <TabsContent value="library" className="mt-0">
                <StyleListSection
                  styles={libraryStyles}
                  selectedName={librarySelectedName}
                  onSelect={selectLibraryStyle}
                  onCreate={handleLibraryCreate}
                  onDelete={(name) =>
                    setPendingDialog({ kind: "delete-library", name })
                  }
                  disabled={!libraryReady || libraryWritePending}
                  extra={
                    libraryLoadState === "loading" ? (
                      <p className="text-xs text-muted-foreground">正在加载样式库…</p>
                    ) : libraryLoadState === "error" ? (
                      <p className="text-xs text-muted-foreground">
                        样式库不可用，当前文档仍可编辑。
                      </p>
                    ) : libraryStyles.length === 0 ? (
                      <p className="text-xs text-muted-foreground">样式库为空</p>
                    ) : null
                  }
                />
                <section className="px-4 py-4">
                  {libraryTempStyle ? (
                    <>
                      <StyleFields
                        style={libraryTempStyle}
                        nameConflict={libNameConflict}
                        nameEmpty={libNameEmpty}
                        onPatch={patchLibraryStyle}
                        onNameBlur={commitLibraryNameEdit}
                        fontOptions={fontOptions}
                        encodingOptions={encodingOptions}
                        disabled={libraryWritePending || !libraryReady}
                      />
                      <div className="mt-4">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          disabled={!canAddLibraryToDoc}
                          onClick={handleAddLibraryToDoc}
                        >
                          添加到当前文档
                        </Button>
                      </div>
                    </>
                  ) : (
                    <EmptyEditor />
                  )}
                </section>
              </TabsContent>
            </div>
          </Tabs>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={open && pendingDialog?.kind === "doc-rename"}
        title="重命名样式"
        description={
          pendingDialog?.kind === "doc-rename"
            ? `样式「${pendingDialog.oldName}」被脚本中 ${pendingDialog.referencingCueCount} 条字幕引用。是否同步更新这些字幕的样式引用？`
            : ""
        }
        options={[
          { label: "取消重命名", value: "cancel" },
          { label: "否，仅重命名样式", value: "no" },
          { label: "是，同步更新", value: "yes", variant: "primary" },
        ]}
        escValue="cancel"
        onSelect={resolveDialog}
      />
      <ConfirmDialog
        open={
          open &&
          (pendingDialog?.kind === "overwrite-to-library" ||
            pendingDialog?.kind === "overwrite-to-document")
        }
        title="覆盖样式"
        description={
          pendingDialog?.kind === "overwrite-to-library" ||
          pendingDialog?.kind === "overwrite-to-document"
            ? `目标已存在同名样式「${pendingDialog.style.name}」。是否覆盖？`
            : ""
        }
        options={[
          { label: "取消", value: "cancel" },
          { label: "覆盖样式", value: "overwrite", variant: "primary" },
        ]}
        escValue="cancel"
        onSelect={resolveDialog}
      />
      <ConfirmDialog
        open={open && pendingDialog?.kind === "delete-library"}
        title="删除样式"
        description={
          pendingDialog?.kind === "delete-library"
            ? `确定从样式库删除「${pendingDialog.name}」？此操作不可撤销。`
            : ""
        }
        options={[
          { label: "取消", value: "cancel" },
          { label: "删除样式", value: "delete", variant: "danger" },
        ]}
        escValue="cancel"
        onSelect={resolveDialog}
      />
    </>
  );
}

function EmptyEditor() {
  return (
    <div className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      选择或新建样式以开始编辑
    </div>
  );
}

function StyleListSection({
  styles,
  selectedName,
  onSelect,
  onCreate,
  onDelete,
  disabled = false,
  extra,
}: {
  styles: AssStyle[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          样式列表
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCreate}
          disabled={disabled}
          className="text-xs"
        >
          <Plus className="size-3.5" />
          新建样式
        </Button>
      </div>
      {extra}
      <div className="flex flex-col gap-1.5">
        {styles.map((style) => {
          const active = style.name === selectedName;
          return (
            <div
              key={style.name}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 ${
                active
                  ? "border-primary bg-primary/15 ring-1 ring-primary/40"
                  : "border-border bg-background hover:bg-muted"
              } ${disabled ? "opacity-60" : ""}`}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onSelect(style.name)}
                className="h-auto min-w-0 flex-1 justify-start gap-2 px-1 py-0.5 hover:bg-transparent dark:hover:bg-transparent"
              >
                <span
                  className="size-4 shrink-0 rounded border border-border"
                  style={styleSwatch(style)}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-left text-sm font-normal ${
                    active ? "font-medium text-primary" : "text-foreground"
                  }`}
                >
                  {style.name}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={() => onDelete(style.name)}
                className="text-muted-foreground hover:text-destructive"
                title="删除样式"
                aria-label={`删除样式 ${style.name}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StyleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="rounded-lg border border-border bg-background"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="group h-auto w-full justify-between border-0 rounded-[calc(var(--radius-lg)-1px)] px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 data-[state=open]:rounded-b-none active:translate-y-0"
        >
          <span>{title}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-3 py-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function StyleFields({
  style,
  nameConflict,
  nameEmpty,
  onPatch,
  onNameBlur,
  fontOptions,
  encodingOptions,
  disabled = false,
}: {
  style: AssStyle;
  nameConflict: boolean;
  nameEmpty: boolean;
  onPatch: (updates: Partial<AssStyle>) => void;
  onNameBlur: () => void;
  fontOptions: string[];
  encodingOptions: { value: number; label: string }[];
  disabled?: boolean;
}) {
  const baseId = useId();

  return (
    <fieldset
      disabled={disabled}
      className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0 disabled:opacity-60"
    >
      <div>
        <Label
          htmlFor={`${baseId}-name`}
          className="mb-1 text-xs font-normal text-muted-foreground"
        >
          样式名
        </Label>
        <Input
          id={`${baseId}-name`}
          aria-invalid={nameConflict || nameEmpty}
          value={style.name}
          onChange={(event) => onPatch({ name: event.target.value })}
          onBlur={onNameBlur}
          disabled={disabled}
        />
        {(nameConflict || nameEmpty) && (
          <p className="mt-1 text-xs text-destructive">
            {nameEmpty ? "样式名不能为空" : "样式名已存在"}
          </p>
        )}
      </div>

      <StyleSection title="字体" defaultOpen>
        <div className="flex flex-col gap-3">
          <Field label="字体名" htmlFor={`${baseId}-font-name`}>
            <FontComboBox
              id={`${baseId}-font-name`}
              value={style.fontName}
              options={fontOptions}
              onCommit={(fontName) => onPatch({ fontName })}
              disabled={disabled}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="字号" htmlFor={`${baseId}-font-size`}>
              <Input
                id={`${baseId}-font-size`}
                type="number"
                min="1"
                max="200"
                value={style.fontSize}
                onChange={(event) =>
                  onPatch({
                    fontSize: parseNumber(event.target.value, style.fontSize),
                  })
                }
              />
            </Field>
            <Field label="旋转" htmlFor={`${baseId}-angle`}>
              <Input
                id={`${baseId}-angle`}
                type="number"
                min="-360"
                max="360"
                value={style.angle}
                onChange={(event) =>
                  onPatch({
                    angle: parseNumber(event.target.value, style.angle),
                  })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="缩放 X (%)" htmlFor={`${baseId}-scale-x`}>
              <Input
                id={`${baseId}-scale-x`}
                type="number"
                min="50"
                max="200"
                value={style.scaleX}
                onChange={(event) =>
                  onPatch({
                    scaleX: parseNumber(event.target.value, style.scaleX),
                  })
                }
              />
            </Field>
            <Field label="缩放 Y (%)" htmlFor={`${baseId}-scale-y`}>
              <Input
                id={`${baseId}-scale-y`}
                type="number"
                min="50"
                max="200"
                value={style.scaleY}
                onChange={(event) =>
                  onPatch({
                    scaleY: parseNumber(event.target.value, style.scaleY),
                  })
                }
              />
            </Field>
          </div>

          <Field label="间距" htmlFor={`${baseId}-spacing`}>
            <Input
              id={`${baseId}-spacing`}
              type="number"
              min="-10"
              max="50"
              step="0.5"
              value={style.spacing}
              onChange={(event) =>
                onPatch({
                  spacing: parseNumber(event.target.value, style.spacing),
                })
              }
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <CheckboxField
              label="粗体"
              checked={Boolean(style.bold)}
              onChange={(bold) => onPatch({ bold })}
            />
            <CheckboxField
              label="斜体"
              checked={style.italic}
              onChange={(italic) => onPatch({ italic })}
            />
            <CheckboxField
              label="下划线"
              checked={style.underline}
              onChange={(underline) => onPatch({ underline })}
            />
            <CheckboxField
              label="删除线"
              checked={style.strikeOut}
              onChange={(strikeOut) => onPatch({ strikeOut })}
            />
          </div>
        </div>
      </StyleSection>

      <StyleSection title="颜色" defaultOpen>
        <div className="grid grid-cols-2 gap-3">
          <ColorPicker
            label="主颜色"
            value={style.primaryColor}
            onChange={(primaryColor) => onPatch({ primaryColor })}
            disabled={disabled}
          />
          <ColorPicker
            label="次颜色"
            value={style.secondaryColor}
            onChange={(secondaryColor) => onPatch({ secondaryColor })}
            disabled={disabled}
          />
          <ColorPicker
            label="边框颜色"
            value={style.outlineColor}
            onChange={(outlineColor) => onPatch({ outlineColor })}
            disabled={disabled}
          />
          <ColorPicker
            label="背景色"
            value={style.backColor}
            onChange={(backColor) => onPatch({ backColor })}
            disabled={disabled}
          />
        </div>
      </StyleSection>

      <StyleSection title="边框与阴影">
        <div className="flex flex-col gap-3">
          <Field label="边框样式" htmlFor={`${baseId}-border-style`}>
            <Select
              id={`${baseId}-border-style`}
              value={String(style.borderStyle)}
              onChange={(value) =>
                onPatch({
                  borderStyle: parseNumber(value, style.borderStyle),
                })
              }
              disabled={disabled}
              options={[
                { value: "1", label: "1 - 描边 + 阴影" },
                { value: "3", label: "3 - 不透明方框" },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="边框宽度" htmlFor={`${baseId}-outline`}>
              <Input
                id={`${baseId}-outline`}
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={style.outline}
                onChange={(event) =>
                  onPatch({
                    outline: parseNumber(event.target.value, style.outline),
                  })
                }
              />
            </Field>
            <Field label="阴影深度" htmlFor={`${baseId}-shadow`}>
              <Input
                id={`${baseId}-shadow`}
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={style.shadow}
                onChange={(event) =>
                  onPatch({
                    shadow: parseNumber(event.target.value, style.shadow),
                  })
                }
              />
            </Field>
          </div>
        </div>
      </StyleSection>

      <StyleSection title="位置与边距">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">对齐方式</span>
            <div className="grid w-36 grid-cols-3 gap-1">
              {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((alignment) => (
                <Button
                  key={alignment}
                  type="button"
                  variant={style.alignment === alignment ? "default" : "outline"}
                  size="sm"
                  onClick={() => onPatch({ alignment })}
                  className="h-8 px-0 text-xs"
                >
                  {alignment}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="左边距" htmlFor={`${baseId}-margin-l`}>
              <Input
                id={`${baseId}-margin-l`}
                type="number"
                min="0"
                max="100"
                value={style.marginL}
                onChange={(event) =>
                  onPatch({
                    marginL: parseNumber(event.target.value, style.marginL),
                  })
                }
              />
            </Field>
            <Field label="右边距" htmlFor={`${baseId}-margin-r`}>
              <Input
                id={`${baseId}-margin-r`}
                type="number"
                min="0"
                max="100"
                value={style.marginR}
                onChange={(event) =>
                  onPatch({
                    marginR: parseNumber(event.target.value, style.marginR),
                  })
                }
              />
            </Field>
          </div>
          <Field label="垂直边距" htmlFor={`${baseId}-margin-v`}>
            <Input
              id={`${baseId}-margin-v`}
              type="number"
              min="0"
              max="100"
              value={style.marginV}
              onChange={(event) =>
                onPatch({
                  marginV: parseNumber(event.target.value, style.marginV),
                })
              }
            />
          </Field>
        </div>
      </StyleSection>

      <StyleSection title="高级">
        <Field label="编码" htmlFor={`${baseId}-encoding`}>
          <Select
            id={`${baseId}-encoding`}
            value={String(style.encoding)}
            onChange={(value) =>
              onPatch({
                encoding: parseNumber(value, style.encoding),
              })
            }
            disabled={disabled}
            options={encodingOptions.map((option) => ({
              value: String(option.value),
              label: option.label,
            }))}
          />
        </Field>
      </StyleSection>
    </fieldset>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label
        htmlFor={htmlFor}
        className="text-xs font-normal text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-normal text-foreground"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span>{label}</span>
    </Label>
  );
}
