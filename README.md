# SkiLens

SkiLens is the Tauri 2 rewrite of the Python `skill-usage-dashboard` MVP.

This migration keeps the existing business rules intact:

- `invocations` only counts Claude slash commands and explicit `Skill` / `skill` tool uses.
- Slash command evidence wins over `Skill` tool use in the same `(session, skill)`.
- Supporting signals such as skill instructions, agent requests, `load_skills`, and `read-SKILL.md` remain evidence only.
- Plugin caches under `~/.claude/plugins/cache` and `~/.codex/plugins/cache` are excluded from installed skill discovery.
- Archived hidden history must survive rescans.

## Development

```bash
npm install
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```
