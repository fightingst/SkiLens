# GitHub 仓库设置清单

这些设置不能完全通过仓库文件表达，需要在 GitHub 仓库页面中手动配置。

## 仓库描述

建议描述：

```text
本地优先的 macOS Claude Code / Codex skill 使用统计看板。
```

## Topics

建议 topics：

```text
tauri
tauri-app
macos
desktop-app
react
typescript
rust
claude-code
codex
skills
analytics
local-first
developer-tools
```

## 功能开关

建议开启：

- Issues
- Discussions
- Releases
- Private vulnerability reporting

暂时不需要时可以关闭：

- Wiki
- Projects

开启 private vulnerability reporting 后，请同步更新 `SECURITY.md` 和 `CODE_OF_CONDUCT.md` 中的私下报告入口。

## 分支保护

保护 `main`：

- 合并前要求 Pull Request。
- 要求状态检查通过。
- 要求 `CI / 构建和测试` 状态检查通过。
- 合并前要求分支是最新的。
- 禁止 force push。
- 禁止删除分支。

## CODEOWNERS

已配置 `.github/CODEOWNERS`，默认代码负责人为 `@fightingst`。

## Labels

建议 labels：

- `bug`
- `enhancement`
- `documentation`
- `privacy`
- `security`
- `scanner`
- `frontend`
- `tauri`
- `rust`
- `good first issue`
- `help wanted`

## Releases

使用类似这样的 tag：

```text
v0.0.1
```

Release 附件建议包含：

- `.dmg`
- `.app.tar.gz` 或 Tauri updater 产物。
- 从 `CHANGELOG.md` 摘出的发布说明。

正式推广前建议配置 Apple 签名和公证。未签名版本应标记为 prerelease，或在说明中明确告知用户。
