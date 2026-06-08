export function BurnView() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h2 className="text-xl font-semibold">字幕压制</h2>
        <p className="mt-1 text-sm text-text-muted">
          使用 FFmpeg 将字幕硬压或软封到视频
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-surface-raised">
        <p className="text-text-muted">压制工作流即将实现</p>
      </div>
    </div>
  );
}
