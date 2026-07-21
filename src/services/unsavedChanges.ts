import { confirm } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../stores/projectStore";

export async function confirmDiscardUnsavedChanges(): Promise<boolean> {
  if (!useProjectStore.getState().isDirty) return true;

  try {
    return await confirm("当前字幕尚未保存，继续将丢失这些更改。是否继续？", {
      title: "Hikaru Sub",
      kind: "warning",
    });
  } catch {
    return false;
  }
}
