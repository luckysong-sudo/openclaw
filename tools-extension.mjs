#!/usr/bin/env node

/**
 * OpenClaw Tools Extension
 * 工具与插件扩展 - MCP、API集成、数据库、文件处理
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const STORAGE_BASE = process.env.OPENCLAW_STORAGE_PATH || '/tmp/openclaw';
const STORAGE_SUBDIR = process.env.OPENCLAW_STORAGE_SUBDIR || 'openclaw';
const OPENCLAW_ROOT = join(STORAGE_BASE, STORAGE_SUBDIR);

// ==================== MCP 服务器配置 ====================

/**
 * MCP 服务器配置
 */
const MCP_SERVERS = {
  // 文件系统 MCP (已内置)
  filesystem: {
    name: 'filesystem',
    command: 'node',
    args: [
      process.env.MCP_FILESYSTEM_PATH || '/usr/local/bin/mcp-server-filesystem',
      OPENCLAW_ROOT
    ],
    enabled: false, // 默认禁用，需要安装
    description: '文件系统访问'
  },
  // GitHub MCP
  github: {
    name: 'github',
    command: 'node',
    args: ['-e', 'require("@modelcontextprotocol/server-github")'],
    enabled: false,
    description: 'GitHub 操作',
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || ''
    }
  },
  // PostgreSQL MCP
  postgres: {
    name: 'postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    enabled: false,
    description: 'PostgreSQL 数据库',
    env: {
      POSTGRES_URL: process.env.POSTGRES_URL || ''
    }
  }
};

/**
 * 初始化 MCP 服务器
 */
function initMCPServers() {
  const mcpConfig = { servers: {} };
  
  for (const [key, server] of Object.entries(MCP_SERVERS)) {
    if (server.enabled) {
      mcpConfig.servers[key] = {
        type: 'stdio',
        command: server.command,
        args: server.args,
        env: server.env || {},
        workingDir: OPENCLAW_ROOT
      };
    }
  }
  
  return mcpConfig;
}

// ==================== API 集成 ====================

/**
 * 天气查询 (使用 wttr.in 免费 API)
 */
async function getWeather(city) {
  try {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (response.ok) {
      const data = await response.json();
      const current = data.current_condition[0];
      const area = data.nearest_area[0];
      
      return {
        city: area.areaName[0].value,
        temperature: current.temp_C,
        feelsLike: current.FeelsLikeC,
        weatherDesc: current.weatherDesc[0].value,
        humidity: current.humidity,
        windSpeed: current.windspeedKmph,
        visibility: current.visibility,
        iconUrl: current.weatherIconUrl[0].value
      };
    }
  } catch (e) {
    return { error: `天气查询失败: ${e.message}` };
  }
}

/**
 * 新闻获取 (使用 NewsAPI 或免费源)
 */
async function getNews(category = 'general', language = 'zh') {
  const NEWS_API_KEY = process.env.NEWS_API_KEY || '';
  
  if (NEWS_API_KEY) {
    try {
      const response = await fetch(
        `https://newsapi.org/v2/top-headlines?country=${language === 'zh' ? 'cn' : 'us'}&category=${category}&apiKey=${NEWS_API_KEY}`,
        { method: 'GET' }
      );
      if (response.ok) {
        const data = await response.json();
        return { articles: data.articles?.slice(0, 10) || [] };
      }
    } catch (e) {
      return { error: `新闻获取失败: ${e.message}` };
    }
  }
  
  // 备用方案：使用 RSS
  return { message: '新闻 API 未配置，请设置 NEWS_API_KEY 环境变量' };
}

/**
 * 股票查询 (使用免费的 financial modeling prep 或其他)
 */
async function getStock(symbol) {
  const FMP_API_KEY = process.env.FMP_API_KEY || '';
  
  if (FMP_API_KEY) {
    try {
      const response = await fetch(
        `https://financialmodelingprep.com/api/v3/quota/${symbol}?apikey=${FMP_API_KEY}`
      );
      if (response.ok) {
        const data = await response.json();
        return data[0];
      }
    } catch (e) {
      return { error: `股票查询失败: ${e.message}` };
    }
  }
  
  // 简易查询：返回模拟数据
  return {
    symbol,
    message: '股票 API 未配置，请设置 FMP_API_KEY 环境变量'
  };
}

/**
 * 汇率转换
 */
async function convertCurrency(amount, from, to) {
  try {
    const response = await fetch(
      `https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to}`
    );
    if (response.ok) {
      const data = await response.json();
      return {
        amount,
        from,
        to,
        rate: data.rates[to],
        result: data.amount * data.rates[to]
      };
    }
  } catch (e) {
    return { error: `汇率查询失败: ${e.message}` };
  }
}

// ==================== 数据库连接 ====================

/**
 * SQLite 查询 (使用 better-sqlite3)
 */
class SQLiteManager {
  constructor(dbPath = join(OPENCLAW_ROOT, 'openclaw.db')) {
    this.dbPath = dbPath;
    this.db = null;
  }
  
  connect() {
    try {
      // 动态导入 SQLite
      const Database = require('better-sqlite3')(this.dbPath);
      this.db = Database();
      this.db.pragma('journal_mode = WAL');
      return true;
    } catch (e) {
      console.log('SQLite 不可用，请先安装 better-sqlite3');
      return false;
    }
  }
  
  query(sql, params = []) {
    if (!this.db) {
      if (!this.connect()) return null;
    }
    
    try {
      const stmt = this.db.prepare(sql);
      if (params.length > 0) {
        return stmt.all(...params);
      }
      return stmt.all();
    } catch (e) {
      return { error: e.message };
    }
  }
  
  execute(sql) {
    if (!this.db) {
      if (!this.connect()) return null;
    }
    
    try {
      const stmt = this.db.prepare(sql);
      const info = stmt.run();
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    } catch (e) {
      return { error: e.message };
    }
  }
  
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ==================== 文件处理 ====================

/**
 * PDF 处理
 */
async function parsePDF(filePath) {
  try {
    // 使用 pdftotext 命令行工具
    const output = execSync(`pdftotext "${filePath}" -`, { encoding: 'utf-8' });
    return { content: output };
  } catch (e) {
    return { error: `PDF 处理失败: ${e.message}` };
  }
}

/**
 * Excel 处理
 */
async function parseExcel(filePath) {
  try {
    // 使用 xlsx CLI 工具
    const output = execSync(`xlsx-to-json "${filePath}"`, { encoding: 'utf-8' });
    return { data: JSON.parse(output) };
  } catch (e) {
    return { error: `Excel 处理失败: ${e.message}` };
  }
}

/**
 * 图片处理 (获取信息)
 */
async function getImageInfo(filePath) {
  try {
    // 使用 identify (ImageMagick) 或 file 命令
    const output = execSync(`file "${filePath}"`, { encoding: 'utf-8' });
    return { info: output.trim() };
  } catch (e) {
    return { error: `图片信息获取失败: ${e.message}` };
  }
}

/**
 * 文本摘要
 */
async function summarizeText(text, maxLength = 200) {
  if (!text || text.length <= maxLength) return text;
  
  // 简单截断 + 摘要标记
  const truncated = text.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const summary = lastPeriod > 0 ? truncated.substring(0, lastPeriod + 1) : truncated + '...';
  
  return {
    summary,
    originalLength: text.length,
    summaryLength: summary.length,
    compression: `${Math.round((1 - summary.length / text.length) * 100)}%`
  };
}

// ==================== 工具注册表 ====================

const TOOLS_REGISTRY = {
  // API 工具
  weather: {
    name: '天气查询',
    description: '查询指定城市的天气信息',
    parameters: ['城市名称'],
    asyncFn: getWeather
  },
  news: {
    name: '新闻获取',
    description: '获取最新新闻',
    parameters: ['类别 (可选)', '语言 (可选)'],
    asyncFn: getNews
  },
  stock: {
    name: '股票查询',
    description: '查询股票信息',
    parameters: ['股票代码'],
    asyncFn: getStock
  },
  currency: {
    name: '汇率转换',
    description: '货币汇率转换',
    parameters: ['金额', '原货币', '目标货币'],
    asyncFn: convertCurrency
  },
  // 文件工具
  pdf: {
    name: 'PDF 解析',
    description: '解析 PDF 文件内容',
    parameters: ['文件路径'],
    asyncFn: parsePDF
  },
  excel: {
    name: 'Excel 解析',
    description: '解析 Excel 文件',
    parameters: ['文件路径'],
    asyncFn: parseExcel
  },
  image: {
    name: '图片信息',
    description: '获取图片基本信息',
    parameters: ['文件路径'],
    asyncFn: getImageInfo
  },
  summarize: {
    name: '文本摘要',
    description: '生成文本摘要',
    parameters: ['文本', '最大长度 (可选)'],
    asyncFn: summarizeText
  }
};

/**
 * 执行工具
 */
async function executeTool(toolName, ...args) {
  const tool = TOOLS_REGISTRY[toolName];
  if (!tool) {
    return { error: `未知工具: ${toolName}` };
  }
  
  try {
    return await tool.asyncFn(...args);
  } catch (e) {
    return { error: `${tool.name} 执行失败: ${e.message}` };
  }
}

/**
 * 列出所有可用工具
 */
function listTools() {
  const tools = [];
  for (const [name, tool] of Object.entries(TOOLS_REGISTRY)) {
    tools.push({
      name,
      displayName: tool.name,
      description: tool.description,
      parameters: tool.parameters
    });
  }
  return tools;
}

// ==================== 导出 ====================

export {
  TOOLS_REGISTRY,
  executeTool,
  listTools,
  SQLiteManager,
  initMCPServers,
  getWeather,
  getNews,
  getStock,
  convertCurrency
};

// 命令行模式
if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2];
  
  switch (action) {
    case 'list':
      const tools = listTools();
      console.log('可用工具:');
      tools.forEach(t => console.log(`  ${t.name} - ${t.displayName}: ${t.description}`));
      break;
      
    case 'execute':
      const tool = process.argv[3];
      const args = process.argv.slice(4);
      const result = await executeTool(tool, ...args);
      console.log(JSON.stringify(result, null, 2));
      break;
      
    case 'weather':
      const city = process.argv[3] || '北京';
      const weather = await getWeather(city);
      console.log(JSON.stringify(weather, null, 2));
      break;
      
    case 'currency':
      const amount = parseFloat(process.argv[3]) || 1;
      const from = process.argv[4] || 'USD';
      const to = process.argv[5] || 'CNY';
      const rate = await convertCurrency(amount, from, to);
      console.log(JSON.stringify(rate, null, 2));
      break;
      
    default:
      console.log('OpenClaw 工具扩展');
      console.log('用法: tools-extension <action> [args]');
      console.log('动作: list, execute, weather, currency');
  }
}