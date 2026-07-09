import { BrandMark } from "../brand/BrandMark";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/button";

export function WelcomeView() {
  const setStep = useUiStore((s) => s.setStep);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center text-center">
        <BrandMark className="mb-4 size-16" />
        <h2 className="text-3xl font-bold text-text">Hikaru Sub</h2>
        <p className="mt-2 max-w-md text-text-muted">
          AI 转录 · AI 翻译 · 字幕编辑 · 一键压制
        </p>
      </div>

      <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          { step: "import" as const, title: "导入视频", desc: "选择视频并准备会话" },
          { step: "transcribe" as const, title: "ASR 转录", desc: "本地模型生成字幕" },
          { step: "translate" as const, title: "AI 翻译", desc: "批量生成双语字幕" },
          { step: "editor" as const, title: "校对编辑", desc: "时间轴与样式调整" },
        ].map((card) => (
          <Button
            key={card.step}
            type="button"
            variant="outline"
            onClick={() => setStep(card.step)}
            className="h-auto flex-col items-start gap-2 whitespace-normal rounded-xl p-5 text-left hover:border-accent/50"
          >
            <h3 className="text-base font-medium text-text">{card.title}</h3>
            <p className="text-sm text-text-muted">{card.desc}</p>
          </Button>
        ))}
      </div>
    </div>
  );
}
