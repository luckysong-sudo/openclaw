#!/usr/bin/env node

/**
 * OpenClaw Temp Mail Tool
 * 临时邮箱工具 - 用于接收验证码
 * 使用 guerrillamail.com 免费 API
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const STORAGE_BASE = process.env.OPENCLAW_STORAGE_PATH || '/tmp/openclaw';
const STORAGE_SUBDIR = process.env.OPENCLAW_STORAGE_SUBDIR || 'openclaw';
const OPENCLAW_ROOT = join(STORAGE_BASE, STORAGE_SUBDIR);

// Guerrilla Mail API 配置
const GM_API = 'https://www.guerrillamail.com';
const CACHE_FILE = join(OPENCLAW_ROOT, 'temp-mail-cache.json');

/**
 * 加载缓存数据
 */
function loadCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    // ignore
  }
  return { email: '', token: '', session_id: '', messages: [] };
}

/**
 * 保存缓存数据
 */
function saveCache(data) {
  try {
    mkdirSync(OPENCLAW_ROOT, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('保存缓存失败:', e.message);
  }
}

/**
 * 获取可用的随机用户名
 */
function getRandomUsername() {
  const adjectives = ['swift', 'cool', 'smart', 'fast', 'calm', 'bold', 'bright', 'deep', 'free', 'good'];
  const nouns = ['hawk', 'wolf', 'fox', 'eagle', 'tiger', 'bear', 'lion', 'dragon', 'phoenix', 'storm'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 999);
  return `${adj}${noun}${num}`;
}

/**
 * 获取可用的域名列表
 */
function getAvailableDomains() {
  return ['guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'grr.la', 'spam4.me'];
}

/**
 * 创建新的临时邮箱
 */
async function createEmail() {
  console.log('📧 正在创建临时邮箱...');
  
  try {
    const username = getRandomUsername();
    const domains = await fetchDomains();
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const email = `${username}@${domain}`;
    
    // 初始化会话
    const cache = loadCache();
    cache.email = email;
    cache.token = username;
    cache.domain = domain;
    cache.created_at = Date.now();
    cache.messages = [];
    saveCache(cache);
    
    console.log(`✅ 临时邮箱已创建: ${email}`);
    return email;
  } catch (e) {
    console.error('创建邮箱失败:', e.message);
    return null;
  }
}

/**
 * 获取可用域名列表
 */
async function fetchDomains() {
  try {
    const response = await fetch(`${GM_API}/shared-email-domains.php`, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (response.ok) {
      const text = await response.text();
      // 解析返回的域名列表
      const domains = text.split(',').map(d => d.trim()).filter(d => d.length > 0);
      return domains.length > 0 ? domains : getAvailableDomains();
    }
  } catch (e) {
    // ignore
  }
  return getAvailableDomains();
}

/**
 * 检查新邮件
 */
async function checkMessages() {
  const cache = loadCache();
  
  if (!cache.email) {
    console.log('⚠️  没有活跃的临时邮箱，请先创建');
    return [];
  }
  
  try {
    const response = await fetch(`${GM_API}/openapi/reader/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        action: 'check_messages',
        email: cache.email,
        secret: cache.token || ''
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.success && data.messages) {
        // 合并新旧邮件
        const existingIds = new Set(cache.messages.map(m => m.id));
        const newMessages = data.messages.filter(m => !existingIds.has(m.id));
        
        for (const msg of newMessages) {
          // 获取邮件详情
          try {
            const detailResponse = await fetch(`${GM_API}/openapi/access/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                action: 'view_message',
                email: cache.email,
                msg_id: msg.id,
                secret: cache.token || ''
              })
            });
            
            if (detailResponse.ok) {
              const detail = await detailResponse.json();
              msg.body = detail.html || detail.text || detail.body || '';
              msg.subject = msg.subject || '(无主题)';
            }
          } catch (e) {
            // ignore detail fetch errors
          }
        }
        
        cache.messages = [...cache.messages, ...newMessages];
        saveCache(cache);
        
        console.log(`📨 发现 ${newMessages.length} 封新邮件`);
        return cache.messages;
      }
    }
  } catch (e) {
    console.log('检查邮件失败:', e.message);
  }
  
  return cache.messages || [];
}

/**
 * 获取最新邮件详情
 */
async function getLatestMessage() {
  const cache = loadCache();
  const messages = await checkMessages();
  
  if (messages.length === 0) {
    console.log('📭 没有新邮件');
    return null;
  }
  
  const latest = messages[messages.length - 1];
  console.log(`📬 最新邮件:`);
  console.log(`   主题: ${latest.subject}`);
  console.log(`   发件人: ${latest.from}`);
  console.log(`   时间: ${new Date(parseInt(latest.time) * 1000).toLocaleString('zh-CN')}`);
  
  return latest;
}

/**
 * 从内容中提取验证码或链接
 */
function extractCodeOrLink(content) {
  if (!content) return null;
  
  // 移除 HTML 标签
  const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  
  // 提取6位数字验证码
  const codeMatch = text.match(/\b\d{4,8}\b/g);
  if (codeMatch) {
    return codeMatch[0];
  }
  
  // 提取邀请码/配对码
  const inviteMatch = text.match(/invite[_-]?code[:\s]*([^\s,]+)/i);
  if (inviteMatch) {
    return inviteMatch[1];
  }
  
  // 提取URL
  const urlMatch = text.match(/(https?:\/\/[^\s<>"']+)/);
  if (urlMatch) {
    return urlMatch[1];
  }
  
  return null;
}

/**
 * 处理临时邮箱命令
 */
export async function handleTempMailCommand(action, args = {}) {
  const cache = loadCache();
  
  switch (action) {
    case 'create':
      return await createEmail();
      
    case 'check':
      return {
        messages: await checkMessages(),
        email: cache.email
      };
      
    case 'latest': {
      const msg = await getLatestMessage();
      if (msg && msg.body) {
        const extracted = extractCodeOrLink(msg.body);
        return {
          message: {
            subject: msg.subject,
            from: msg.from,
            time: msg.time,
            body: msg.body
          },
          extractedCode: extracted
        };
      }
      return { message: null, extractedCode: null };
    }
      
    case 'status':
      return {
        email: cache.email || '未创建',
        messageCount: cache.messages?.length || 0,
        created: cache.created_at ? new Date(cache.created_at).toLocaleString('zh-CN') : 'N/A'
      };
      
    case 'help':
      return {
        commands: {
          'temp-mail create': '创建新的临时邮箱',
          'temp-mail check': '检查新邮件',
          'temp-mail latest': '获取最新邮件内容',
          'temp-mail status': '查看当前邮箱状态',
          'temp-mail help': '显示帮助信息'
        }
      };
      
    default:
      return { error: `未知操作: ${action}` };
  }
}

// 命令行模式
if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2] || 'status';
  const result = await handleTempMailCommand(action);
  console.log(JSON.stringify(result, null, 2));
}