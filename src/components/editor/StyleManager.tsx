import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  assColorToCss,
  createDefaultStyles,
  type AssStyle,
} from "@/lib/ass";
import { usePreviewFontNames } from "../../hooks/usePreviewFontNames";
import { useProjectStore } from "../../stores/projectStore";
import { useUiStore } from "../../stores/uiStore";
import { IconPlus, IconTrash, IconX } from "../layout/NavIcons";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Select } from "../ui/select-adapter";
import { ColorPicker } from "./ColorPicker";
import { FontComboBox } from "./FontComboBox";

const INPUT_CLASS =
  "w-full rounded border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

const COMMON_FONTS = [
  "Arial",
  "Noto Sans CJK JP",
  "Noto Sans SC",
  "Microsoft YaHei",
  "Meiryo",
  "Yu Gothic",
  "SimHei",
];

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

  const [editingStyleName, setEditingStyleName] = useState<string | null>(null);
  const [tempStyle, setTempStyle] = useState<AssStyle | null>(null);
  const [pendingRename, setPendingRename] = useState<{
    oldName: string;
    proposedName: string;
    referencingCueCount: number;
  } | null>(null);

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

  const displayStyles = assStyles.length > 0 ? assStyles : createDefaultStyles();

  const nameConflict = tempStyle
    ? hasNameConflict(displayStyles, tempStyle.name, editingStyleName)
    : false;
  const nameEmpty = tempStyle ? tempStyle.name.trim().length === 0 : false;

  const patchStyle = (updates: Partial<AssStyle>) => {
    if (!tempStyle || !editingStyleName) return;
    const next = { ...tempStyle, ...updates };
    setTempStyle(next);

    if (Object.prototype.hasOwnProperty.call(updates, "name")) {
      // 名称变更不在此直接提交，交由输入框 blur 时的提交逻辑处理
      // （可能触发引用同步确认对话框）。
      return;
    }

    updateStyle(editingStyleName, updates);
  };

  const commitNameEdit = () => {
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

    setPendingRename({ oldName: editingStyleName, proposedName: nextName, referencingCueCount });
  };

  const resolveRename = (choice: string) => {
    const pending = pendingRename;
    setPendingRename(null);
    if (!pending) return;

    if (choice === "cancel") {
      // 回滚 tempStyle 名称为当前样式名
      if (tempStyle) setTempStyle({ ...tempStyle, name: pending.oldName });
      return;
    }
    if (choice === "yes") {
      renameStyle(pending.oldName, pending.proposedName, true);
      setEditingStyleName(pending.proposedName);
      return;
    }
    if (choice === "no") {
      renameStyle(pending.oldName, pending.proposedName, false);
      setEditingStyleName(pending.proposedName);
    }
  };

  const handleCreate = () => {
    const base = displayStyles[0] ?? createDefaultStyles()[0];
    const name = uniqueStyleName(displayStyles, "New Style");
    const next: AssStyle = { ...base, name };
    addStyle(next);
    setEditingStyleName(name);
  };

  const handleDelete = (name: string) => {
    deleteStyle(name);
    if (editingStyleName === name) {
      setEditingStyleName(null);
    }
  };

  const fontOptions = usePreviewFontNames(
    [
      ...(tempStyle?.fontName ? [tempStyle.fontName] : []),
      ...displayStyles.map((style) => style.fontName),
      ...COMMON_FONTS,
    ],
    { enabled: open },
  );
  const encodingOptions = useMemo(() => {
    if (
      tempStyle &&
      !ASS_ENCODING_OPTIONS.some((option) => option.value === tempStyle.encoding)
    ) {
      return [
        ...ASS_ENCODING_OPTIONS,
        {
          value: tempStyle.encoding,
          label: `${tempStyle.encoding} - 当前值`,
        },
      ];
    }
    return ASS_ENCODING_OPTIONS;
  }, [tempStyle]);

  if (!open) return null;

  return (
    <aside className="fixed bottom-0 right-0 top-0 z-40 flex w-[440px] max-w-[calc(100vw-24px)] flex-col border-l border-border bg-surface-raised shadow-2xl">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text">样式管理</h2>
          <p className="text-xs text-text-muted">{displayStyles.length} 个样式</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleStyleManager}
          title="关闭"
          aria-label="关闭样式管理"
        >
          <IconX className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <section className="border-b border-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-text-muted">
              样式列表
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCreate}
              className="inline-flex items-center gap-1 text-xs"
            >
              <IconPlus className="h-3.5 w-3.5" />
              新建样式
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            {displayStyles.map((style) => {
              const active = style.name === editingStyleName;
              return (
                <div
                  key={style.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditingStyleName(style.name)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setEditingStyleName(style.name);
                    }
                  }}
                  className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 ${
                    active
                      ? "border-primary bg-primary/15 ring-1 ring-primary/40"
                      : "border-border bg-surface hover:bg-surface-overlay"
                  }`}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded border border-border"
                    style={styleSwatch(style)}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-left text-sm ${
                      active ? "font-medium text-primary" : "text-text"
                    }`}
                  >
                    {style.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDelete(style.name);
                    }}
                    className="hover:text-destructive"
                    title="删除样式"
                    aria-label={`删除样式 ${style.name}`}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="px-4 py-4">
          {tempStyle ? (
            <div className="flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-xs text-text-muted">
                  样式名
                </label>
                <input
                  className={`${INPUT_CLASS} ${
                    nameConflict || nameEmpty ? "border-danger" : ""
                  }`}
                  value={tempStyle.name}
                  onChange={(event) => patchStyle({ name: event.target.value })}
                  onBlur={commitNameEdit}
                />
                {(nameConflict || nameEmpty) && (
                  <p className="mt-1 text-xs text-danger">
                    {nameEmpty ? "样式名不能为空" : "样式名已存在"}
                  </p>
                )}
              </div>

              <details open className="rounded border border-border bg-surface">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text">
                  字体
                </summary>
                <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  <Field label="字体名">
                    <FontComboBox
                      value={tempStyle.fontName}
                      options={fontOptions}
                      onCommit={(fontName) => patchStyle({ fontName })}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="字号">
                      <input
                        className={INPUT_CLASS}
                        type="number"
                        min="1"
                        max="200"
                        value={tempStyle.fontSize}
                        onChange={(event) =>
                          patchStyle({
                            fontSize: parseNumber(
                              event.target.value,
                              tempStyle.fontSize,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="旋转">
                      <input
                        className={INPUT_CLASS}
                        type="number"
                        min="-360"
                        max="360"
                        value={tempStyle.angle}
                        onChange={(event) =>
                          patchStyle({
                            angle: parseNumber(
                              event.target.value,
                              tempStyle.angle,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="缩放 X (%)">
                      <input
                        className={INPUT_CLASS}
                        type="number"
                        min="50"
                        max="200"
                        value={tempStyle.scaleX}
                        onChange={(event) =>
                          patchStyle({
                            scaleX: parseNumber(
                              event.target.value,
                              tempStyle.scaleX,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="缩放 Y (%)">
                      <input
                        className={INPUT_CLASS}
                        type="number"
                        min="50"
                        max="200"
                        value={tempStyle.scaleY}
                        onChange={(event) =>
                          patchStyle({
                            scaleY: parseNumber(
                              event.target.value,
                              tempStyle.scaleY,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>

                  <Field label="间距">
                    <input
                      className={INPUT_CLASS}
                      type="number"
                      min="-10"
                      max="50"
                      step="0.5"
                      value={tempStyle.spacing}
                      onChange={(event) =>
                        patchStyle({
                          spacing: parseNumber(
                            event.target.value,
                            tempStyle.spacing,
                          ),
                        })
                      }
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    <CheckboxField
                      label="粗体"
                      checked={Boolean(tempStyle.bold)}
                      onChange={(bold) => patchStyle({ bold })}
                    />
                    <CheckboxField
                      label="斜体"
                      checked={tempStyle.italic}
                      onChange={(italic) => patchStyle({ italic })}
                    />
                    <CheckboxField
                      label="下划线"
                      checked={tempStyle.underline}
                      onChange={(underline) => patchStyle({ underline })}
                    />
                    <CheckboxField
                      label="删除线"
                      checked={tempStyle.strikeOut}
                      onChange={(strikeOut) => patchStyle({ strikeOut })}
                    />
                  </div>
                </div>
              </details>

              <details open className="rounded border border-border bg-surface">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text">
                  颜色
                </summary>
                <div className="grid grid-cols-2 gap-3 border-t border-border px-3 py-3">
                  <ColorPicker
                    label="主颜色"
                    value={tempStyle.primaryColor}
                    onChange={(primaryColor) => patchStyle({ primaryColor })}
                  />
                  <ColorPicker
                    label="次颜色"
                    value={tempStyle.secondaryColor}
                    onChange={(secondaryColor) =>
                      patchStyle({ secondaryColor })
                    }
                  />
                  <ColorPicker
                    label="边框颜色"
                    value={tempStyle.outlineColor}
                    onChange={(outlineColor) => patchStyle({ outlineColor })}
                  />
                  <ColorPicker
                    label="背景色"
                    value={tempStyle.backColor}
                    onChange={(backColor) => patchStyle({ backColor })}
                  />
                </div>
              </details>

              <details className="rounded border border-border bg-surface">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text">
                  边框与阴影
                </summary>
                <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  <Field label="边框样式">
                    <Select
                      value={String(tempStyle.borderStyle)}
                      onChange={(value) =>
                        patchStyle({
                          borderStyle: parseNumber(
                            value,
                            tempStyle.borderStyle,
                          ),
                        })
                      }
                      options={[
                        { value: "1", label: "1 - 描边 + 阴影" },
                        { value: "3", label: "3 - 不透明方框" },
                      ]}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="边框宽度">
                      <input
                        className={INPUT_CLASS}
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={tempStyle.outline}
                        onChange={(event) =>
                          patchStyle({
                            outline: parseNumber(
                              event.target.value,
                              tempStyle.outline,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="阴影深度">
                      <input
                        className={INPUT_CLASS}
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={tempStyle.shadow}
                        onChange={(event) =>
                          patchStyle({
                            shadow: parseNumber(
                              event.target.value,
                              tempStyle.shadow,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                </div>
              </details>

              <details className="rounded border border-border bg-surface">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text">
                  位置与边距
                </summary>
                <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  <Field label="对齐方式">
                    <div className="grid w-36 grid-cols-3 gap-1">
                      {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((alignment) => (
                        <button
                          key={alignment}
                          type="button"
                          onClick={() => patchStyle({ alignment })}
                          className={`h-8 rounded border text-xs ${
                            tempStyle.alignment === alignment
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-text hover:bg-muted"
                          }`}
                        >
                          {alignment}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="左边距">
                      <input
                        className={INPUT_CLASS}
                        type="number"
                        min="0"
                        max="100"
                        value={tempStyle.marginL}
                        onChange={(event) =>
                          patchStyle({
                            marginL: parseNumber(
                              event.target.value,
                              tempStyle.marginL,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="右边距">
                      <input
                        className={INPUT_CLASS}
                        type="number"
                        min="0"
                        max="100"
                        value={tempStyle.marginR}
                        onChange={(event) =>
                          patchStyle({
                            marginR: parseNumber(
                              event.target.value,
                              tempStyle.marginR,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field label="垂直边距">
                    <input
                      className={INPUT_CLASS}
                      type="number"
                      min="0"
                      max="100"
                      value={tempStyle.marginV}
                      onChange={(event) =>
                        patchStyle({
                          marginV: parseNumber(
                            event.target.value,
                            tempStyle.marginV,
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
              </details>

              <details className="rounded border border-border bg-surface">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text">
                  高级
                </summary>
                <div className="border-t border-border px-3 py-3">
                  <Field label="编码">
                    <Select
                      value={String(tempStyle.encoding)}
                      onChange={(value) =>
                        patchStyle({
                          encoding: parseNumber(value, tempStyle.encoding),
                        })
                      }
                      options={encodingOptions.map((option) => ({
                        value: String(option.value),
                        label: option.label,
                      }))}
                    />
                  </Field>
                </div>
              </details>
            </div>
          ) : (
            <div className="rounded border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
              选择或新建样式以开始编辑
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={pendingRename !== null}
        title="重命名样式"
        description={
          pendingRename
            ? `样式「${pendingRename.oldName}」被脚本中 ${pendingRename.referencingCueCount} 条字幕引用。是否同步更新这些字幕的样式引用？`
            : ""
        }
        options={[
          { label: "是，同步更新", value: "yes", variant: "primary" },
          { label: "否，仅重命名样式", value: "no" },
          { label: "取消重命名", value: "cancel" },
        ]}
        escValue="cancel"
        onSelect={resolveRename}
      />
    </aside>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </label>
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
  return (
    <label className="flex items-center gap-2 rounded border border-border bg-surface-raised px-2 py-1.5 text-sm text-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}
