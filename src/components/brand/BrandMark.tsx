import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

/** 应用内透明品牌字形（无方底）。系统任务栏图标请用 src-tauri/icons。 */
export function BrandMark({
  className,
  title = "Hikaru Sub",
  ...props
}: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 128 128"
      role="img"
      aria-label={title}
      className={cn("shrink-0", className)}
      {...props}
    >
      <title>{title}</title>
      <defs>
        <linearGradient
          id="brandMarkHGrad"
          x1="36"
          y1="28"
          x2="92"
          y2="84"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path
        fill="url(#brandMarkHGrad)"
        d="M34 26h18c2.2 0 4 1.8 4 4v22h16V30c0-2.2 1.8-4 4-4h18c2.2 0 4 1.8 4 4v56c0 2.2-1.8 4-4 4H76c-2.2 0-4-1.8-4-4V68H56v18c0 2.2-1.8 4-4 4H34c-2.2 0-4-1.8-4-4V30c0-2.2 1.8-4 4-4z"
      />
      <rect x="32" y="94" width="64" height="12" rx="3" fill="#e2e8f0" />
      <rect x="40" y="98" width="30" height="4" rx="2" fill="#0b1220" />
    </svg>
  );
}
