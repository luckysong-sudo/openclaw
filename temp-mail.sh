#!/bin/bash
# OpenClaw Temp Mail CLI Tool
# 临时邮箱命令行工具

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_SCRIPT="$SCRIPT_DIR/temp-mail-tool.mjs"

# 获取存储路径
STORAGE_BASE="${OPENCLAW_STORAGE_PATH:-/tmp/openclaw}"
STORAGE_SUBDIR="${OPENCLAW_STORAGE_SUBDIR:-openclaw}"
OPENCLAW_ROOT="$STORAGE_BASE/$STORAGE_SUBDIR"

export OPENCLAW_STORAGE_PATH="$STORAGE_BASE"
export OPENCLAW_STORAGE_SUBDIR="$STORAGE_SUBDIR"

case "$1" in
  create)
    node "$TOOL_SCRIPT" create
    ;;
  check)
    node "$TOOL_SCRIPT" check
    ;;
  latest)
    node "$TOOL_SCRIPT" latest
    ;;
  status)
    node "$TOOL_SCRIPT" status
    ;;
  help|--help|-h)
    echo "用法: temp-mail.sh <command>"
    echo ""
    echo "命令:"
    echo "  create    - 创建新的临时邮箱"
    echo "  check     - 检查新邮件"
    echo "  latest    - 获取最新邮件内容"
    echo "  status    - 查看当前邮箱状态"
    echo "  help      - 显示帮助信息"
    ;;
  *)
    echo "📧 临时邮箱工具"
    echo "使用 'temp-mail.sh help' 查看可用命令"
    ;;
esac