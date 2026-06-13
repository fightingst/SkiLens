# 发布流程

SkiLens 通过 GitHub Releases 发布 macOS 构建产物。

## 版本号

SkiLens 目前处于 1.0 之前。版本号按语义化版本控制处理，但扫描器行为要格外谨慎：

- Patch：bug 修复、文档、小 UI 调整。
- Minor：新的用户可见功能。
- Major：1.0 之后的破坏性变更。

扫描器兼容性变化必须写入 `CHANGELOG.md`。

## 手动发布清单

1. 更新 `CHANGELOG.md`。
2. 更新版本号：
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - 必要时更新 `src-tauri/Cargo.toml`
3. 运行：

```bash
npm run check
npm run tauri:build
```

4. 手动冒烟测试构建后的 app：
   - 打开总览页。
   - 重新扫描。
   - 搜索。
   - 切换时间范围。
   - 打开冷启动视图。
   - 打开技能详情页。
   - 预览 `SKILL.md`。
   - 测试归档确认框。

5. 创建 tag：

```bash
git tag v0.0.1
git push origin v0.0.1
```

6. 如果没有启用自动发布 workflow，手动上传生成的 `.dmg` 和 `.app.tar.gz` 等产物。

## 签名和公证

当前 release workflow 可以生成未签名构建。`0.0.1` 可以作为 prerelease 发布，但 Release Notes 需要明确说明首次打开可能需要右键 **打开**。面向更多用户发布前，建议配置 Apple Developer 签名和公证。

常见 Tauri macOS 签名 secrets：

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

不要把证书或凭据提交到仓库。

## Release Notes 模板

```markdown
## 重点变化

- ...

## 修复

- ...

## 兼容性

- macOS:
- 数据迁移:
- 扫描器行为:

## 检查

- npm run check
- 手动冒烟测试
```
