# 维护说明

## 同步上游更新

```bash
git fetch upstream
git log upstream/master --oneline | head -10  # 查看上游新提交
git merge upstream/master
```

合并冲突大概率只在 `src/routes/messages/non-stream-translation.ts` 的 `translateModelName` 函数。  
解决冲突时，**保留本 fork 的 regex 版本**，丢弃上游的硬编码版本。

解决冲突后：

```bash
bun install && bun run build
# 本地验证四条模型名
curl -s -X POST http://localhost:4141/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}' | head -c 200
```

## 发版流程

1. 更新 `package.json` 中的 `version`（遵循 `0.7.x-patch.y` 格式）
2. 更新 `CHANGELOG.md`
3. `bun run build`
4. `git commit -am "chore: release vX.Y.Z-patch.N"`
5. `git tag vX.Y.Z-patch.N && git push && git push --tags`
6. 在 GitHub 创建 Release，附上 CHANGELOG 内容
7. `npm publish --access public`

## 新模型支持

当 Anthropic 发布新模型（如 claude-sonnet-5-0）时：
- 检查 `translateModelName` 中的正则 `^(claude-(?:sonnet|opus|haiku))-(\d+)-(\d+)$`
- 确认新命名格式是否匹配。若 Anthropic 引入全新系列名（非 sonnet/opus/haiku），在正则的 `(?:sonnet|opus|haiku)` 中添加新名称即可

## Patch 文件位置

| 文件 | 改动说明 |
|------|---------|
| `src/routes/messages/non-stream-translation.ts` | `translateModelName` 函数（核心 patch） |
| `package.json` | name / version / contributors / publishConfig |
