#!/bin/bash
# Render.com Swap 设置脚本
# 为 Render Free 计划添加 1GB swap 空间

echo "=== 设置 Swap 空间 ==="

SWAP_FILE="/swapfile"
SWAP_SIZE_MB=1024

# 检查是否已经存在 swap
if swapon --show > /dev/null 2>&1; then
    echo "Swap 已经存在，跳过设置"
    exit 0
fi

# 检查是否有足够的磁盘空间
AVAILABLE_SPACE=$(df /tmp | tail -1 | awk '{print $4}')
if [ "$AVAILABLE_SPACE" -lt "$((SWAP_SIZE_MB + 100))" ]; then
    echo "警告: /tmp 空间不足，无法创建 swap"
    exit 0
fi

# 创建 swap 文件
echo "创建 ${SWAP_SIZE_MB}MB swap 文件..."
dd if=/dev/zero of=$SWAP_FILE bs=1M count=$SWAP_SIZE_MB status=progress

# 设置权限
chmod 600 $SWAP_FILE

# 设置 swap
echo "激活 swap..."
mkswap $SWAP_FILE
swapon $SWAP_FILE

# 验证
echo "=== Swap 设置完成 ==="
free -h
swapon --show