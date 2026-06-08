export function EditorView() {
  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr] grid-rows-[1fr_200px] gap-px bg-border">
        <div className="col-start-1 row-start-1 overflow-auto bg-surface-raised p-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
            字幕列表
          </h3>
          <p className="text-sm text-text-muted">暂无字幕</p>
        </div>
        <div className="col-start-2 row-start-1 flex items-center justify-center bg-surface p-4">
          <p className="text-text-muted">视频预览区</p>
        </div>
        <div className="col-span-2 row-start-2 overflow-auto bg-surface-raised p-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
            时间轴
          </h3>
          <div className="h-24 rounded border border-border bg-surface" />
        </div>
      </div>
    </div>
  );
}
