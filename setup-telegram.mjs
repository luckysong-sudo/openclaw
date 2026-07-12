#!/usr/bin/env node

/**
 * Telegram Bot 快速配置脚本
 * 帮助设置 Telegram Bot 并获取您的 User ID
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const KEYS_FILE = '常用key.txt';
const RENDER_YAML = 'render.yaml';

// 从常用key.txt 读取 Telegram Bot Token
function readTelegramToken() {
  if (!existsSync(KEYS_FILE)) {
    console.error(`错误: 找不到文件 ${KEYS_FILE}`);
    process.exit(1);
  }

  const content = readFileSync(KEYS_FILE, 'utf-8');
  // 匹配 Telegram Bot Token 格式
  const telegramMatch = content.match(/(\d{8,10}):[A-Za-z0-9_-]{35}/);
  
  if (!telegramMatch) {
    console.error('错误: 在常用key.txt 中未找到有效的 Telegram Bot Token');
    console.log('Token 格式应为: 数字ID:字母数字组合');
    process.exit(1);
  }

  return telegramMatch[1] + ':' + telegramMatch[2];
}

// 设置 Webhook
async function setupWebhook(botToken) {
  const apiUrl = `https://api.telegram.org/bot${botToken}`;
  
  console.log('\n正在设置 Webhook...');
  
  try {
    const response = await fetch(`${apiUrl}/setWebhook?allowed_updates=["message","callback_query","inline_query"]`);
    const result = await response.json();
    
    if (result.ok) {
      console.log('✓ Webhook 设置成功!');
      return true;
    } else {
      console.error('✗ Webhook 设置失败:', result.description);
      return false;
    }
  } catch (error) {
    console.error('✗ Webhook 设置出错:', error.message);
    return false;
  }
}

// 获取用户 ID
async function getUserId(botToken) {
  const apiUrl = `https://api.telegram.org/bot${botToken}`;
  
  console.log('\n请到您的 Bot 发送任意消息（例如 "hello"），然后按回车继续...');
  console.log('或者您可以直接按 Ctrl+C 跳过此步骤，稍后手动获取 User ID');
  await new Promise(resolve => {
    process.stdin.once('data', () => resolve());
  });

  try {
    const response = await fetch(`${apiUrl}/getUpdates`);
    const result = await response.json();
    
    if (!result.ok) {
      console.error('获取更新失败:', result.description);
      return null;
    }

    const updates = result.result;
    if (updates.length === 0) {
      console.log('没有找到任何消息更新。');
      console.log('请确保：');
      console.log('1. 您已经向 Bot 发送了一条消息');
      console.log('2. Bot 已经启动并正常运行');
      return null;
    }

    // 查找最近的私人消息
    for (const update of updates.reverse()) {
      const message = update.message || update.edited_message;
      if (message && message.chat.type === 'private') {
        return String(message.chat.id);
      }
    }

    console.log('没有找到私人消息。请直接向 Bot 发送消息后再试。');
    return null;
  } catch (error) {
    console.error('获取 User ID 出错:', error.message);
    return null;
  }
}

// 更新 render.yaml 添加 User ID
function updateRenderYaml(userId) {
  if (!userId) {
    console.log('\n跳过更新 render.yaml（未提供 User ID）');
    return;
  }

  if (!existsSync(RENDER_YAML)) {
    console.error(`错误: 找不到文件 ${RENDER_YAML}`);
    return;
  }

  let content = readFileSync(RENDER_YAML, 'utf-8');
  
  // 检查是否已存在 TELEGRAM_ALLOWED_USER_IDS
  if (content.includes('TELEGRAM_ALLOWED_USER_IDS')) {
    content = content.replace(
      /(      - key: TELEGRAM_ALLOWED_USERIDS[\s\S]*?value:).*$/m,
      `$1 ${userId}`
    );
  } else {
    // 在 TELEGRAM_BOT_TOKEN 后面添加
    const newVars = `
      - key: TELEGRAM_ALLOWED_USER_IDS
        value: "${userId}"
      - key: TELEGRAM_DM_POLICY
        value: "allowlist"`;
    
    content = content.replace(
      /(      - key: OPENCLAW_TELEGRAM_ENABLED[\s\S]*?value: "true"\n)/,
      `$1${newVars}`
    );
  }

  writeFileSync(RENDER_YAML, content);
  console.log(`\n✓ 已更新 ${RENDER_YAML}，添加 User ID: ${userId}`);
}

// 主函数
async function main() {
  console.log('=================================');
  console.log('  OpenClaw Telegram 配置助手');
  console.log('=================================\n');

  // 读取 Bot Token
  const botToken = readTelegramToken();
  console.log(`✓ 找到 Telegram Bot Token`);
  console.log(`  Token: ${botToken.substring(0, 10)}...${botToken.substring(botToken.length - 5)}`);

  // 设置 Webhook
  const webhookOk = await setupWebhook(botToken);
  if (!webhookOk) {
    console.log('\n⚠️  Webhook 设置失败，但将继续...');
  }

  // 获取 User ID
  const userId = await getUserId(botToken);
  
  if (userId) {
    console.log(`\n✓ 检测到您的 Telegram User ID: ${userId}`);
    updateRenderYaml(userId);
  }

  console.log('\n=================================');
  console.log('配置完成!');
  console.log('=================================');
  console.log('\n下一步:');
  console.log('1. 提交更改到 GitHub');
  console.log('2. Render 会自动重新部署');
  console.log('3. 您的 Bot 现在应该可以响应您的消息了');
  console.log('\n如需修改配置，可以在 Render Dashboard 的环境变量中调整:');
  console.log('  - TELEGRAM_DM_POLICY: open(公开) / allowlist(仅白名单)');
  console.log('  - TELEGRAM_ALLOWED_USER_IDS: 允许的用户 ID（逗号分隔）');
}

main().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});