import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";

export function ImportView() {
  const setStep = useUiStore((s) => s.setStep);
  const project = useProjectStore((s) => s.project);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h2 className="text-xl font-semibold">导入视频</h2>
        <p className="mt-1 text-sm text-text-muted">
          选择视频文件，将在同目录创建 .hikaru 项目文件夹
        </p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-raised p-12">
        {project ? (
          <div className="text-center">
            <p className="text-sm text-text-muted">当前项目</p>
            <p className="mt-2 font-mono text-sm text-text">{project.videoPath}</p>
            <button
              type="button"
              onClick={() => setStep("transcribe")}
              className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted"
            >
              继续转录
            </button>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-text-muted">拖放视频文件到此处，或点击选择</p>
            <button
              type="button"
              disabled
              className="mt-4 rounded-lg bg-accent/50 px-4 py-2 text-sm font-medium text-white/70"
            >
              选择视频（即将实现）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
