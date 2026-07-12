#!/bin/bash
# OpenClaw 工具链配置脚本
# 配置 SSH、Git 和常用工具

echo "=== OpenClaw 工具链配置 ==="

# 检查工具是否存在
check_command() {
    if command -v $1 &> /dev/null; then
        echo "✅ $1 已安装: $(which $1)"
    else
        echo "❌ $1 未安装"
    fi
}

# 检查 Node.js 和 npm
echo ""
echo "--- Node.js 工具链 ---"
check_command node
check_command npm
check_command npx

# 检查 Git
echo ""
echo "--- Git ---"
check_command git

# 检查 SSH
echo ""
echo "--- SSH ---"
check_command ssh
check_command scp
check_command ssh-keygen

# 检查其他工具
echo ""
echo "--- 网络工具 ---"
check_command curl
check_command wget
check_command ping

# 检查 SSH 配置
echo ""
echo "--- SSH 配置 ---"
SSH_DIR="$HOME/.ssh"
if [ -d "$SSH_DIR" ]; then
    echo "✅ SSH 目录存在: $SSH_DIR"
    if [ -f "$SSH_DIR/id_rsa" ] || [ -f "$SSH_DIR/id_ed25519" ]; then
        echo "✅ SSH 密钥已配置"
    else
        echo "⚠️  SSH 密钥未配置"
        echo "   使用 'ssh-keygen -t ed25519' 生成新密钥"
    fi
else
    echo "⚠️  SSH 目录不存在: $SSH_DIR"
    mkdir -p "$SSH_DIR"
    chmod 700 "$SSH_DIR"
    echo "✅ 已创建 SSH 目录"
fi

# 检查 Git 配置
echo ""
echo "--- Git 配置 ---"
GIT_USER=$(git config user.name 2>/dev/null)
GIT_EMAIL=$(git config user.email 2>/dev/null)
if [ -n "$GIT_USER" ]; then
    echo "✅ Git 用户: $GIT_USER ($GIT_EMAIL)"
else
    echo "⚠️  Git 用户未配置"
    echo "   使用 'git config --global user.name \"你的名字\"' 配置"
fi

# 检查 npm 全局包
echo ""
echo "--- npm 全局包 ---"
GLOBAL_PACKAGES=$(npm list -g --depth=0 2>/dev/null | grep -v "npm@" | grep -v "^$" | wc -l)
echo "已安装 $GLOBAL_PACKAGES 个全局 npm 包"

echo ""
echo "=== 配置完成 ==="