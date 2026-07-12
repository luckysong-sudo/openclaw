#!/usr/bin/env node

/**
 * OpenClaw Memory Manager
 * 记忆管理系统 - 实现分层记忆、向量检索、自动摘要
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const STORAGE_BASE = process.env.OPENCLAW_STORAGE_PATH || '/tmp/openclaw';
const STORAGE_SUBDIR = process.env.OPENCLAW_STORAGE_SUBDIR || 'openclaw';
const OPENCLAW_ROOT = join(STORAGE_BASE, STORAGE_SUBDIR);

// 记忆存储目录
const MEMORY_DIR = join(OPENCLAW_ROOT, 'memory');
const SHORT_TERM_DIR = join(MEMORY_DIR, 'short-term');
const MEDIUM_TERM_DIR = join(MEMORY_DIR, 'medium-term');
const LONG_TERM_DIR = join(MEMORY_DIR, 'long-term');
const VECTOR_DIR = join(MEMORY_DIR, 'vector');
const KNOWLEDGE_GRAPH_DIR = join(MEMORY_DIR, 'knowledge-graph');

// 记忆配置
const MEMORY_CONFIG = {
  shortTerm: {
    maxSize: 10,           // 最多保留 10 条短期记忆
    expiryMinutes: 60,     // 1 小时后过期
  },
  mediumTerm: {
    maxSize: 50,           // 最多保留 50 条中期记忆
    expiryHours: 24,       // 24 小时后压缩
  },
  longTerm: {
    maxSize: 200,          // 最多保留 200 条长期记忆
    summaryThreshold: 100, // 超过 100 条触发摘要
  },
  vector: {
    enabled: true,
    collectionName: 'openclaw-memory',
  },
  autoSummary: {
    enabled: true,
    intervalMinutes: 30,   // 每 30 分钟检查一次
    minMessagesForSummary: 20, // 至少 20 条消息才摘要
  }
};

/**
 * 确保记忆目录存在
 */
function ensureMemoryDirs() {
  const dirs = [MEMORY_DIR, SHORT_TERM_DIR, MEDIUM_TERM_DIR, LONG_TERM_DIR, VECTOR_DIR, KNOWLEDGE_GRAPH_DIR];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 添加记忆条目
 */
function addMemory(text, metadata = {}) {
  ensureMemoryDirs();
  
  const memoryEntry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    text,
    timestamp: new Date().toISOString(),
    type: 'short-term', // 初始类型为短期记忆
    metadata: {
      source: metadata.source || 'user',
      category: metadata.category || 'general',
      importance: metadata.importance || 'normal',
      ...metadata
    }
  };
  
  // 保存到短期记忆文件
  const filePath = join(SHORT_TERM_DIR, `${memoryEntry.id}.json`);
  writeFileSync(filePath, JSON.stringify(memoryEntry, null, 2));
  
  // 同时添加到向量索引
  if (MEMORY_CONFIG.vector.enabled) {
    addToVectorIndex(memoryEntry);
  }
  
  console.log(`📝 记忆已添加: ${memoryEntry.id} (${memoryEntry.type})`);
  return memoryEntry;
}

/**
 * 将记忆添加到向量索引
 */
function addToVectorIndex(memoryEntry) {
  const indexPath = join(VECTOR_DIR, 'index.json');
  let index = [];
  
  if (existsSync(indexPath)) {
    index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  }
  
  // 简单的向量表示（基于词频）
  const vector = simpleVectorize(memoryEntry.text);
  
  index.push({
    id: memoryEntry.id,
    vector,
    text: memoryEntry.text,
    timestamp: memoryEntry.timestamp,
    type: memoryEntry.type
  });
  
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

/**
 * 简单的文本向量化（基于词频）
 */
function simpleVectorize(text) {
  // 移除标点符号，分割成单词
  const words = text.toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 0);
  
  // 创建词频向量（简化版）
  const vector = {};
  const uniqueWords = [...new Set(words)];
  
  for (const word of uniqueWords) {
    const count = words.filter(w => w === word).length;
    vector[word] = count / words.length; // 归一化
  }
  
  return vector;
}

/**
 * 记忆晋升 - 从短期到中期到长期
 */
function promoteMemories() {
  ensureMemoryDirs();
  
  const shortTermFiles = getMemoryFiles(SHORT_TERM_DIR);
  const now = Date.now();
  
  for (const fileId of shortTermFiles) {
    const filePath = join(SHORT_TERM_DIR, `${fileId}.json`);
    if (!existsSync(filePath)) continue;
    
    const memory = JSON.parse(readFileSync(filePath, 'utf-8'));
    const age = now - new Date(memory.timestamp).getTime();
    
    // 短期记忆超过 30 分钟，晋升到中期
    if (age > MEMORY_CONFIG.shortTerm.expiryMinutes * 60 * 1000) {
      promoteToMediumTerm(memory);
      deleteMemoryFile(filePath);
    }
  }
  
  // 检查中期记忆是否需要晋升到长期
  const mediumTermFiles = getMemoryFiles(MEDIUM_TERM_DIR);
  for (const fileId of mediumTermFiles) {
    const filePath = join(MEDIUM_TERM_DIR, `${fileId}.json`);
    if (!existsSync(filePath)) continue;
    
    const memory = JSON.parse(readFileSync(filePath, 'utf-8'));
    const age = now - new Date(memory.timestamp).getTime();
    
    // 中期记忆超过 12 小时，晋升到长期
    if (age > 12 * 60 * 60 * 1000) {
      promoteToLongTerm(memory);
      deleteMemoryFile(filePath);
    }
  }
}

/**
 * 晋升到中期记忆
 */
function promoteToMediumTerm(memory) {
  memory.type = 'medium-term';
  memory.promotedAt = new Date().toISOString();
  
  const filePath = join(MEDIUM_TERM_DIR, `${memory.id}.json`);
  writeFileSync(filePath, JSON.stringify(memory, null, 2));
  console.log(`⬆️ 记忆已晋升到中期: ${memory.id}`);
}

/**
 * 晋升到长期记忆
 */
function promoteToLongTerm(memory) {
  memory.type = 'long-term';
  memory.promotedAt = new Date().toISOString();
  
  const filePath = join(LONG_TERM_DIR, `${memory.id}.json`);
  writeFileSync(filePath, JSON.stringify(memory, null, 2));
  console.log(`⬆️ 记忆已晋升到长期: ${memory.id}`);
  
  // 更新知识图谱
  updateKnowledgeGraph(memory);
}

/**
 * 删除记忆文件
 */
function deleteMemoryFile(filePath) {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (e) {
    console.error('删除记忆文件失败:', e.message);
  }
}

/**
 * 获取指定目录下的记忆文件 ID 列表
 */
function getMemoryFiles(dir) {
  if (!existsSync(dir)) return [];
  
  return require('fs').readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace('.json', ''));
}

/**
 * 搜索相似记忆
 */
function searchSimilarMemories(query, limit = 5) {
  ensureMemoryDirs();
  
  const queryVector = simpleVectorize(query);
  const allMemories = getAllMemories();
  
  // 计算相似度
  const scoredMemories = allMemories.map(memory => {
    const memoryVector = simpleVectorize(memory.text);
    const similarity = calculateSimilarity(queryVector, memoryVector);
    
    return {
      ...memory,
      similarity
    };
  });
  
  // 按相似度排序
  scoredMemories.sort((a, b) => b.similarity - a.similarity);
  
  return scoredMemories.slice(0, limit);
}

/**
 * 计算两个向量之间的余弦相似度
 */
function calculateSimilarity(vec1, vec2) {
  const allKeys = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (const key of allKeys) {
    const v1 = vec1[key] || 0;
    const v2 = vec2[key] || 0;
    
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }
  
  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (norm1 * norm2);
}

/**
 * 获取所有记忆
 */
function getAllMemories() {
  ensureMemoryDirs();
  
  const memories = [];
  
  // 从三个记忆层获取
  const layers = [SHORT_TERM_DIR, MEDIUM_TERM_DIR, LONG_TERM_DIR];
  for (const layer of layers) {
    const files = getMemoryFiles(layer);
    for (const fileId of files) {
      const filePath = join(layer, `${fileId}.json`);
      if (existsSync(filePath)) {
        const memory = JSON.parse(readFileSync(filePath, 'utf-8'));
        memories.push(memory);
      }
    }
  }
  
  // 按时间排序
  memories.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  return memories;
}

/**
 * 更新知识图谱
 */
function updateKnowledgeGraph(memory) {
  ensureMemoryDirs();
  
  const graphFile = join(KNOWLEDGE_GRAPH_DIR, 'graph.json');
  let graph = { nodes: [], edges: [] };
  
  if (existsSync(graphFile)) {
    graph = JSON.parse(readFileSync(graphFile, 'utf-8'));
  }
  
  // 简单的实体提取
  const entities = extractEntities(memory.text);
  
  // 添加节点
  for (const entity of entities) {
    if (!graph.nodes.find(n => n.id === entity.id)) {
      graph.nodes.push({
        id: entity.id,
        label: entity.label,
        type: entity.type,
        firstSeen: entity.firstSeen,
        lastSeen: new Date().toISOString()
      });
    } else {
      // 更新最后访问时间
      const node = graph.nodes.find(n => n.id === entity.id);
      node.lastSeen = new Date().toISOString();
    }
  }
  
  // 添加边（简化版：将所有实体相互连接）
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const edgeExists = graph.edges.find(e => 
        (e.source === entities[i].id && e.target === entities[j].id) ||
        (e.source === entities[j].id && e.target === entities[i].id)
      );
      
      if (!edgeExists) {
        graph.edges.push({
          source: entities[i].id,
          target: entities[j].id,
          relation: 'related',
          strength: 1,
          createdAt: new Date().toISOString()
        });
      }
    }
  }
  
  writeFileSync(graphFile, JSON.stringify(graph, null, 2));
}

/**
 * 简单的实体提取
 */
function extractEntities(text) {
  const entities = [];
  
  // 提取人名（简单模式）
  const personPattern = /([一-龥]{2,4})[先生女士朋友同学同事领导](?:说|讲|告诉|问|回复)/g;
  let match;
  while ((match = personPattern.exec(text)) !== null) {
    entities.push({
      id: `person_${match[1]}`,
      label: match[1],
      type: 'person',
      firstSeen: new Date().toISOString()
    });
  }
  
  // 提取关键词作为实体
  const keywords = text.match(/[一-龥]{2,}/g) || [];
  for (const keyword of keywords.slice(0, 5)) {
    entities.push({
      id: `concept_${keyword}`,
      label: keyword,
      type: 'concept',
      firstSeen: new Date().toISOString()
    });
  }
  
  return entities;
}

/**
 * 生成记忆摘要
 */
function generateSummary(memories) {
  if (memories.length === 0) return '';
  
  // 按日期分组
  const groupedByDate = {};
  for (const memory of memories) {
    const date = new Date(memory.timestamp).toLocaleDateString();
    if (!groupedByDate[date]) {
      groupedByDate[date] = [];
    }
    groupedByDate[date].push(memory);
  }
  
  // 生成每日摘要
  const summaries = [];
  for (const [date, dayMemories] of Object.entries(groupedByDate)) {
    const topics = [...new Set(dayMemories.map(m => m.metadata?.category || 'general'))];
    summaries.push(`📅 ${date}: 讨论了 ${topics.join('、')} 等话题`);
  }
  
  return summaries.join('\n');
}

/**
 * 自动摘要功能
 */
function autoSummarize() {
  ensureMemoryDirs();
  
  const shortTermFiles = getMemoryFiles(SHORT_TERM_DIR);
  
  if (shortTermFiles.length >= MEMORY_CONFIG.autoSummary.minMessagesForSummary) {
    const memories = shortTermFiles.map(id => {
      const filePath = join(SHORT_TERM_DIR, `${id}.json`);
      if (existsSync(filePath)) {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
      }
      return null;
    }).filter(m => m !== null);
    
    const summary = generateSummary(memories);
    console.log('📝 生成短期记忆摘要:');
    console.log(summary);
    
    // 将摘要保存到中期记忆
    const summaryMemory = {
      id: `summary_${Date.now().toString(36)}`,
      text: summary,
      timestamp: new Date().toISOString(),
      type: 'medium-term',
      isSummary: true,
      metadata: {
        source: 'auto-summary',
        category: 'summary',
        includesMemories: memories.length
      }
    };
    
    promoteToMediumTerm(summaryMemory);
  }
}

/**
 * 清理过期记忆
 */
function cleanupExpiredMemories() {
  ensureMemoryDirs();
  
  const now = Date.now();
  
  // 清理短期记忆
  cleanupExpiredDir(SHORT_TERM_DIR, MEMORY_CONFIG.shortTerm.expiryMinutes * 60 * 1000);
  
  // 清理中期记忆
  cleanupExpiredDir(MEDIUM_TERM_DIR, MEMORY_CONFIG.mediumTerm.expiryHours * 60 * 60 * 1000);
  
  // 清理长期记忆（超过阈值时删除最不重要的）
  cleanupByLimit(LONG_TERM_DIR, MEMORY_CONFIG.longTerm.maxSize);
}

/**
 * 清理过期目录中的文件
 */
function cleanupExpiredDir(dir, expiryMs) {
  if (!existsSync(dir)) return;
  
  const files = getMemoryFiles(dir);
  for (const fileId of files) {
    const filePath = join(dir, `${fileId}.json`);
    if (!existsSync(filePath)) continue;
    
    const memory = JSON.parse(readFileSync(filePath, 'utf-8'));
    const age = Date.now() - new Date(memory.timestamp).getTime();
    
    if (age > expiryMs) {
      deleteMemoryFile(filePath);
      console.log(`🗑️ 清理过期记忆: ${memory.id}`);
    }
  }
}

/**
 * 按数量限制清理目录
 */
function cleanupByLimit(dir, maxCount) {
  if (!existsSync(dir)) return;
  
  const files = getMemoryFiles(dir);
  if (files.length > maxCount) {
    // 按时间排序，删除最旧的
    const memories = files.map(id => {
      const filePath = join(dir, `${id}.json`);
      if (existsSync(filePath)) {
        return {
          id,
          filePath,
          memory: JSON.parse(readFileSync(filePath, 'utf-8'))
        };
      }
      return null;
    }).filter(m => m !== null);
    
    memories.sort((a, b) => new Date(a.memory.timestamp) - new Date(b.memory.timestamp));
    
    const toDelete = memories.slice(0, memories.length - maxCount);
    for (const item of toDelete) {
      deleteMemoryFile(item.filePath);
      console.log(`🗑️ 清理过期长期记忆: ${item.id}`);
    }
  }
}

/**
 * 导出模块
 */
export {
  addMemory,
  searchSimilarMemories,
  getAllMemories,
  promoteMemories,
  autoSummarize,
  cleanupExpiredMemories,
  MEMORY_CONFIG
};

// 命令行模式
if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2];
  
  switch (action) {
    case 'add':
      const text = process.argv.slice(3).join(' ');
      const memory = addMemory(text);
      console.log('添加的记忆:', JSON.stringify(memory, null, 2));
      break;
      
    case 'search':
      const query = process.argv.slice(3).join(' ');
      const results = searchSimilarMemories(query);
      console.log('搜索结果:', JSON.stringify(results, null, 2));
      break;
      
    case 'list':
      const allMemories = getAllMemories();
      console.log(`共 ${allMemories.length} 条记忆:`);
      console.log(JSON.stringify(allMemories, null, 2));
      break;
      
    case 'promote':
      promoteMemories();
      console.log('记忆晋升完成');
      break;
      
    case 'summarize':
      autoSummarize();
      console.log('自动摘要完成');
      break;
      
    case 'cleanup':
      cleanupExpiredMemories();
      console.log('清理完成');
      break;
      
    default:
      console.log('记忆管理器');
      console.log('用法: memory-manager <action> [args]');
      console.log('动作: add, search, list, promote, summarize, cleanup');
  }
}