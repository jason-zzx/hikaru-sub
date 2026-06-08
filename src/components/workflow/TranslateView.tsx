export function TranslateView() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <header>
        <h2 className="text-xl font-semibold">AI 翻译</h2>
        <p className="mt-1 text-sm text-text-muted">
          通过大模型 API 批量翻译，生成双语 ASS 字幕
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-surface-raised">
        <p className="text-text-muted">翻译工作流即将实现</p>
      </div>
    </div>
  );
}
