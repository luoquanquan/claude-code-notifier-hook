#!/usr/bin/env node

// claude-code-notifier-hook.js — Claude Code Notifier
// 用法:
//   claude-code-notifier-hook init            — 交互式配置向导
//   claude-code-notifier-hook notify [opts]   — 由 Claude Code Stop hook 自动调用

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
} else {
  console.log('用法:');
  console.log('  claude-code-notifier-hook init     初始化配置');
  console.log('  claude-code-notifier-hook notify   发送通知（由 Claude Code 自动调用）');
  process.exit(0);
}

// ─── init ───��────────────────────────────────────────────────────────────────

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
        { name: '项目级别 (.claude/settings.json)', value: 'project' }
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

  // 3. 确定配置文件路径
  const configPath = installLevel === 'user'
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  // 4. 读取现有配置
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      console.warn(`⚠️  无法解析现有配置文件 ${configPath}，将重新创建。`);
    }
  }

  // 5. 构建 hook 命令
  const baseCommand = `claude-code-notifier-hook notify${soundArg}`;
  const hookCommand = installLevel === 'user'
    ? `[ -f .claude/settings.json ] && grep -q 'claude-code-notifier-hook' .claude/settings.json || ${baseCommand}`
    : baseCommand;

  // 6. 合并 hooks 配置
  if (!config.hooks) config.hooks = {};
  if (!config.hooks.Stop) config.hooks.Stop = [];

  const alreadyAdded = config.hooks.Stop.some(entry =>
    (entry.hooks || []).some(h => h.command && h.command.includes('claude-code-notifier-hook'))
  );

  if (alreadyAdded) {
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
      !(entry.hooks || []).some(h => h.command && h.command.includes('claude-code-notifier-hook'))
    );
  }

  config.hooks.Stop.push({
    hooks: [{ type: 'command', command: hookCommand, timeout: 10 }]
  });

  // 7. 写入配置
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  console.log(`\n✅ 配置已写入: ${configPath}`);
  console.log(`   Hook 命令: ${hookCommand}`);
  console.log('\n下次 Claude Code 完成任务时将自动发送通知。\n');
}

// ─── notify ──────────────────────────────────────────────────────────────────

function runNotify(args) {
  // 读取 stdin（Stop hook 的 JSON 输入）
  let input = {};
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf-8');
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  // ⚠️ 防止无限循环
  if (input.stop_hook_active === true) process.exit(0);

  // 解析 --sound / --custom-sound
  const soundIdx = args.indexOf('--sound');
  const soundName = soundIdx !== -1 ? args[soundIdx + 1] : null;
  const isCustomSound = args.includes('--custom-sound');

  // 发送系统通知
  try {
    const notifier = require('node-notifier');
    notifier.notify({
      title: '🤖 提醒',
      message: 'Claude Code 任务完成，请继续...',
      sound: !soundName,  // 无自定义音时使用系统默认通知音
      wait: true,
    });
    if (soundName) playSound(soundName, isCustomSound);
  } catch {
    // 静默忽略，不影响 Claude 流程
  }

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
