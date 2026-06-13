# 安装文档

本文说明如何从 Release 安装 SkiLens，或从源码构建。

## 支持平台

SkiLens 当前主要面向 macOS。

推荐环境：

- macOS 13 或更新版本。
- Apple Silicon 或 Intel Mac。

更旧的 macOS 版本可能可以运行，但暂时不在常规测试范围内。

## 从 DMG 安装

1. 从 GitHub Releases 下载最新 `.dmg`。
2. 打开 `.dmg`。
3. 把 SkiLens 拖到 Applications。
4. 打开 SkiLens。

如果 macOS 因为应用未签名或未公证而阻止打开：

1. 打开 **系统设置**。
2. 进入 **隐私与安全性**。
3. 允许 SkiLens 打开。

也可以右键 SkiLens，选择 **打开**。

## 从源码构建

安装前置依赖：

- Node.js 20 或更新版本。
- Rust stable toolchain。
- Xcode Command Line Tools。

安装依赖：

```bash
npm install
```

开发模式运行：

```bash
npm run tauri:dev
```

构建 Release app 和 DMG：

```bash
npm run tauri:build
```

构建产物位置：

```text
src-tauri/target/release/bundle/
```

## 本地数据位置

SkiLens 会把本地数据存储在：

```text
~/Library/Application Support/skills-stats/
```

这里包含 SQLite 数据库和归档元数据。

## 常见问题

### 应用打开后没有数据

先在左侧栏手动重新扫描。如果仍然没有数据，请确认本机存在 Claude/Codex 日志和 skill 目录。

### macOS 提示应用已损坏或无法打开

这通常是因为应用未签名或未公证。本地构建时可以使用右键 **打开** 流程。

### 构建失败，提示缺少 Rust

安装 Rust 后重启 shell：

```bash
rustup update stable
```

### 构建失败，提示缺少 Xcode 工具

安装命令行工具：

```bash
xcode-select --install
```
