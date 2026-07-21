import { confirm } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../stores/projectStore";

export interface DiscardUnsavedChangesDecision {
  proceed: boolean;
  recoveryVideoPath: string | null;
}

export async function confirmDiscardUnsavedChanges(): Promise<DiscardUnsavedChangesDecision> {
  const state = useProjectStore.getState();
  if (!state.isDirty) {
    return { proceed: true, recoveryVideoPath: null };
  }

  try {
    const proceed = await confirm(
      "当前字幕尚未保存，继续将丢失这些更改。是否继续？",
      {
        title: "Hikaru Sub",
        kind: "warning",
      },
    );
    return {
      proceed,
      recoveryVideoPath: proceed ? (state.session?.videoPath ?? null) : null,
    };
  } catch {
    return { proceed: false, recoveryVideoPath: null };
  }
}
