import {
  Select as SelectRoot,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * 受控单层下拉：保留旧 Select 组件的简洁 API，内部改用 shadcn/Radix select 原语，
 * 以获得无障碍、键盘导航、Portal 与动画支持。跨平台深色样式由语义令牌统一。
 */
export function Select({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  /** value 不在 options 中时显示的文本；缺省回退显示原始 value */
  placeholder?: string;
  /** 透传到 SelectTrigger，用于控制宽度等布局 */
  className?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <SelectRoot value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className ?? "w-full"}>
        <SelectValue placeholder={selected ? undefined : (placeholder ?? value)}>
          {selected ? selected.label : (placeholder ?? value)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
