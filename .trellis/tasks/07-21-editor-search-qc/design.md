# 设计：编辑页字幕查找替换、筛选与质检

## 边界与分层

- **纯逻辑**（可单测，不依赖 React）：
  - `src/utils/subtitleSearch.ts`：匹配/筛选/替换/定位。
  - `src/utils/subtitleQc.ts`：质检规则（无 tight-gap）。
  - 重叠判定可导出 `cuesOverlap(a, b)` / `collectOverlappingCueIds(cues, activeId)` 放在 `subtitleQc.ts`（或同文件轻量 helper），供列表与质检复用。
- **UI**：
  - `src/components/editor/SubtitleFindPanel.tsx`（查找替换 + 筛选 + 质检列表，Tabs 分区），挂在编辑页右上字幕列表上方。展开时整体（头栏 + 内容）渲染为**悬浮卡片**浮在字幕列表上方，不占文档流高度。
  - `SubtitleList.tsx`：活动选中行的重叠行整行高亮。
- **状态**：查找条件与面板开关为组件本地状态，不进 projectStore；上一处/下一处依据 `selectedCueId` 在当前命中集合中即时计算；质检结果与重叠 id 集合是 `useMemo` 派生，不存 store。
- **历史**：全部替换复用 `projectStore.replaceCues(newCues)` —— 该 action 已把整次列表替换提交为单条历史记录（`commitNormalMutation`），天然满足「一次撤销」。无需新增 store action。

## 数据流

### 查找替换

```
SubtitleFindPanel (query/filters/replaceText)
  → collectMatches(cues, query, filters)      // subtitleSearch.ts，返回 cueId[]
  → 下一处/上一处: 依据 selectedCueId 在结果中循环定位
       → playbackStore.setSelectedCueId + setCurrentTime(cue.startMs)（与列表点击一致，同步移动播放头）
       → SubtitleList 已有「选中行滚动可见」能力（scrollIntoView 于选中变化）
  → 替换当前: updateCue(id, { primaryText: replaced })
  → 全部替换: 一次性 map 出新 cues → replaceCues(newCues)
```

- 匹配语义：`primaryText` 子串匹配，默认忽略大小写；空 query + 有筛选条件时，筛选结果本身作为「命中集合」（支持纯筛选定位）。
- 替换文本按字面替换（不解释 `$1` 等语法）。

### 筛选条件

```ts
interface SubtitleFilters {
  style?: string        // undefined = 全部
  emptyOnly?: boolean
  timeRange?: { startMs?: number; endMs?: number }  // 与 cue 区间相交即命中
}
```

时间输入复用 `src/utils/timeInput.ts` 的 `H:MM:SS.cc` 解析/格式化，不新写时间解析。

### 质检

```ts
interface QcIssue {
  cueId: string;
  rule: QcRule;         // 'empty' | 'bad-timing' | 'beyond-duration' | 'overlap' | 'high-cps' | 'long-line' | 'many-lines' | 'unknown-style'
  message: string;      // 中文简述，含行号；全部 issue 在 UI 中按警告展示
}
runQcChecks(cues, opts: { durationMs: number; knownStyles: readonly string[] }): QcIssue[]
```

- 阈值集中在文件头常量：`CPS_MAX = 20`、`LINE_MAX_CHARS = 42`、`LINES_MAX = 2`。**不再**使用 `GAP_MIN_MS` / `tight-gap`。
- CPS 与行长统计基于剥离 ASS override 标签后的纯文本（`stripAssTags`）。
- 重叠检测：按 `startMs` 排序后做 **max-end 扫描**（维护当前最大 end；下一行 start < max-end 即重叠），不只做相邻对比较——否则漏报嵌套/非相邻重叠（如 A 包住 B、C 时 C 与 A）。每行最多报一次，O(n log n)。
- `durationMs <= 0`（未加载视频）时跳过 R3.3。

### 列表重叠高亮

```
selectedCueId + cues
  → collectOverlappingCueIds(cues, selectedCueId)  // 不含自身
  → SubtitleList 行 class：
       selected > overlap > hover
```

- 重叠定义：半开/闭区间统一为 `a.startMs < b.endMs && b.startMs < a.endMs`（与质检一致；`end==start` 触碰不算重叠）。
- 样式：`bg-danger/10 text-danger ring-1 ring-inset ring-danger/35`，使用深浅色语义令牌，不硬编码色值。
- 选中行：保持 `bg-primary/10 ring-primary`，即使它与别的行重叠也不改成 danger（重叠方是「别人相对我」）。

## UI 结构

```
EditorView 右列
  ├─ SubtitleFindPanel（固定 h-7 relative 槽位保持列表高度；同一个头栏/卡片 wrapper 展开时切为 absolute 悬浮卡片，Ctrl+F / 点头栏打开并聚焦查找框，Esc 关闭）
  │    卡片: rounded-lg border bg-popover/80 shadow-xl ring-1 ring-foreground/10 backdrop-blur-sm
  │         max-h-[min(60vh,480px)] 约束整张卡片，内容区内部滚动
  │         单一头栏 DOM；固定 h-7 relative 槽位使展开/收起时列表高度不跳变
  │    Tabs: [查找替换] [质检 (n)]
  │    查找替换: 纵向堆叠为主，「查找/替换为」与「时间起/时间止」各 grid-cols-2 一行两列
  │      样式 Select 全宽；「仅空文本」单独一行；按钮 grid-cols-2 两组
  │    质检: issue 列表（规则名 + #行号 + 简述），点击定位并移动播放头
  └─ SubtitleList（行级重叠高亮）
```

- 组件一律用现有 shadcn/ui（Input、Button、Select、Checkbox、Tabs），包括头栏和质检问题项按钮；图标用 `lucide-react`。
- 浮层背景用语义化的 `bg-popover`（深色下比 card 亮一档，天然分层），不用手写色值。
- 快捷键：`hotkeys.ts` 注册 `ctrl+f`（global scope）→ 打开面板并聚焦 query 输入；任何路径打开都统一走 `openAndFocusPanel` 聚焦查找框，确保 Esc 从卡片内部冒泡。面板内 Enter=下一处，Shift+Enter=上一处，Esc=关闭（卡片 onKeyDown 捕获 Esc + stopPropagation，不触发编辑器文本会话回滚；关闭后焦点落回 body，不做焦点回收以避免头栏 focus 环）。
- 选中行滚动：复用 SubtitleList 对 `selectedCueId` 的 scrollIntoView（命中行落在列表中部，不被浮层盖住）。

## 兼容性 / 风险

- Tabs 根节点必须纵向堆叠（`data-[orientation=horizontal]:flex-col`）。shadcn 默认的 `data-horizontal:` 不匹配 Radix 的 `data-orientation`，会导致 TabsList 与 TabsContent 横排。全仓库 Tabs 消费者仅 StyleManager（显式 `flex-col`，不受影响）与本面板。
- 面板展开为悬浮卡片，不压缩列表可视区；卡片 `max-h` 为视口相对值，列表窗格拖到极矮时卡片底部会被窗格 `overflow-hidden` 裁掉（可接受，拉大窗格即可）。
- `locate` 的 `setCurrentTime` 与列表点击选中行为一致；HTML video seek 不暂停播放，VideoPlayer 有 100ms 播放死区防 rAF 回写引发 seek 循环。
- `replaceCues` 在 no-op 时不污染历史；全部替换前若无命中则不调它。
- 质检 / 重叠集合 O(n)，数千行无需 Worker。
- 视频时长取 `playbackStore.durationMs`；未加载时 R3.3 跳过。

## 验证

- `subtitleSearch.test.ts`、`subtitleQc.test.ts`（含「无 tight-gap」、重叠 helper）。
- `pnpm test` + `pnpm build`。
