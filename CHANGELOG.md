# Changelog

## [1.4.1] - 2026-03-06

### ✨ 架构重构与测试闭环 (Architecture & Testing)

- **RAG 检索流水线化 (Retrieval Pipeline)**:
  - 弃用 `Retriever.ts` 中堆砌的检索组装逻辑，成功将其解耦为由 `WorkflowEngine` 驱动的四个标准化单元 (`VectorRetrieveStep`, `RerankMergeStep`, `BrainRecallStep`, `RecordRecallLogStep`)。
  - 数据与配置上下文通过 `JobContext` 规范流通，实现高度可拔插。
- **批量任务引擎抽象 (Batch Engine)**:
  - 废除了曾经作为万能入口但日渐臃肿的 `BatchProcessor.ts` 单体。
  - 抽离出更底层的 `BatchEngine`，专职接管任务生命周期、并发锁以及 UI 进度节流通知。
  - 将庞大的“历史扫描与纯文本导入”业务下推为独立的 `TaskHandler` （如 `HistoryTask`）。
- **编译修复与全链路集成测试**:
  - 全面清扫了从老接口强转过程带来的 TypeScript 报错，实现 `npm run build` 零 Error。
  - 引入了 `retrieval-workflow.test.ts` 以及 `batch-engine.test.ts` 并在不调用实际模型的前提下确保了整条数据传输总线（Pipeline）一次通过集成模拟测试。


## [1.4.0] - 2026-03-05

### ✨ Agentic RAG 交互与批量数据处理升级 (Agentic UI & Data Batching)

- **Agentic 召回决策审阅 (Recall Decision Modal)**:
  - 引入了全新的独立弹窗组件，支持在 Agentic Dry Run 后检阅大模型（LLM）激活的事件，并展示对应的评分（Score）与理由（Reason）。
  - 下半区内置了基于 `react-virtuoso` 构建的虚拟滚动列表，支撑海量“未激活”归档事件的高性能渲染。
  - 为未激活列表配备了便捷的 `[低] [中] [高]` Ghost 按钮与自定义分值输入框，支持随手一键添加未命中事件并即时赋分。
- **Message Review 适配 Agentic RAG**:
  - 消息审核组件 (`MessageReview`) 新增 Agentic 专属展现区块，自动识别并微缩展示命中决策。
  - 增设了「查看 / 编辑」入口，允许终端用户在使用完整预处理流时，随时召出决策面版干预 LLM 对 RAG 的选用。
- **数据级归档解耦 (Data-Level Archiving)**:
  - 取消了归档操作与“对话楼层 (Floor)”的耦合绑定。在批处理面板底部新建了独立的数据级操作区 `DataBatchSection`。
  - 现在支持一键扫描全库结构，并统一把所有“已完成向量化但尚未归档”的 level 0 事件批量归入历史档案。
- **Agentic Dry Run 链路真实化**:
  - 修复了此前预处理干跑测试只执行一半的问题，现在 Dry Run 测试直接连通完整的 `agenticSearch`，不仅验证提示词，也会真实写入 Dev Log。
  - Recall 日志面板同步升级，为 Agentic 测试增加了标志性的橙色边框以及详细的「思考理由」文本展示。
- **UI 布局与 Prompt 优化**:
  - 修复了 LLM 预设配置页刷新模型按钮在桌面端被挤出视口的 Bug（已移动至字段标签旁并转为无框极简图标）。
  - 清理了 `agentic_recall.yaml` 模板中多余的 `<output>` 指令区，强制 LLM 将解析力集中于 `<recall_decision>`。

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


