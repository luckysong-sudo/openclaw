# OpenClaw Agnes - Render.com Deployment

这是一个从 Hugging Face Spaces 迁移到 **Render.com** 的 OpenClaw AI 助手项目。

## 项目简介

- **AI 模型**: Agnes 2.0 Flash (agnes-2.0-flash)
- **API**: Agnes AI (apihub.agnes-ai.com)
- **部署平台**: Render.com
- **Telegram 支持**: 可选

## Render.com 部署步骤

### 1. 准备工作

确保你已有以下密钥：
- **Agnes API Key** - 从 [Agnes AI](https://agnes-ai.com) 获取
- **Telegram Bot Token** (可选) - 从 [@BotFather](https://t.me/BotFather) 获取

### 2. 创建 Render 账户

访问 https://render.com 并注册账户。

### 3. 连接 GitHub 仓库

1. 将此仓库推送到 GitHub
2. 在 Render 仪表板点击 "New +" → "Web Service"
3. 连接你的 GitHub 仓库

### 4. 配置环境变量

在 Render 的 Service Settings 中添加以下环境变量：

#### 必需变量
| 变量名 | 说明 |
|--------|------|
| `AGNES_API_KEY` | 你的 Agnes API 密钥 |
| `OPENCLAW_GATEWAY_TOKEN` | 控制界面登录令牌（如不设置会自动生成） |

#### 可选变量
| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `OPENCLAW_PROVIDER_ID` | agnes | 提供商 ID |
| `OPENCLAW_MODEL_ID` | agnes-2.0-flash | 模型 ID |
| `AGNES_BASE_URL` | https://apihub.agnes-ai.com/v1 | Agnes API 地址 |
| `OPENCLAW_DISABLE_DEVICE_PAIRING` | true | 禁用设备配对 |
| `TZ` | Asia/Shanghai | 时区 |
| `OPENCLAW_CONTEXT_WINDOW` | 200000 | 上下文窗口大小 |
| `OPENCLAW_MAX_TOKENS` | 8192 | 最大输出 token 数 |

#### Telegram 配置（可选）
| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `TELEGRAM_BOT_TOKEN` | - | Telegram Bot Token（从 BotFather 获取） |
| `TELEGRAM_DM_POLICY` | open | 私信策略：`open`(任何人) / `allowlist`(仅白名单) / `pairing`(配对) |
| `TELEGRAM_ALLOWED_USER_IDS` | - | 允许的用户 ID 列表（逗号分隔，用于 allowlist 模式） |
| `TELEGRAM_AUTO_ALLOW_FIRST_DM` | true | true 时自动允许第一个私信用户 |
| `OPENCLAW_TELEGRAM_ENABLED` | true | 是否启用 Telegram 通道 |

**Telegram 用户 ID 获取方法：**
1. 与您的 Bot 发送一条消息
2. 访问 `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
3. 在返回的 JSON 中找到 `message.chat.id` 即为您的用户 ID

### 5. 部署配置

使用以下配置（如果在 Render 网页界面手动创建）：

- **Environment**: Node
- **Build Command**: `npm install`
- **Start Command**: `node start-gateway.mjs`

或者直接使用 `render.yaml` 文件自动配置。

## 本地开发

```bash
# 安装依赖
npm install

# 设置环境变量
export AGNES_API_KEY=your_key_here
export TELEGRAM_BOT_TOKEN=your_bot_token_here  # 可选

# 启动服务
npm start
```

## 注意事项

### Render 免费版限制

1. **休眠**: 免费服务在 90 天未访问后会休眠，下次访问需要约 30 秒唤醒
2. **存储**: 使用 `/tmp` 目录，重启后数据会丢失
3. **带宽**: 有月度数据传输限制
4. **CPU/RAM**: 免费套餐资源有限

### 改进建议

如需更稳定的服务，考虑：
- 升级到 Render 付费套餐
- 使用外部数据库存储配置
- 配置健康检查和自动重启

## 原 Hugging Face 版本

原始 HF Spaces 版本保留了 `Dockerfile` 和 `start-openclaw.sh`，可在需要时用于 HF 部署。

## Telegram 快速配置

项目提供了 `setup-telegram.mjs` 脚本来帮助您快速配置 Telegram Bot：

```bash
# 运行配置助手
npm run setup-telegram
```

该脚本会：
1. 从 `常用key.txt` 自动读取 Telegram Bot Token
2. 设置 Bot Webhook
3. 检测您的 Telegram User ID
4. 更新 `render.yaml` 配置文件

## 项目结构

```
├── render.yaml              # Render.com 部署配置
├── package.json             # Node.js 依赖配置
├── start-gateway.mjs        # Render 启动脚本
├── setup-telegram.mjs       # Telegram 配置助手
├── README.md                # 本文档
├── Dockerfile               # 原始 HF Docker 配置
├── start-openclaw.sh        # 原始 HF 启动脚本
├── 常用key.txt              # 密钥文件
└── .gitignore               # Git 忽略配置
```

## 相关链接

- [Render 文档](https://render.com/docs)
- [Agnes AI 文档](https://agnes-ai.com/zh-Hans/docs/cid1)
- [OpenClaw GitHub](https://github.com/openclaw)