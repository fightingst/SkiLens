# 贡献指南

感谢你愿意改进 SkiLens。

SkiLens 是一个 Tauri 2 macOS 应用，后端使用 Rust，前端使用 React 18 + TypeScript。扫描器行为会尽量保守，因为它需要兼容原 Python MVP 的统计语义。

## 开发环境

需要：

- macOS 13 或更新版本。
- Node.js 20 或更新版本。
- Rust stable toolchain。
- Xcode Command Line Tools。

安装依赖：

```bash
npm install
```

启动桌面应用：

```bash
npm run tauri:dev
```

## 检查命令

运行全部标准检查：

```bash
npm run check
```

单独运行：

```bash
npm run build
npm run test:rust
cargo test --manifest-path src-tauri/core/Cargo.toml
```

## 代码结构

```text
src/                         前端应用
src/components/              通用 React 组件
src/components/views/        页面级视图
src/lib/                     前端 API、偏好设置和数据处理
src-tauri/                   Tauri 应用壳、命令和配置
src-tauri/core/              扫描器逻辑和兼容性测试
```

更完整的数据流和模块边界见 [架构说明](docs/ARCHITECTURE.md)。

## 扫描器兼容性规则

如果要改以下规则，必须同步更新 `src-tauri/core/tests/scanner_compat.rs`：

- 只有斜杠命令和显式 `Skill` / `skill` tool_use 计为调用。
- 同一会话里，斜杠命令优先于 Skill tool_use。
- 辅助信号只作为 evidence，不计调用。
- 插件缓存目录不识别为已安装 skill。
- 归档隐藏历史跨重新扫描保留。
- 旧版 JSON / JS 导出保持兼容。

## PR 检查清单

提交 PR 前请确认：

- 已运行 `npm run check`。
- 扫描器行为变更已补兼容性测试。
- UI 改动符合当前 macOS source-list 风格。
- 行为变更 PR 不混入无关重构。
- 用户可见变更已更新 `CHANGELOG.md`。
- 安装、隐私或行为说明变更已更新 README 或 docs。

## Commit 风格

使用简短的祈使句：

```text
Add cold-start archive controls
Fix dark-mode sidebar hover states
Document local data storage
```

## 报告 Bug

请使用 bug report issue 模板，并提供：

- macOS 版本。
- SkiLens 版本或 commit SHA。
- 使用的是 Release 构建还是 `npm run tauri:dev`。
- 复现步骤。
- 必要时附截图。

不要上传包含隐私数据的原始日志。
