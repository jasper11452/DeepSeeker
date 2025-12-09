#!/bin/bash
# ============================================
# Atlas - 停止服务脚本
# ============================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# PID 文件
BACKEND_PID_FILE="${PROJECT_ROOT}/.backend.pid"
FRONTEND_PID_FILE="${PROJECT_ROOT}/.frontend.pid"

print_info() {
    echo -e "${CYAN}[信息]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[成功]${NC} $1"
}

echo ""
echo -e "${CYAN}正在停止 Atlas 服务...${NC}"
echo ""

# 停止后端
if [[ -f "$BACKEND_PID_FILE" ]]; then
    BACKEND_PID=$(cat "$BACKEND_PID_FILE")
    if ps -p "$BACKEND_PID" > /dev/null 2>&1; then
        kill "$BACKEND_PID" 2>/dev/null
        print_info "后端服务已停止 (PID: $BACKEND_PID)"
    fi
    rm -f "$BACKEND_PID_FILE"
else
    print_info "未找到后端进程"
fi

# 停止前端
if [[ -f "$FRONTEND_PID_FILE" ]]; then
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
    if ps -p "$FRONTEND_PID" > /dev/null 2>&1; then
        kill "$FRONTEND_PID" 2>/dev/null
        print_info "前端服务已停止 (PID: $FRONTEND_PID)"
    fi
    rm -f "$FRONTEND_PID_FILE"
else
    print_info "未找到前端进程"
fi

# 确保端口释放
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

echo ""
print_success "所有服务已停止"
echo ""
