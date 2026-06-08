export function TranscribeView() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h2 className="text-xl font-semibold">ASR 转录</h2>
        <p className="mt-1 text-sm text-text-muted">
          提取音轨并使用本地 ASR 模型生成 ASS 字幕
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-surface-raised">
        <p className="text-text-muted">转录工作流即将实现</p>
      </div>
    </div>
  );
}
