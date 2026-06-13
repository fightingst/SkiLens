# 更新日志

SkiLens 的重要变更会记录在这里。

项目目前处于 1.0 之前。任何扫描器语义、删除行为、归档行为、数据格式兼容性变化都必须明确写出。

## [Unreleased]

暂无。

## [0.0.1] - 2026-06-12

### 新增

- 初始 Tauri 2 迁移基线。
- React 18 + TypeScript 前端。
- Rust 扫描器和本地数据命令。
- 总览、分类、冷启动、技能详情视图。
- 真实数据截图和中文开源项目文档。
- 隐私、安全、贡献、安装、发布文档。
- GitHub issue 模板、PR 模板、CI workflow、Release workflow。
- 本地归档持久化。
- 旧版 JSON / JS 导出兼容。

### 变更

- README 改为面向中文用户和贡献者的项目首页。
- 分类从平台型“飞书 / Lark”调整为更通用的“办公协作”。
- 重新扫描改为后台阻塞线程执行，降低 UI 卡顿。
- Bundle identifier 改为 `com.fightingst.skilens`。

### 保留

- 斜杠命令和显式 Skill tool_use 调用语义。
- 同一会话中斜杠命令优先。
- 辅助信号只作为 evidence。
- 插件缓存排除。
- 归档隐藏历史跨重新扫描保留。
