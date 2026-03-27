# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指引。

## 概述

`claude-code-notifier` 是一个 Claude Code Stop hook，当 Claude 完成任务时发送 macOS 系统通知（可附带提示音）。它有两个子命令：

- `init` — 交互式配置向导，将 hook 写入 `~/.claude/settings.json`（用户级别）或 `.claude/settings.json`（项目级别）
- `notify` — 由 Claude Code 的 Stop hook 自动调用，从 stdin 读取 JSON 并触发通知

## 开发

无需构建步骤，这是一个单文件 Node.js 脚本。

```bash
# 运行配置向导
node bin/claude-code-notifier-hook.js init

# 模拟 Stop hook 调用
echo '{"stop_hook_active": false}' | node bin/claude-code-notifier-hook.js notify --sound Frog
```

## 架构

所有逻辑均位于 `bin/claude-code-notifier-hook.js`。关键设计决策：

- **防无限循环**：若 `input.stop_hook_active === true`，`notify` 立即退出（当 hook 触发新的 Claude 会话时，Claude Code 会设置此标志）。
- **用户级 hook 去重**：安装到用户级别时，hook 命令会包裹一层 shell 判断（`[ -f .claude/settings.json ] && grep -q ...`），避免在已有自定义 notifier hook 的项目中重复触发。
- **提示音路径解析**：macOS 系统音从 `/System/Library/Sounds/` 播放；内置音效（`assets/audios/*.aiff`）在 `init` 时复制到 `~/Library/Sounds/`，运行时通过 `afplay` 按名称播放。
- **静默失败**：`notify` 子命令捕获所有错误并以退出码 0 退出，避免阻塞 Claude Code。

## 内置音效

`assets/audios/` 包含三个 `.aiff` 文件（`lailalaodi`、`niganma`、`letsgetwork`）。`init` 向导会将所选文件复制到 `~/Library/Sounds/`，供运行时 `afplay` 按名称查找。
