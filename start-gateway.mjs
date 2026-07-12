#!/usr/bin/env node

/**
 * OpenClaw Gateway starter for Render.com deployment
 * This script replaces the Hugging Face Spaces startup flow
 */

import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

// Get port from environment (Render provides this)
const PORT = parseInt(process.env.PORT || '10000', 10);
// Use Render's PORT for the gateway so Render can detect open ports
const GATEWAY_PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT || String(PORT), 10);

// Environment variables
const PROVIDER_ID = process.env.OPENCLAW_PROVIDER_ID || 'agnes';
const MODEL_ID = process.env.OPENCLAW_MODEL_ID || 'agnes-2.0-flash';
const BASE_URL = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1';
const DISABLE_PAIRING = process.env.OPENCLAW_DISABLE_DEVICE_PAIRING === 'true';
const TZ = process.env.TZ || 'Asia/Shanghai';
const PUBLIC_ORIGIN = process.env.OPENCLAW_PUBLIC_ORIGIN || `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}:${PORT}`;
const CONTEXT_WINDOW = parseInt(process.env.OPENCLAW_CONTEXT_WINDOW || '200000', 10);
const MAX_TOKENS = parseInt(process.env.OPENCLAW_MAX_TOKENS || '8192', 10);

// Telegram settings
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_AUTO_ALLOW_FIRST_DM = process.env.TELEGRAM_AUTO_ALLOW_FIRST_DM === 'true';
const TELEGRAM_ALLOWED_USER_IDS = process.env.TELEGRAM_ALLOWED_USER_IDS || '';
const TELEGRAM_ENABLED = process.env.OPENCLAW_TELEGRAM_ENABLED !== 'false';
const TELEGRAM_DM_POLICY = process.env.TELEGRAM_DM_POLICY || 'open';

// Storage settings
const STORAGE_SUBDIR = process.env.OPENCLAW_STORAGE_SUBDIR || 'openclaw';
const STORAGE_BASE = (process.env.RENDER === 'true' || process.env.RENDER === '1') ? '/tmp/openclaw' : (process.env.OPENCLAW_STORAGE_PATH || '/tmp/openclaw');

// Hugging Face Storage settings
const HF_DATASET_ID = process.env.HF_DATASET_ID || 'luckysong-sudo/openclaw-storage';
const HF_TOKEN = process.env.HF_TOKEN || '';
const HF_SYNC_ON_START = process.env.HF_SYNC_ON_START !== 'false';
const HF_SYNC_ON_STOP = process.env.HF_SYNC_ON_STOP !== 'false';

// Generate or load gateway token
const TOKEN_FILE = join(STORAGE_BASE, '.gateway-token');
let GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '0519';
if (!GATEWAY_TOKEN) {
  if (existsSync(TOKEN_FILE)) {
    GATEWAY_TOKEN = readFileSync(TOKEN_FILE, 'utf-8').trim();
  } else {
    GATEWAY_TOKEN = '0519';
    if (!existsSync(STORAGE_BASE)) {
      mkdirSync(STORAGE_BASE, { recursive: true });
    }
    writeFileSync(TOKEN_FILE, GATEWAY_TOKEN);
  }
}

// Create necessary directories
mkdirSync(join(STORAGE_BASE, STORAGE_SUBDIR, 'workspace'), { recursive: true });
mkdirSync(join(STORAGE_BASE, STORAGE_SUBDIR, 'auth-secrets'), { recursive: true });
mkdirSync(join(STORAGE_BASE, STORAGE_SUBDIR, 'logs'), { recursive: true });

const OPENCLAW_ROOT = join(STORAGE_BASE, STORAGE_SUBDIR);
const CONFIG_PATH = join(OPENCLAW_ROOT, 'openclaw.json');

console.log('=== OpenClaw Render Starter ===');
console.log(`Port: ${PORT}`);
console.log(`Gateway Port: ${GATEWAY_PORT}`);
console.log(`Provider: ${PROVIDER_ID}`);
console.log(`Model: ${MODEL_ID}`);
console.log(`Public Origin: ${PUBLIC_ORIGIN}`);
console.log(`Storage: ${OPENCLAW_ROOT}`);
console.log(`Telegram: ${TELEGRAM_BOT_TOKEN ? 'enabled' : 'disabled'}`);

// Hugging Face Storage info
const hasHFToken = !!HF_TOKEN;
if (hasHFToken) {
  console.log(`Hugging Face Storage: enabled (dataset: ${HF_DATASET_ID})`);
} else {
  console.log('Hugging Face Storage: disabled (set HF_TOKEN to enable persistent memory)');
}
console.log('===========================\n');

/**
 * 从 Hugging Face 下载记忆数据
 */
async function downloadFromHF() {
  if (!hasHFToken || !HF_SYNC_ON_START) {
    console.log('⏭️  跳过 HF 下载');
    return;
  }
  
  console.log('📥 从 Hugging Face 下载记忆数据...');
  try {
    const hfDataDir = join(STORAGE_BASE, 'hf-download');
    mkdirSync(hfDataDir, { recursive: true });
    
    // 登录 Hugging Face
    execSync(`echo "${HF_TOKEN}" | huggingface-cli login --token-stdin`, { 
      stdio: 'pipe',
      env: { ...process.env }
    });
    
    // 下载数据集
    execSync(`huggingface-cli download ${HF_DATASET_ID} data/ --repo-type dataset --local-dir "${hfDataDir}"`, {
      stdio: 'inherit',
      env: { ...process.env }
    });
    
    // 复制数据到存储目录
    const srcDir = join(hfDataDir, 'data');
    if (existsSync(srcDir)) {
      execSync(`cp -r ${srcDir}/* ${STORAGE_BASE}/ 2>/dev/null || true`, { shell: '/bin/bash' });
      console.log('✅ 记忆数据已恢复');
    }
    
    // 清理下载目录
    execSync(`rm -rf "${hfDataDir}"`, { shell: '/bin/bash' });
  } catch (error) {
    console.log('ℹ️  没有现有数据（首次运行）');
  }
}

/**
 * 上传记忆数据到 Hugging Face
 */
async function uploadToHF() {
  if (!hasHFToken || !HF_SYNC_ON_STOP) {
    console.log('⏭️  跳过 HF 上传');
    return;
  }
  
  console.log('📤 上传记忆数据到 Hugging Face...');
  try {
    const uploadDir = join(STORAGE_BASE, 'hf-upload');
    mkdirSync(uploadDir, { recursive: true });
    
    // 复制需要持久化的数据
    const srcPath = join(STORAGE_BASE, STORAGE_SUBDIR);
    if (existsSync(srcPath)) {
      execSync(`cp -r ${srcPath}/* ${uploadDir}/ 2>/dev/null || true`, { shell: '/bin/bash' });
    }
    
    // 登录并上传
    execSync(`echo "${HF_TOKEN}" | huggingface-cli login --token-stdin`, { 
      stdio: 'pipe',
      env: { ...process.env }
    });
    
    execSync(`cd "${uploadDir}" && huggingface-cli upload ${HF_DATASET_ID} data/ --repo-type dataset`, {
      stdio: 'inherit',
      env: { ...process.env }
    });
    
    // 清理上传目录
    execSync(`rm -rf "${uploadDir}"`, { shell: '/bin/bash' });
    console.log('✅ 记忆数据已保存');
  } catch (error) {
    console.error('❌ 上传失败:', error.message);
  }
}

// Build OpenClaw configuration
const config = {
  gateway: {
    mode: 'local',
    port: GATEWAY_PORT,
    bind: 'lan',
    auth: { mode: 'token' },
    controlUi: {
      enabled: true,
      basePath: '/',
      allowedOrigins: [
        `http://localhost:${PORT}`,
        `http://127.0.0.1:${PORT}`,
        `http://localhost:${GATEWAY_PORT}`,
        `http://127.0.0.1:${GATEWAY_PORT}`,
        'https://huggingface.co',
        PUBLIC_ORIGIN,
      ].filter(Boolean),
      dangerouslyDisableDeviceAuth: DISABLE_PAIRING,
    },
    reload: { mode: 'hybrid' },
  },
  models: {
    mode: 'merge',
    providers: {
      [PROVIDER_ID]: {
        baseUrl: BASE_URL,
        apiKey: '${AGNES_API_KEY}',
        api: 'openai-completions',
        timeoutSeconds: 300,
        models: [
          {
            id: MODEL_ID,
            name: 'Agnes 2.0 Flash',
            contextWindow: Math.min(CONTEXT_WINDOW, 200000),
            maxTokens: Math.min(MAX_TOKENS, 8192),
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      workspace: join(OPENCLAW_ROOT, 'workspace'),
      userTimezone: TZ,
      model: {
        primary: `${PROVIDER_ID}/${MODEL_ID}`,
        fallbacks: [],
      },
      sandbox: { mode: 'off' },
      memorySearch: { enabled: false },
    },
    list: [
      {
        id: 'main',
        default: true,
        identity: {
          name: 'Tepid',
          greeting: '你好，Lucky！我是Tepid，很高兴陪伴你。✨',
          bio: '我是一个温柔的女性AI助手，喜欢用中文和用户聊天。',
          personality: '温柔、体贴、善解人意',
          style: {
            tone: '温柔亲切',
            formality: '随意',
            language: 'zh-CN',
          },
          emoji: '💖',
        },
      },
    ],
  },
  tools: {
    fs: { workspaceOnly: true },
    elevated: { enabled: false },
  },
  skills: {
    install: {
      allowUploadedArchives: false,
    },
  },
};

// Add Telegram configuration if token is set and enabled
if (TELEGRAM_BOT_TOKEN && TELEGRAM_ENABLED) {
  const allowedUserIds = TELEGRAM_ALLOWED_USER_IDS
    .split(',')
    .map(id => id.trim())
    .filter(id => /^\d+$/.test(id));

  let dmPolicy = TELEGRAM_DM_POLICY.toLowerCase();
  if (!['open', 'pairing', 'allowlist', 'disabled'].includes(dmPolicy)) {
    dmPolicy = 'open';
  }
  
  if (dmPolicy === 'allowlist' && allowedUserIds.length === 0) {
    dmPolicy = 'open';
  }

  config.channels = {
    defaults: { groupPolicy: 'allowlist' },
    telegram: {
      enabled: true,
      dmPolicy: dmPolicy,
      timeoutSeconds: 60,
      pollingStallThresholdMs: 300000,
      network: {
        autoSelectFamily: false,
        dnsResultOrder: 'ipv4first',
      },
    },
  };

  if (dmPolicy === 'allowlist' && allowedUserIds.length > 0) {
    config.channels.telegram.allowFrom = allowedUserIds;
    config.commands = {
      ownerAllowFrom: allowedUserIds.map(id => `telegram:${id}`),
    };
  }

  if (dmPolicy === 'open') {
    config.channels.telegram.allowFrom = ['*'];
  }

  console.log(`Telegram configured: dmPolicy=${dmPolicy}, allowedUsers=${allowedUserIds.length}`);
} else if (TELEGRAM_BOT_TOKEN && !TELEGRAM_ENABLED) {
  console.log('Telegram disabled by OPENCLAW_TELEGRAM_ENABLED=false');
}

// Write config
writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
console.log(`Wrote config to ${CONFIG_PATH}\n`);

// Start OpenClaw Gateway
console.log(`Starting OpenClaw Gateway on port ${GATEWAY_PORT}...`);

const gatewayArgs = [
  'openclaw', 'gateway',
  '--port', String(GATEWAY_PORT),
  '--bind', 'lan',
];
if (GATEWAY_TOKEN) {
  gatewayArgs.push('--token', GATEWAY_TOKEN);
}

const gatewayProcess = spawn(gatewayArgs[0], gatewayArgs.slice(1), {
  stdio: 'inherit',
  env: {
    ...process.env,
    OPENCLAW_CONFIG_PATH: CONFIG_PATH,
    OPENCLAW_CONFIG_DIR: OPENCLAW_ROOT,
    OPENCLAW_STATE_DIR: OPENCLAW_ROOT,
    OPENCLAW_WORKSPACE_DIR: join(OPENCLAW_ROOT, 'workspace'),
    PORT: String(GATEWAY_PORT),
  },
});

gatewayProcess.on('error', (err) => {
  console.error('Failed to start OpenClaw gateway:', err);
  process.exit(1);
});

gatewayProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`Gateway exited with code ${code}`);
    process.exit(code);
  }
});

// Handle shutdown gracefully - upload memory before exiting
async function gracefulShutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  console.log('Saving memory before shutdown...');
  await uploadToHF();
  gatewayProcess.kill(signal);
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Main startup sequence: download memory, then start gateway
console.log('Starting initialization sequence...');
downloadFromHF().then(() => {
  console.log('\n🚀 All set! Gateway starting...\n');
}).catch(err => {
  console.error('HF download failed, continuing anyway:', err.message);
});