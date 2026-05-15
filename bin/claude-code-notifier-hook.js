#!/usr/bin/env node

// claude-code-notifier-hook.js — Claude Code Notifier
// 用法:
//   claude-code-notifier-hook init              — 交互式配置向导
//   claude-code-notifier-hook notify [opts]     — 由 Claude Code Stop hook 自动调用
//   claude-code-notifier-hook attention-notify  — 由 PreToolUse hook 自动调用（需要决策时）

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const MAC_SYSTEM_SOUNDS = [
  'Frog', 'Purr', 'Sosumi', 'Submarine'
];

const BUNDLED_SOUNDS = [
  { name: '来啦老弟', file: 'lailalaodi.aiff' },
  { name: '你干嘛',   file: 'niganma.aiff' },
  { name: '开始工作', file: 'letsgetwork.aiff' },
];

const [, , subcommand, ...rest] = process.argv;

if (subcommand === 'init') {
  runInit().catch(err => {
    console.error('初始化失败:', err.message);
    process.exit(1);
  });
} else if (subcommand === 'notify') {
  runNotify(rest);
} else if (subcommand === 'attention-notify') {
  runAttentionNotify(rest);
} else if (subcommand === '_send') {
  sendNow(rest);
} else {
  console.log('用法:');
  console.log('  claude-code-notifier-hook init     初始化配置');
  console.log('  claude-code-notifier-hook notify   发送通知（由 Claude Code Stop hook 调用）');
  process.exit(0);
}

// ─── init ────────────────────────────────────────────────────────────────────

async function runInit() {
  const inquirer = require('inquirer');

  console.log('\n🤖 Claude Code Notifier 初始化\n');

  // 1. 选择安装级别
  const { installLevel } = await inquirer.prompt([
    {
      type: 'list',
      name: 'installLevel',
      message: '将 hook 安装到哪个级别？',
      choices: [
        { name: '用户级别 (~/.claude/settings.json)', value: 'user' },
        { name: '项目级别 (.claude/settings.local.json，不提交 git)', value: 'project' }
      ]
    }
  ]);

  // 2. 选择提示音（仅 macOS）
  let soundArg = '';
  if (process.platform === 'darwin') {
    const { soundChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'soundChoice',
        message: '选择提示音：',
        choices: [
          ...MAC_SYSTEM_SOUNDS.map(s => ({ name: s, value: s })),
          ...BUNDLED_SOUNDS.map(s => ({ name: s.name, value: `__bundled__${s.file}` })),
          { name: '自定义提示音 (~/Library/Sounds)', value: '__custom__' },
          { name: '不使用提示音', value: '__none__' }
        ]
      }
    ]);

    if (soundChoice.startsWith('__bundled__')) {
      const fileName = soundChoice.replace('__bundled__', '');
      const soundName = path.basename(fileName, '.aiff');
      const src = path.join(__dirname, '..', 'assets', 'audios', fileName);
      const dest = path.join(os.homedir(), 'Library', 'Sounds', fileName);
      fs.copyFileSync(src, dest);
      console.log(`✅ 已将 ${fileName} 复制到 ~/Library/Sounds/`);
      soundArg = ` --sound ${soundName} --custom-sound`;
    } else if (soundChoice === '__custom__') {
      const { customSound } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customSound',
          message: '输入自定义提示音名称（不含 .aiff 扩展名）：',
          validate: input => {
            const name = input.trim();
            if (!name) return '提示音名称不能为空';
            const file = path.join(os.homedir(), 'Library', 'Sounds', `${name}.aiff`);
            if (!fs.existsSync(file)) return `未找到文件: ${file}`;
            return true;
          }
        }
      ]);
      soundArg = ` --sound ${customSound.trim()} --custom-sound`;
    } else if (soundChoice !== '__none__') {
      soundArg = ` --sound ${soundChoice}`;
    }
  } else {
    console.log('ℹ️  当前系统暂不支持自定义提示音，将使用默认通知。');
  }

  // 3. 是否启用"需要决策时提醒"（PreToolUse hook）
  const { enableAttentionNotify } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableAttentionNotify',
      message: '当 Claude Code 需要您做决策时（如弹出交互对话框）是否同步发送提醒？',
      default: true
    }
  ]);

  // 4. 确定配置文件路径
  // 项目级别使用 settings.local.json，不会提交 git，避免影响其他开发者
  const configPath = installLevel === 'user'
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.local.json');

  // 5. 项目级别：确保 settings.local.json 在 .gitignore 中
  if (installLevel === 'project') {
    ensureGitignored(path.join(process.cwd(), '.gitignore'), '.claude/settings.local.json');
  }

  // 6. 读取现有配置
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      console.warn(`⚠️  无法解析现有配置文件 ${configPath}，将重新创建。`);
    }
  }

  if (!config.hooks) config.hooks = {};
  if (!config.hooks.Stop) config.hooks.Stop = [];

  // 7. 检查是否已存在配置
  const stopExists = config.hooks.Stop.some(entry =>
    (entry.hooks || []).some(h => h.command?.includes('claude-code-notifier-hook notify'))
  );
  const attentionExists = (config.hooks.PreToolUse || []).some(entry =>
    (entry.hooks || []).some(h => h.command?.includes('claude-code-notifier-hook attention-notify'))
  );

  if (stopExists || attentionExists) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: '检测到已存在 claude-code-notifier-hook 配置，是否覆盖？',
        default: false
      }
    ]);
    if (!overwrite) {
      console.log('已取消，配置未修改。');
      process.exit(0);
    }
    config.hooks.Stop = config.hooks.Stop.filter(entry =>
      !(entry.hooks || []).some(h => h.command?.includes('claude-code-notifier-hook notify'))
    );
    if (config.hooks.PreToolUse) {
      config.hooks.PreToolUse = config.hooks.PreToolUse.filter(entry =>
        !(entry.hooks || []).some(h => h.command?.includes('claude-code-notifier-hook attention-notify'))
      );
    }
  }

  // 8. 构建并写入 Stop hook
  const baseCommand = `claude-code-notifier-hook notify${soundArg}`;
  // 用户级别：用 grep 检查两个可能的项目级配置文件，避免与项目级 hook 重复触发
  const stopCommand = installLevel === 'user'
    ? `grep -ql 'claude-code-notifier-hook' .claude/settings.json .claude/settings.local.json 2>/dev/null || ${baseCommand}`
    : baseCommand;

  config.hooks.Stop.push({
    hooks: [{ type: 'command', command: stopCommand, timeout: 10 }]
  });

  // 9. 写入 PreToolUse hook（需要决策时提醒）
  if (enableAttentionNotify) {
    if (!config.hooks.PreToolUse) config.hooks.PreToolUse = [];
    const attentionCommand = `claude-code-notifier-hook attention-notify${soundArg}`;
    config.hooks.PreToolUse.push({
      matcher: 'AskUserQuestion',
      hooks: [{ type: 'command', command: attentionCommand, timeout: 5 }]
    });
  }

  // 10. 写入配置文件
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  console.log(`\n✅ 配置已写入: ${configPath}`);
  console.log(`   Stop hook: ${stopCommand}`);
  if (enableAttentionNotify) {
    console.log(`   PreToolUse hook (AskUserQuestion): claude-code-notifier-hook attention-notify${soundArg}`);
  }
  console.log('\n下次 Claude Code 完成任务或需要您决策时将自动发送通知。\n');
}

function ensureGitignored(gitignorePath, entry) {
  try {
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf-8')
      : '';
    if (existing.split('\n').some(line => line.trim() === entry)) return;
    const suffix = existing.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(gitignorePath, `${suffix}# Claude Code 本地配置（个人，不提交）\n${entry}\n`);
    console.log(`✅ 已将 ${entry} 添加到 .gitignore`);
  } catch {
    console.warn(`⚠️  无法更新 .gitignore，请手动添加 ${entry}`);
  }
}

// ─── notify（Stop hook）──────────────────────────────────────────────────────

function runNotify(args) {
  let input = {};
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf-8');
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  // ⚠️ 防止无限循环
  if (input.stop_hook_active === true) process.exit(0);

  // Debounce：防止 auto-compact 等中途 stop 触发误报。
  // 写入唯一 token，后台等待 N 秒后检查 token 是否仍是最新；
  // 若期间有新 stop 触发（覆盖了 token），则跳过本次通知。
  const debounceIdx = args.indexOf('--debounce');
  const debounceSec = debounceIdx !== -1 ? (parseInt(args[debounceIdx + 1]) || 5) : 5;

  const stateFile = path.join(os.tmpdir(), 'claude-notifier-token');
  const token = `${Date.now()}.${process.pid}`;

  try { fs.writeFileSync(stateFile, token); } catch { process.exit(0); }

  const soundArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--debounce') { i++; continue; }
    soundArgs.push(args[i]);
  }

  const quotedArgs = soundArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');

  const bgScript = [
    `sleep ${debounceSec}`,
    `stored=$(cat "${stateFile}" 2>/dev/null)`,
    `[ "$stored" = "${token}" ] && node "${__filename}" _send ${quotedArgs}`,
  ].join('\n');

  try {
    spawn('bash', ['-c', bgScript], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* ignore */ }

  process.exit(0);
}

// ─── attention-notify（PreToolUse hook）──────────────────────────────────────

function runAttentionNotify(args) {
  // 读取 PreToolUse payload（不强制，失败也继续）
  try {
    fs.readFileSync('/dev/stdin', 'utf-8');
  } catch { /* ignore */ }

  // 速率限制：30 秒内只发一次，避免连续工具调用产生噪音
  const rateFile = path.join(os.tmpdir(), 'claude-notifier-attention-ts');
  const now = Date.now();
  try {
    const last = parseInt(fs.readFileSync(rateFile, 'utf-8').trim());
    if (!isNaN(last) && now - last < 30000) process.exit(0);
  } catch { /* 首次 */ }
  try { fs.writeFileSync(rateFile, String(now)); } catch { /* ignore */ }

  const soundIdx = args.indexOf('--sound');
  const soundName = soundIdx !== -1 ? args[soundIdx + 1] : null;
  const isCustomSound = args.includes('--custom-sound');

  try {
    const notifier = require('node-notifier');
    notifier.notify({
      title: '🤖 需要您的操作',
      message: 'Claude Code 正在等待您的回复',
      sound: !soundName,
      wait: false,
    });
    if (soundName) playSound(soundName, isCustomSound);
  } catch { /* ignore */ }

  process.exit(0);
}

// ─── _send（内部，由 debounce 后台进程调用）──────────────────────────────────

function sendNow(args) {
  const soundIdx = args.indexOf('--sound');
  const soundName = soundIdx !== -1 ? args[soundIdx + 1] : null;
  const isCustomSound = args.includes('--custom-sound');

  try {
    const notifier = require('node-notifier');
    notifier.notify({
      title: '🤖 提醒',
      message: 'Claude Code 任务完成，请继续...',
      sound: !soundName,
      wait: false,
    });
    if (soundName) playSound(soundName, isCustomSound);
  } catch { /* ignore */ }

  process.exit(0);
}

function playSound(name, isCustom) {
  if (process.platform !== 'darwin' || !name) return;
  const soundPath = isCustom
    ? path.join(os.homedir(), 'Library', 'Sounds', `${name}.aiff`)
    : `/System/Library/Sounds/${name}.aiff`;
  if (fs.existsSync(soundPath)) {
    spawn('afplay', [soundPath], { detached: true, stdio: 'ignore' }).unref();
  }
}
