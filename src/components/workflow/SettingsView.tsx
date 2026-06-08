export function SettingsView() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h2 className="text-xl font-semibold">设置</h2>
        <p className="mt-1 text-sm text-text-muted">
          FFmpeg 路径、ASR 引擎、翻译 API 等全局配置
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-surface-raised">
        <p className="text-text-muted">设置页即将实现</p>
      </div>
    </div>
  );
}
