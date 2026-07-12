#!/usr/bin/env node

/**
 * OpenClaw Gateway starter for Render.com deployment
 * This script replaces the Hugging Face Spaces startup flow
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

// Get port from environment (Render provides this)
const PORT = parseInt(process.env.PORT || '10000', 10);
const GATEWAY_PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789', 10);

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
const STORAGE_BASE = process.env.RENDER || '/tmp/openclaw';

// Generate or load gateway token
const TOKEN_FILE = join(STORAGE_BASE, '.gateway-token');
let GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!GATEWAY_TOKEN) {
  if (existsSync(TOKEN_FILE)) {
    GATEWAY_TOKEN = require('fs').readFileSync(TOKEN_FILE, 'utf-8').trim();
  } else {
    GATEWAY_TOKEN = randomBytes(32).toString('hex');
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
console.log('===========================\n');

// Build OpenClaw configuration
const config = {
  gateway: {
    mode: 'local',
    port: GATEWAY_PORT,
    bind: '0.0.0.0',
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
          name: 'OpenClaw Agnes (ORagnes_bot)',
          theme: 'Render deployment using Agnes AI and Telegram',
          emoji: '🦞',
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

  // Determine DM policy
  let dmPolicy = TELEGRAM_DM_POLICY.toLowerCase();
  if (!['open', 'pairing', 'allowlist', 'disabled'].includes(dmPolicy)) {
    dmPolicy = 'open';
  }
  
  // If allowlist mode but no user IDs set, fall back to open
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

  // Set allowed users if using allowlist mode
  if (dmPolicy === 'allowlist' && allowedUserIds.length > 0) {
    config.channels.telegram.allowFrom = allowedUserIds;
    config.commands = {
      ownerAllowFrom: allowedUserIds.map(id => `telegram:${id}`),
    };
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

const gatewayProcess = spawn('npx', ['openclaw', 'gateway', '--bind', '0.0.0.0', '--port', String(GATEWAY_PORT)], {
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

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  gatewayProcess.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  gatewayProcess.kill('SIGINT');
  process.exit(0);
});