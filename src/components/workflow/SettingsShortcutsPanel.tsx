import { useState } from "react";
import { RotateCcw } from "lucide-react";
import type { EditorHotkeyOverride } from "../../types";
import {
  EDITOR_HOTKEYS,
  applyEditorHotkeyOverrides,
  findHotkeyConflicts,
  formatHotkeyLabel,
  groupHotkeysByCategory,
  hotkeyOverrideFromEvent,
  isSameHotkeyBinding,
} from "../editor/hotkeys";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsSection } from "./settingsForm";

interface SettingsShortcutsPanelProps {
  overrides: EditorHotkeyOverride[];
  onChange: (overrides: EditorHotkeyOverride[]) => void;
}

export function SettingsShortcutsPanel({
  overrides,
  onChange,
}: SettingsShortcutsPanelProps) {
  const [recordingError, setRecordingError] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const effective = applyEditorHotkeyOverrides(overrides);
  const conflicts = findHotkeyConflicts(overrides);
  const groups = groupHotkeysByCategory(effective);

  const restoreDefault = (id: string) => {
    setRecordingError((current) => (current?.id === id ? null : current));
    onChange(overrides.filter((item) => item.id !== id));
  };

  const record = (id: string, event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const override = hotkeyOverrideFromEvent(id, event.nativeEvent);
    if (!override) return;

    const defaultDef = EDITOR_HOTKEYS.find((def) => def.id === id);
    if (!defaultDef) return;
    const next = overrides.filter((item) => item.id !== id);
    if (
      !isSameHotkeyBinding(override, {
        key: defaultDef.key,
        ctrl: !!defaultDef.ctrl,
        alt: !!defaultDef.alt,
        shift: !!defaultDef.shift,
      })
    ) {
      next.push(override);
    }

    const conflict = findHotkeyConflicts(next).find((item) =>
      item.ids.includes(id),
    );
    if (conflict) {
      const otherId = conflict.ids.find((item) => item !== id);
      const other = EDITOR_HOTKEYS.find((def) => def.id === otherId);
      setRecordingError({
        id,
        text: `快捷键 ${conflict.label} 已用于“${other?.description ?? "其他操作"}”`,
      });
      return;
    }

    setRecordingError(null);
    onChange(next);
  };

  return (
    <SettingsSection title="字幕编辑器快捷键" desc="管理字幕编辑器中的按键组合">
      {conflicts.length > 0 ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          当前快捷键配置存在冲突，请重新设置或恢复默认值后再保存。
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={overrides.length === 0}
          onClick={() => {
            setRecordingError(null);
            onChange([]);
          }}
        >
          <RotateCcw />
          恢复默认值
        </Button>
      </div>

      {[...groups.entries()].map(([category, defs]) => (
        <section key={category} className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-text-muted">{category}</h4>
          <div className="divide-y divide-border rounded-md border border-border">
            {defs.map((def) => {
              const hasOverride = overrides.some((item) => item.id === def.id);
              const persistedConflict = conflicts.find((item) =>
                item.ids.includes(def.id),
              );
              const error =
                recordingError?.id === def.id
                  ? recordingError.text
                  : persistedConflict
                    ? `快捷键 ${persistedConflict.label} 与其他操作冲突`
                    : null;
              return (
                <div
                  key={def.id}
                  className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-text">{def.description}</p>
                    {error ? (
                      <p className="mt-1 text-xs text-danger" role="alert">
                        {error}
                      </p>
                    ) : null}
                  </div>
                  <Input
                    readOnly
                    aria-label={`${def.description} 快捷键`}
                    aria-invalid={!!error}
                    value={formatHotkeyLabel(def)}
                    onKeyDown={(event) => record(def.id, event)}
                    className="cursor-pointer text-center font-mono"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!hasOverride}
                    aria-label={`恢复${def.description}默认快捷键`}
                    title="恢复默认"
                    onClick={() => restoreDefault(def.id)}
                  >
                    <RotateCcw />
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </SettingsSection>
  );
}
