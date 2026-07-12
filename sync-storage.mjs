#!/usr/bin/env node

/**
 * Hugging Face Datasets Storage Sync
 * 同步 OpenClaw 数据到 Hugging Face Datasets
 * 这样 Render 无状态服务可以持久化记忆
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// 配置
const HF_DATASET_ID = process.env.HF_DATASET_ID || 'luckysong-sudo/openclaw-storage';
const HF_TOKEN = process.env.HF_TOKEN || '';
const STORAGE_PATH = process.env.OPENCLAW_STORAGE_PATH || '/tmp/openclaw/openclaw';
const SYNC_DIRECTION = process.env.SYNC_DIRECTION || 'both'; // 'upload', 'download', 'both'

console.log('=== Hugging Face Storage Sync ===');
console.log(`Dataset: ${HF_DATASET_ID}`);
console.log(`Storage Path: ${STORAGE_PATH}`);
console.log(`Sync Direction: ${SYNC_DIRECTION}`);
console.log('=================================\n');

/**
 * 执行命令的辅助函数
 */
function runCommand(command, cwd = null) {
  try {
    const options = cwd ? { cwd, stdio: 'inherit' } : {};
    return execSync(command, options);
  } catch (error) {
    console.error(`命令执行失败: ${command}`);
    console.error(error.message);
    throw error;
  }
}

/**
 * 下载到本地
 */
function downloadFromHF() {
  console.log('📥 从 Hugging Face 下载数据...');
  
  if (!existsSync(STORAGE_PATH)) {
    mkdirSync(STORAGE_PATH, { recursive: true });
  }
  
  try {
    // 使用 huggingface-cli 下载
    const command = `huggingface-cli download ${HF_DATASET_ID} data/ --repo-type dataset --local-dir ${STORAGE_PATH}`;
    runCommand(command);
    console.log('✅ 数据下载完成');
    return true;
  } catch (error) {
    console.warn('⚠️  下载失败（可能是首次运行，没有数据）:', error.message);
    console.log('📁 已创建空存储目录');
    return false;
  }
}

/**
 * 上传到 Hugging Face
 */
function uploadToHF() {
  console.log('📤 上传数据到 Hugging Face...');
  
  if (!existsSync(STORAGE_PATH)) {
    console.warn('⚠️  存储目录不存在，跳过上传');
    return false;
  }
  
  // 检查是否有数据
  const files = execSync(`dir /b "${STORAGE_PATH}" 2>nul || ls -A "${STORAGE_PATH}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
  if (!files) {
    console.log('ℹ️  没有数据需要上传');
    return false;
  }
  
  try {
    // 创建临时目录用于上传
    const tempDir = join(STORAGE_PATH, '..', 'hf-sync-temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
    
    // 复制数据到临时目录
    const copyCommand = `xcopy /E /I /Y "${STORAGE_PATH}\\*" "${tempDir}\\" 2>nul || cp -r "${STORAGE_PATH}"/* "${tempDir}/"`;
    try {
      runCommand(copyCommand);
    } catch (e) {
      console.warn('⚠️  复制文件时出错，尝试直接上传...');
    }
    
    // 使用 huggingface-cli 上传
    const pushCommand = `cd "${tempDir}" && huggingface-cli upload ${HF_DATASET_ID} data/ --repo-type dataset`;
    runCommand(pushCommand);
    
    // 清理临时目录
    const cleanupCommand = `rm -rf "${tempDir}"`;
    try {
      runCommand(cleanupCommand);
    } catch (e) {
      // 忽略清理失败
    }
    
    console.log('✅ 数据上传完成');
    return true;
  } catch (error) {
    console.error('❌ 上传失败:', error.message);
    return false;
  }
}

/**
 * 初始化 Hugging Face 仓库
 */
function initHFRepo() {
  console.log('🔧 初始化 Hugging Face 仓库...');
  
  if (!HF_TOKEN) {
    console.warn('⚠️  未设置 HF_TOKEN 环境变量');
    console.log('请按照以下步骤获取 Token:');
    console.log('1. 访问 https://huggingface.co/settings/tokens');
    console.log('2. 创建一个新的访问令牌（读取数据权限）');
    console.log('3. 在 Render 中添加环境变量 HF_TOKEN');
    return false;
  }
  
  try {
    // 登录 Hugging Face
    runCommand(`echo ${HF_TOKEN} | huggingface-cli login --token-stdin`);
    console.log('✅ Hugging Face 登录成功');
    return true;
  } catch (error) {
    console.error('❌ Hugging Face 登录失败:', error.message);
    return false;
  }
}

// 主流程
async function main() {
  const action = process.argv[2] || 'sync';
  
  // 确保已登录
  initHFRepo();
  
  switch (action) {
    case 'download':
    case 'pull':
      downloadFromHF();
      break;
      
    case 'upload':
    case 'push':
      uploadToHF();
      break;
      
    case 'sync':
    default:
      if (SYNC_DIRECTION === 'download' || SYNC_DIRECTION === 'both') {
        downloadFromHF();
      }
      if (SYNC_DIRECTION === 'upload' || SYNC_DIRECTION === 'both') {
        uploadToHF();
      }
      break;
  }
  
  console.log('\n✅ 存储同步完成');
}

main().catch(console.error);