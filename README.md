# OpenClaw Agnes - Render.com Deployment

一个从 Hugging Face Spaces 迁移到 **Render.com** 的 OpenClaw AI 助手项目。

## 🤖 项目简介

| 属性 | 值 |
|------|-----|
| **Agent 名称** | Tepid 💖 |
| **人格** | 温柔、体贴、善解人意的中国女性 AI 助手 |
| **语言** | 中文（简体） |
| **部署平台** | Render.com (Free) |
| **主模型** | NVIDIA GLM-5.2 |
| **备用模型** | Agnes 2.0 Flash |
| **内容过滤** | ❌ 已禁用（自由对话） |

## ✨ 功能特性

### 1. 多渠道对话
| 渠道 | 状态 | 说明 |
|------|------|------|
| **Web UI** | ✅ | 无认证，直接访问对话框 |
| **Telegram** | ✅ | @freetepid_bot |
| **Shell** | ✅ | 全部命令允许，不限目录 |

### 2. 记忆系统
| 功能 | 说明 |
|------|------|
| **分层记忆** | 短期/中期/长期三级记忆体系 |
| **向量检索** | 基于词频的语义搜索 |
| **知识图谱** | 自动提取实体和关系 |
| **自动摘要** | 定期压缩长对话历史 |
| **持久化** | Hugging Face Datasets 同步 |

### 3. 工具扩展
| 工具 | 功能 | 状态 |
|------|------|------|
| **天气查询** | 查询城市天气 | ✅ |
| **新闻获取** | 最新新闻（需 API Key） | 🔵 可选 |
| **股票查询** | 查询股票信息（需 API Key） | 🔵 可选 |
| **汇率转换** | 货币汇率计算 | ✅ |
| **临时邮箱** | guerrillamail 临时邮箱 | ✅ |
| **文件处理** | PDF/Excel/图片 | 🔵 需安装依赖 |

### 4. 模型配置
| 优先级 | 模型 | Provider | 最大 Tokens |
|--------|------|----------|-------------|
| **主模型** | GLM-5.2 | NVIDIA API | 16,384 |
| **备用** | Agnes 2.0 Flash | Agnes API | 8,192 |

## 🚀 快速开始

### Render.com 部署

1. **Fork 此仓库** 到你的 GitHub 账号
2. **登录 Render** → New Web Service → 连接 GitHub 仓库
3. **配置环境变量**（见下方）
4. **使用 `render.yaml` 自动部署**

### 环境变量配置

#### 必需变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `AGNES_API_KEY` | Agnes API 密钥 | - |
| `NVIDIA_API_KEY` | NVIDIA API 密钥 | - |
| `HF_TOKEN` | Hugging Face Token（记忆持久化） | - |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | - |

#### 可选变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `OPENCLAW_PROVIDER_ID` | agnes | 提供商 ID |
| `OPENCLAW_MODEL_ID` | agnes-2.0-flash | 模型 ID |
| `NVIDIA_MODEL_ID` | z-ai/glm-5.2 | NVIDIA 模型 ID |
| `AGNES_BASE_URL` | https://apihub.agnes-ai.com/v1 | Agnes API 地址 |
| `NVIDIA_BASE_URL` | https://integrate.api.nvidia.com/v1 | NVIDIA API 地址 |
| `OPENCLAW_DISABLE_DEVICE_PAIRING` | true | 禁用设备配对 |
| `TZ` | Asia/Shanghai | 时区 |
| `OPENCLAW_CONTEXT_WINDOW` | 200000 | 上下文窗口大小 |
| `OPENCLAW_MAX_TOKENS` | 8192 | 最大输出 token 数 |
| `HF_DATASET_ID` | officelucky/openclawdatas | HF 数据集 ID |
| `HF_SYNC_ON_START` | true | 启动时下载记忆 |
| `HF_SYNC_ON_STOP` | true | 停止时上传记忆 |
| `TELEGRAM_DM_POLICY` | open | 私信策略：open/allowlist/pairing |
| `TELEGRAM_ALLOWED_USER_IDS` | - | 允许的用户 ID（逗号分隔） |
| `TELEGRAM_AUTO_ALLOW_FIRST_DM` | true | 自动允许第一个私信 |
| `OPENCLAW_TELEGRAM_ENABLED` | true | 是否启用 Telegram |
| `NEWS_API_KEY` | - | 新闻 API 密钥（可选） |
| `FMP_API_KEY` | - | 股票 API 密钥（可选） |

#### 可选工具 API 密钥

| 变量名 | 说明 | 获取地址 |
|--------|------|----------|
| `NEWS_API_KEY` | 新闻 API | https://newsapi.org |
| `FMP_API_KEY` | 金融数据 API | https://financialmodelingprep.com |
| `GITHUB_TOKEN` | GitHub 访问令牌 | https://github.com/settings/tokens |
| `POSTGRES_URL` | PostgreSQL 连接串 | 你的数据库提供商 |

## 📁 项目结构

```
├── render.yaml              # Render.com 部署配置
├── start-gateway.mjs        # 主启动脚本
├── memory-manager.mjs       # 记忆管理系统
├── tools-extension.mjs      # 工具扩展（天气/新闻/股票等）
├── temp-mail-tool.mjs       # 临时邮箱工具
├── sync-storage.mjs         # HF 存储同步脚本
├── setup-telegram.mjs       # Telegram 配置助手
├── setup-swap.sh            # Swap 空间配置
├── setup-tools.sh           # 工具安装脚本
├── package.json             # Node.js 依赖配置
├── .gitignore               # Git 忽略配置
├── skills/                  # OpenClaw Skills
│   └── temp-mail/           # 临时邮箱 Skill
├── Dockerfile               # 原始 HF Docker 配置
└── start-openclaw.sh        # 原始 HF 启动脚本
```

## 💾 记忆持久化

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    Render 容器 (无状态)                      │
│                                                             │
│  /tmp/openclaw/                                             │
│  ├── memory/                         ← 分层记忆             │
│  │   ├── short-term/              ← 短期记忆 (1小时)       │
│  │   ├── medium-term/             ← 中期记忆 (24小时)      │
│  │   ├── long-term/               ← 长期记忆 (200条上限)   │
│  │   ├── vector/                  ← 向量索引              │
│  │   └── knowledge-graph/         ← 知识图谱              │
│  ├── openclaw/                           │
│  │   ├── workspace/                   ← 工作区文件         │
│  │   └── openclaw.json                ← 配置文件           │
│  └── temp-mail-cache.json             ← 临时邮箱缓存       │
└─────────────────────────────────────────────────────────────┘
                            ↕ HF 同步
┌─────────────────────────────────────────────────────────────┐
│              Hugging Face Datasets                           │
│                                                              │
│  officelucky/openclawdatas                                  │
│  └── data/                           ← 完整备份 /tmp/openclaw│
└─────────────────────────────────────────────────────────────┘
```

### 同步时机

| 时机 | 操作 | 说明 |
|------|------|------|
| **启动时** | 下载 | 从 HF 恢复记忆数据 |
| **关闭时** | 上传 | 将记忆数据保存到 HF |

## 🔧 维护命令

### 记忆管理

```bash
# 查看所有记忆
node memory-manager.mjs list

# 添加记忆
node memory-manager.mjs add "用户喜欢编程"

# 搜索记忆
node memory-manager.mjs search "编程"

# 手动触发记忆晋升
node memory-manager.mjs promote

# 生成摘要
node memory-manager.mjs summarize

# 清理过期记忆
node memory-manager.mjs cleanup
```

### 工具扩展

```bash
# 查看所有可用工具
node tools-extension.mjs list

# 查询天气
node tools-extension.mjs weather 北京

# 汇率转换
node tools-extension.mjs currency 100 USD CNY
```

### HF 存储同步

```bash
# 下载记忆
node sync-storage.mjs download

# 上传记忆
node sync-storage.mjs upload

# 双向同步
node sync-storage.mjs sync
```

## ⚠️ 注意事项

### Render 免费版限制

| 限制 | 说明 |
|------|------|
| **休眠** | 90 天未访问后休眠，唤醒需 ~30 秒 |
| **存储** | 使用 `/tmp`，重启后数据丢失（需 HF 持久化） |
| **带宽** | 有月度数据传输限制 |
| **CPU/RAM** | 免费套餐资源有限 |
| **Swap** | 已配置 512MB Swap |
| **权限** | 无 root/sudo 权限 |

### 重要提醒

1. **必须配置 `HF_TOKEN`**：否则记忆数据会在容器重启后丢失
2. **必须配置 `NVIDIA_API_KEY`**：否则无法使用主模型 GLM-5.2
3. **内容过滤已禁用**：任何人都可以与 AI 自由对话
4. **Web UI 无认证**：建议通过 Render 的 private URL 访问

## 🔗 相关链接

- [Render 文档](https://render.com/docs)
- [Agnes AI 文档](https://agnes-ai.com/zh-Hans/docs/cid1)
- [NVIDIA API Catalog](https://build.nvidia.com)
- [Hugging Face Datasets](https://huggingface.co/datasets)
- [Telegram Bot 文档](https://core.telegram.org/bots)