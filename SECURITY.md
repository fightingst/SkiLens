# 安全策略

## 支持版本

SkiLens 目前仍处于 1.0 之前。安全修复会优先进入最新的 `main` 分支和最新发布版本。

## 报告漏洞

请不要在公开 issue 中披露漏洞细节。

如果仓库已开启 GitHub private vulnerability reporting，请优先使用该流程。如果还没有开启，请创建一个标题为 `安全联系请求` 的公开 issue，但不要写任何漏洞细节。维护者会提供私下沟通渠道。

报告时请包含：

- 问题简述。
- 复现步骤。
- 可能影响。
- 受影响版本或 commit SHA。
- 已脱敏的日志或截图。

## 重点安全范围

以下区域属于安全敏感范围：

- 本地文件扫描。
- 路径校验。
- skill 删除和移动到废纸篓逻辑。
- SQLite 数据库写入。
- 归档持久化。
- `SKILL.md` 预览和 Finder reveal 命令。
- Tauri filesystem、opener、dialog、store、log、window-state 权限。

## 隐私提醒

SkiLens 会处理本地日志和 skill 文件。这些文件可能包含敏感提示词、项目路径、密钥和客户数据。提交问题前请先脱敏。
