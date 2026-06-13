# 隐私说明

SkiLens 是一个本地优先的桌面应用。它的设计目标是在本机分析 skill 使用情况，不把日志或 skill 文件上传到远端服务。

## SkiLens 会读取什么

SkiLens 可能读取：

- Claude 和 Codex 的 skill 目录。
- Claude 和 Codex 的本地会话日志。
- 已安装 skill 的 `SKILL.md` 文件。
- 已存在的旧版导出文件，例如 `usage-data.js` 和 `skill-usage-data.json`。

具体路径取决于你的本地工具安装方式和扫描器配置。

## SkiLens 会存储什么

SkiLens 会把本地应用数据存储在：

```text
~/Library/Application Support/skills-stats/
```

这里包含 SQLite 数据库和归档元数据，用于在重新扫描后保留隐藏的历史 skill。

SkiLens 也可能在 WebView 的 `localStorage` 中保存本地 UI 偏好，例如默认时间范围、主题偏好和最近搜索词。Tauri 插件也可能在本地应用目录中保存窗口状态、store 数据和日志。

## 网络使用

SkiLens 不需要账号，也不会把使用数据、日志、skill 内容或 `SKILL.md` 文件上传到远端服务。

开发模式会连接本机 Vite dev server：

```text
http://localhost:1420
```

Release 构建会使用打包后的前端资源。

## 删除和归档行为

- 归档会在 SkiLens 中隐藏 skill，并保留历史记录。
- 删除会把已安装 skill 目录移动到 `~/.Trash/skills-stats`。
- 没有当前安装路径的历史 skill 无法被 SkiLens 从磁盘删除。

## 敏感数据提醒

Claude/Codex 日志和 skill 文件可能包含提示词、文件路径、项目名、客户名、误粘贴的密钥或其他敏感内容。

在分享截图、导出 JSON、日志或 bug report 前，请先检查并脱敏。

## 安全问题

如果你发现隐私或安全问题，请按 [SECURITY.md](SECURITY.md) 处理。
