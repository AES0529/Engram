# Changelog

## [1.3.4] - 2026-03-03

### ✨ 批处理与核心机制重构 (Batch Processing Refactoring)

- **交叉双轨流水线 (Interleaved Pipeline)**:
  - 彻底重构了 `BatchProcessor.ts` 从历史消息中提取任务的机制。现在，当同时选择了“剧情总结”和“实体提取”时，提取任务将完美“借用”总结的分块尺度，形成相邻交织等待的精练队伍。
  - 杜绝了旧版中由于队列剥离引发的“极细碎实体段落轰炸”，并完全保持了 UI 触发任务种类选择的独立性。
- **基于单核持久化的状态复原**:
  - `BatchProcessor` 的执行进度指针被简化，将彻底信任并回归向 `memoryStore` 及 `IndexedDB` 要数据。由于底层入库时必定自动存下 `last_extracted_floor`，意外暂停后点击继续，即可享受**天然的免重复断点续传**。
- **局部错误宽容 (Fault Tolerance)**:
  - 现在任何因为 LLM 抽风而崩溃的小抛块，只会产生一条警告日志即被 `continue` 跳过，彻底防范了局部失败导致整个跑批挂起的连锁瘫痪。
- **订阅式进度事件下发**: 给内核装配了 `subscribe` 和 `notifyProgress` 回调能力，淘汰了 `useWorkflow` hook 中耗时的 500ms 重负荷轮询定时器。

### 🎨 UI 界面与交互体验 (UI Fixes & Tweaks)

- **流光渲染的多级处理面板**: `BatchProcessingPanel.tsx` 引入了具有 `bg-primary` 进度色彩反馈与多层级指标高亮的细致结构，并且附带了 `shimmer` 的持续流处理光效动画。
- **防止实体审核器膨胀**: `EntityReview.tsx` 页面内负责预览 "新烧录文本" (YAML) 的视窗，增加 `overflow-y-auto` 和 `break-words max-w-full` 对策，修复了产生超长连绵英文句子撑破网格设计、发生横向视差的 UI 崩塌事故。


## [1.3.3] - 2026-03-02

### ✨ 新特性与改进 (Features & Improvements)

- **文本层级色彩体系 (Text Hierarchy Coloring)**:
  - 引入了全新的 6 色语义文本色彩系统（`heading`, `label`, `meta`, `link`, `value`, `emphasis`）。
  - 替代了原有的 `text-green-500` 等硬编码颜色，大幅提升了浅色/深色主题的切换体验与视觉一致性。
  - 为内置的 10 套主题（Catppuccin、Nord、Everforest 等）全量适配了对应的色板色彩，确保不受毛玻璃背景降低亮度的影响。
  - Dashboard、事件卡片、实体编辑器、表单页面等核心组件已全面应用该规范。

## [1.3.2] - 2026-03-02

### 🔧 重构 (Refactoring)

- **表单布局重写与统一**:
  - 全面彻底移除 `NumberField` 内部自带滑块的耦合组件设计，现在它仅负责纯展示强数字输入职能。
  - 在 `LLMPresetForm` (API预设) 页面中使用了类似 `SummaryPanel` 的 **自然语言指引式表单样式**（例如 "模型的温度为 (输入框)"），结合独立的 `SliderField` 组合，大大增强了参数阅读引导感。
  - 移除了包含在 `EntityConfigPanel` 等页面中手工模拟的纯背景滑槽，一律换用官方的独立 `SliderField`。
- **去除冗余的 Virtuoso**:
  - `ModelLog` 和 `RecallLog` 由于展示量级属于中低频即插即用的日志等级（非持久化），彻底剥离了 `react-virtuoso` 虚拟列表。
  - 解决了由于原生 Flex 弹性布局的渲染时延导致虚拟列表偶然性计算出 0 高度所引发的页面“坍缩白屏”问题。
- **状态同步监控降频**：为了降低过度激进的 UI 热更新引发的无效重绘和风扇狂转卡顿，将快速操作控制面板 `QuickPanel.tsx` 中向远端同步状态的 `setInterval` 频率从每秒钟一次放松至每 3 秒钟一次。

### 🚀 架构优化 (Architecture Improvements)

- **Embedding 多源对接层剥离**：彻底将过度增殖至将近七百行的 `EmbeddingService.ts` 解耦。建立专职对接口 `EmbeddingClient.ts` 进入 integrations 下管理所有的诸如 OpenAI/Ollama 等的请求格式和 fetch 交互操作，使其回归单纯批次分配控制器的本源角色。
- **环境宏预载入基座拆分**：将负责向 Prompt 中填装环境背景的宏指令池 `macros.ts` 当中最消耗心智与篇幅的长篇代码抽离，分解为两项独立的职能服务：`chatHistory.ts` (历史管理、正则清理代理) 与 `ejsProcessor.ts` (接管底层 ST 内置的 EJS 渲染)，有效化解了上帝类陷阱。

### 🐛 修复 (Bug Fixes)

- **并发实体入库流量管控**：修复了在提取巨量实体节点时触发 `Promise.all` 的无差别广播查询更新，引发瞬间并发撑爆 IndexedDB 导致堵塞白屏的隐患，引入了每 50 批次为一个限流循环的发送保护策略。

- **空指针与防白错误隔离**:
  - 为 `EventEditor.tsx` 在处理记忆节点中部分历史数据异常残缺（例如缺少 `structured_kv`）造成的空指针增加可选链探测 (`?.`) 容错。
- **定时器与事件闭包泄露**:
  - 重构 `useDashboardData.ts` 引入 `useRef`，以避免长期挂机的酒馆环境在可见性 (`visibilitychange`) 多次切换时导致轮询 Timer 的旧实例驻留在内存闭包中。
- **Vite 机制重合修补**:
  - 给 `KeyboardManager.ts` 等全局实例在触发 HMR 热重载时补偿了注销流程 (`import.meta.hot.dispose`)。
  - 优化了由于连续触发载入导致的重复 DOM 事件侦听累加，彻底转正了在 `index.tsx` 和 UI 接口层中针对快速切换角色的挂载回收容错能力。

## [1.3.1] - 2026-03-01

### 🔧 重构 (Refactoring)

- **SliderField 原子组件抽离**:
  - 将散落在 `FormComponents.NumberField` 和 `SummaryPanel` 中的内联滑块实现，统一抽取为独立的 `SliderField` 原子组件 (`src/ui/components/core/SliderField.tsx`)。
  - 采用 **隐藏原生 input + 纯 div 渲染** 方案（类似 `Switch` 组件），彻底规避 SillyTavern 全局 CSS 对 `input[type=range]` 的样式覆盖问题。
  - `SummaryPanel` 四处滑块（Token 阈值、活跃事件数、层间隔、缓冲层数）及 `NumberField` 的可选滑块均已迁移至该组件。

### 🐛 修复 (Bug Fixes)

- **记忆编辑视图白屏修复**: 恢复 `MemoryStream` 根容器的 `absolute inset-0` 定位，解决因 `MainLayout` 中 `min-h-full` wrapper 无法向子级传递确定高度而导致 `react-virtuoso` 虚拟列表高度塌陷为 0 的问题。
- **移动端全屏表单透底修复**: `MobileFullscreenForm` 的 Portal 容器增加 `backdrop-blur-3xl` 与 `bg-background/95`，修复部分透明主题下底层内容透出的视觉干扰。
- **记忆编辑页面内边距**: 给 `MemoryStream` 外层容器补充 `p-4 md:p-6` 响应式内边距，与其他页面（如 API 预设、设置）保持一致的留白。


