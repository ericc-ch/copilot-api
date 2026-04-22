# Changelog

## v0.7.0-patch.1 (2026-04-22)

**Fork 起点：** 基于 [ericc-ch/copilot-api v0.7.0](https://github.com/ericc-ch/copilot-api/releases/tag/v0.7.0)

### Bug Fix

**修复 Claude Code 2.1.x 新版模型名不兼容问题**

- **文件：** `src/routes/messages/non-stream-translation.ts`
- **函数：** `translateModelName`
- **问题：** 原版将 `claude-sonnet-4-6` 截断为 `claude-sonnet-4`，被 GitHub Copilot 后端以 HTTP 400 拒绝；Claude Code 欢迎界面错误显示 "Sonnet 4"
- **修复：** 用正则 `^(claude-(?:sonnet|opus|haiku))-(\d+)-(\d+)$` 将连字符转换为点号，`claude-sonnet-4-6` → `claude-sonnet-4.6`
- **覆盖模型：** claude-sonnet-4-6、claude-opus-4-7、claude-haiku-4-5（及未来同格式新模型）

---

## 上游版本

参见 [ericc-ch/copilot-api releases](https://github.com/ericc-ch/copilot-api/releases)
