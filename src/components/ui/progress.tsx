import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const indeterminate = value === null || value === undefined
  const clamped = indeterminate ? 0 : Math.max(0, Math.min(100, value))
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={indeterminate ? null : clamped}
      className={cn(
        "relative flex h-2 w-full items-center overflow-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full bg-primary transition-all",
          indeterminate ? "w-1/3 animate-pulse rounded-full" : "w-full flex-1"
        )}
        style={
          indeterminate
            ? undefined
            : { transform: `translateX(-${100 - clamped}%)` }
        }
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
