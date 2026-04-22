# copilot-api · 解决 Claude Code 新版模型名不兼容

[![npm version](https://img.shields.io/npm/v/@yang-builds/copilot-api?label=%40yang-builds%2Fcopilot-api)](https://www.npmjs.com/package/@yang-builds/copilot-api)
[![npm downloads](https://img.shields.io/npm/dm/@yang-builds/copilot-api)](https://www.npmjs.com/package/@yang-builds/copilot-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Fork of ericc-ch/copilot-api](https://img.shields.io/badge/fork%20of-ericc--ch%2Fcopilot--api-orange)](https://github.com/ericc-ch/copilot-api)

> **Fork 说明：** 本仓库基于 [ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api) v0.7.0，仅修复 Claude Code 2.1.x 新版模型名格式不兼容问题，其余功能与原版 100% 一致。

---

## 你遇到的问题是这个吗？

| 症状 | 根本原因 | 本 fork 的修复 |
|------|----------|---------------|
| Claude Code 2.1.x 启动时提示 `API Error: 400 Bad Request` | Claude Code 前端用 `claude-sonnet-4-6`（连字符）做模型显示映射，原版 `translateModelName` 将其错误截断为 `claude-sonnet-4`，被 GitHub Copilot 后端拒绝 | 正则 `^(claude-(?:sonnet\|opus\|haiku))-(\d+)-(\d+)$` 将连字符格式正确转换为 `claude-sonnet-4.6`（点号格式） |
| 欢迎界面显示 "Sonnet 4" 而非 "Sonnet 4.6" / "Opus 4.7" | 同上：模型名被截断导致后端返回了低版本模型 | 同上 |

**受影响版本组合：** `copilot-api 0.7.0` + `Claude Code ≥ 2.1.x`（使用 Sonnet 4.6 / Opus 4.7 / Haiku 4.5）

---

## 一键安装与使用

```bash
# 安装
npm install -g @yang-builds/copilot-api

# 启动代理（默认 4141 端口）
copilot-api start
```

然后在 `~/.claude/settings.json` 中配置：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4141",
    "ANTHROPIC_AUTH_TOKEN": "no-key",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-7"
  }
}
```

> **注意：** 模型名使用连字符格式（`claude-sonnet-4-6`），这正是 Claude Code 前端的显示映射键名，本 fork 会自动转换为后端所需的点号格式。

启动 Claude Code 后欢迎界面应显示 **"claude-sonnet-4.6"**，说明一切正常。

---

## 与上游的差异

| 文件 | 改动内容 |
|------|---------|
| `src/routes/messages/non-stream-translation.ts` | `translateModelName` 函数：从硬编码截断改为正则转换，支持所有 `claude-{family}-{major}-{minor}` 格式 |
| `package.json` | name 改为 `@yang-builds/copilot-api`，version 改为 `0.7.0-patch.1`，加入 contributors |

**代码差异（核心改动）：**

```diff
 function translateModelName(model: string): string {
-  // Subagent requests use a specific model number which Copilot doesn't support
-  if (model.startsWith("claude-sonnet-4-")) {
-    return model.replace(/^claude-sonnet-4-.*/, "claude-sonnet-4")
-  } else if (model.startsWith("claude-opus-")) {
-    return model.replace(/^claude-opus-4-.*/, "claude-opus-4")
-  }
+  // Claude Code uses hyphenated model names (e.g. claude-sonnet-4-6) for display mapping,
+  // but GitHub Copilot backend requires dot notation (e.g. claude-sonnet-4.6).
+  const m = model.match(/^(claude-(?:sonnet|opus|haiku))-(\d+)-(\d+)$/)
+  if (m) return `${m[1]}-${m[2]}.${m[3]}`
   return model
 }
```

---

## 完整使用说明

### 前提条件

- Node.js ≥ 18（推荐）或 Bun ≥ 1.2.x
- GitHub Copilot 有效订阅

### CLI 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--port` | 监听端口 | `4141` |
| `--verbose` | 输出详细日志 | `false` |
| `--manual-approval` | 每次请求需手动批准 | `false` |
| `--disable-telemetry` | 禁用遥测 | `false` |

### API 端点

| 端点 | 说明 |
|------|------|
| `POST /v1/messages` | Anthropic 兼容接口（供 Claude Code 使用） |
| `POST /v1/chat/completions` | OpenAI 兼容接口 |
| `GET /v1/models` | 列出可用模型 |

---

## 常见问题

**Q: 能切回官方 copilot-api 吗？**  
A: 可以，随时 `npm i -g copilot-api` 切回。本 fork 只修复了模型名转换，功能完全兼容。

**Q: Anthropic 发布新模型（比如 Sonnet 5.0）还能用吗？**  
A: 只要新模型命名遵循 `claude-{family}-{major}-{minor}` 格式，正则会自动覆盖，无需改代码。

**Q: 为什么还是出现 API Error 400？**  
A: 另一个常见原因：Claude Code 的 MCP 插件（如 `chrome-devtools-mcp`）注入了包含 JSON Schema Draft 2020-12 字段的 tools，被 GitHub Copilot 后端拒绝。解决方法：在 `~/.claude/settings.json` 中将该插件设为 `false`。

---

## 同步上游更新

```bash
git fetch upstream
git merge upstream/master
# 冲突区大概率只在 src/routes/messages/non-stream-translation.ts 的 translateModelName 函数
# 解决冲突时保留本 fork 的 regex 版本
bun install && bun run build
```

---

## 致谢

- 原作者 **[@ericc-ch](https://github.com/ericc-ch)**，原始项目 [ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api)
- 如果原项目对你有帮助，请给原作者的 [ko-fi](https://ko-fi.com/ericc) 支持一下

> [!WARNING]
> This is a reverse-engineered proxy of GitHub Copilot API. It is not supported by GitHub, and may break unexpectedly. Use at your own risk.

---

## License

MIT © Erick Christian (原作者) · Fork maintained by [yang-builds](https://github.com/yang-builds)
