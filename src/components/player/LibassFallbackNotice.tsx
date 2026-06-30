interface LibassFallbackNoticeProps {
  reason?: string;
}

export function LibassFallbackNotice({ reason }: LibassFallbackNoticeProps) {
  return (
    <div className="absolute left-2 top-2 z-10 rounded-md border border-warning/40 bg-black/70 px-2 py-1 text-xs text-warning">
      libass 预览不可用，已回退 CSS 近似预览
      {reason ? `：${reason}` : ""}
    </div>
  );
}
