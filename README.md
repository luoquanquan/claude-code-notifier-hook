# Claude Code Notifier Hook

当 Claude Code 完成任务时，自动发送 macOS 系统通知（可附带提示音），让你不用盯着屏幕等待。

## 效果

- Claude 完成任务后弹出系统通知：**"Claude Code 任务完成，请继续..."**
- 可选播放提示音（系统音效或内置趣味音效）

## 安装

```bash
npm install -g claude-code-notifier-hook
```

## 使用

### 初始化（只需运行一次）

```bash
claude-code-notifier-hook init
```

向导会引导你：

1. **选择安装级别**
   - 用户级别 `~/.claude/settings.json` — 对所有项目生效
   - 项目级别 `.claude/settings.json` — 仅对当前项目生效

2. **选择提示音**（macOS）
   - 系统音效：Frog、Purr、Sosumi、Submarine
   - 内置趣味音效：来啦老弟 / 你干嘛 / 开始工作
   - 自定义音效（`~/Library/Sounds` 中的 `.aiff` 文件）
   - 或不使用提示音

配置完成后，Claude Code 每次完成任务都会自动触发通知。

### 手动测试

```bash
echo '{"stop_hook_active": false}' | claude-code-notifier-hook notify --sound Frog
```

## 工作原理

本工具作为 Claude Code 的 **Stop hook** 运行。每当 Claude 完成一轮任务，Claude Code 会自动调用 `notify` 子命令并通过 stdin 传入 JSON 数据。

**防止无限循环：** 若 JSON 中 `stop_hook_active === true`（表示 hook 本身触发了新会话），通知器会立即退出，避免循环触发。

**用户级去重：** 安装到用户级别时，hook 命令会先检查当前项目是否已有自定义 notifier hook，有则跳过，避免重复通知。

## 内置音效说明

| 音效名 | 文件 |
|--------|------|
| 来啦老弟 | `lailalaodi.aiff` |
| 你干嘛 | `niganma.aiff` |
| 开始工作 | `letsgetwork.aiff` |

`init` 时会将所选文件复制到 `~/Library/Sounds/`，之后通过 `afplay` 播放。

## 系统要求

- macOS（通知与音效功能依赖 macOS API）
- Node.js >= 14

## License

MIT
