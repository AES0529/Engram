# Changelog

## [1.3.5] - 2026-03-05

### 🐛 稳定性修复与重构 (Bug Fixes & Refactoring)

- **无框环境隔离修复 (Borderless Guard)**:
  - 修复了防抖和异步闭包竞争导致的 `EntityEditor` JSON 数据相互污染、甚至出现空 `{}` 数据误覆盖的致命缺陷。遇到错误 JSON 语法时强行中断后续链路避免冲掉配置。
- **并发状态分离 (State Segregation)**:
  - `MemoryStream` 重构列表刷新机制，引入独立内存区 `pendingChanges` 记录列表界面即时的更改，避免高速点击修改时由于旧实例覆写所带来的真实数据覆盖问题。
- **UI渲染减负**:
  - `EventEditor` 中的评分滑动条，修改其逻辑，只在 `onMouseUp` 和 `onTouchEnd` 回弹才触发面向整个 React 顶层树的全量同步状态更新，拖拽时仅在本机做本地更新。大幅度消除了无意义的连贯 Context 穿透重算 (帧数从 21fps 飙升至满帧)。
- **批处理防坠毁**:
  - `BatchProcessor` 的 `Summary` 执行被统一调整为具备健壮性的静默跳过（同 `Trim`/`Embed`）。单条内容的失败现只会将本子项归类到 `skipped` 并继续整个长数组，而不是直接 `throw Error` 让全列车出轨宕机。
- **类脑存储复用度清理**:
  - 移除了 `BrainRecallCache` 内无效的历史包裹体 `evict()`，将其与 `enforceShortTermLimit()` 合二为一，消除功能层叠。
- **抽离与治理**：把冗长的钩内计算统归至外部纯函数 `streamProcessors.ts`；追加了尝试通过旧方式导入文件未保存时，给到阻断性提示。

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


