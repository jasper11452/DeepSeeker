#!/bin/bash
# ============================================
# DeepSeeker - 一键启动脚本
# 同时启动后端和前端服务
# ============================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"

# PID 文件
BACKEND_PID_FILE="${PROJECT_ROOT}/.backend.pid"
FRONTEND_PID_FILE="${PROJECT_ROOT}/.frontend.pid"

print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║        █████╗ ████████╗██╗      █████╗ ███████╗               ║"
    echo "║       ██╔══██╗╚══██╔══╝██║     ██╔══██╗██╔════╝               ║"
    echo "║       ███████║   ██║   ██║     ███████║███████╗               ║"
    echo "║       ██╔══██║   ██║   ██║     ██╔══██║╚════██║               ║"
    echo "║       ██║  ██║   ██║   ███████╗██║  ██║███████║               ║"
    echo "║       ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝               ║"
    echo "║                                                               ║"
    echo "║           AI 研究助手 - 启动脚本                                 ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_info() {
    echo -e "${CYAN}[信息]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[成功]${NC} $1"
}

print_error() {
    echo -e "${RED}[错误]${NC} $1"
}

# 检查环境是否已安装
check_installation() {
    if [[ ! -d "${BACKEND_DIR}/.venv" ]]; then
        print_error "后端环境未安装，请先运行: ./setup.sh"
        exit 1
    fi
    
    if [[ ! -d "${FRONTEND_DIR}/node_modules" ]]; then
        print_error "前端依赖未安装，请先运行: ./setup.sh"
        exit 1
    fi
}

# 清理旧进程
cleanup() {
    print_info "清理旧进程..."
    
    # 杀掉旧的后端进程
    if [[ -f "$BACKEND_PID_FILE" ]]; then
        OLD_PID=$(cat "$BACKEND_PID_FILE")
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            kill "$OLD_PID" 2>/dev/null || true
        fi
        rm -f "$BACKEND_PID_FILE"
    fi
    
    # 杀掉旧的前端进程
    if [[ -f "$FRONTEND_PID_FILE" ]]; then
        OLD_PID=$(cat "$FRONTEND_PID_FILE")
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            kill "$OLD_PID" 2>/dev/null || true
        fi
        rm -f "$FRONTEND_PID_FILE"
    fi
    
    # 确保端口没有被占用
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    lsof -ti:5173 | xargs kill -9 2>/dev/null || true
    
    sleep 1
}

# 启动后端
start_backend() {
    print_info "启动后端服务..."
    
    cd "$BACKEND_DIR"
    source .venv/bin/activate
    
    # 后台启动后端
    export UV_ENV_FILE="${BACKEND_DIR}/.env"
    nohup uv run uvicorn main:app --host 0.0.0.0 --port 8000 > "${PROJECT_ROOT}/backend.log" 2>&1 &
    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$BACKEND_PID_FILE"
    
    # 等待后端启动
    print_info "等待后端服务启动..."
    for i in {1..30}; do
        if curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
            print_success "后端服务已启动 (PID: $BACKEND_PID)"
            return 0
        fi
        sleep 1
    done
    
    print_error "后端服务启动超时，请检查 backend.log"
    return 1
}

# 启动前端
start_frontend() {
    print_info "启动前端服务..."
    
    cd "$FRONTEND_DIR"
    
    # 后台启动前端
    nohup npm run dev > "${PROJECT_ROOT}/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    echo "$FRONTEND_PID" > "$FRONTEND_PID_FILE"
    
    # 等待前端启动
    print_info "等待前端服务启动..."
    for i in {1..30}; do
        if curl -s http://localhost:3000 > /dev/null 2>&1; then
            print_success "前端服务已启动 (PID: $FRONTEND_PID)"
            return 0
        fi
        sleep 1
    done
    
    print_error "前端服务启动超时，请检查 frontend.log"
    return 1
}

# 显示状态
show_status() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                   DeepSeeker 服务已启动！                        ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}访问地址：${NC}"
    echo "  🌐 Web 界面: http://localhost:3000"
    echo "  🔌 后端 API: http://localhost:8000"
    echo "  📚 API 文档: http://localhost:8000/docs"
    echo ""
    echo -e "${CYAN}研究助手功能：${NC}"
    echo "  🧠 洞察概览: http://localhost:3000/research"
    echo "  📊 主题聚类: http://localhost:3000/clusters"
    echo "  📈 趋势分析: http://localhost:3000/trends"
    echo "  📝 研究报告: http://localhost:3000/reports"
    echo ""
    echo -e "${CYAN}日志文件：${NC}"
    echo "  📄 后端日志: ${PROJECT_ROOT}/backend.log"
    echo "  📄 前端日志: ${PROJECT_ROOT}/frontend.log"
    echo ""
    echo -e "${YELLOW}停止服务：${NC} ./stop.sh"
    echo -e "${YELLOW}桌面应用：${NC} ./start.sh --electron"
    echo ""
}

# 信号处理
trap 'cleanup; exit 0' SIGINT SIGTERM EXIT

# 启动 Electron 桌面应用
start_electron() {
    start_frontend

    print_info "启动 Electron 桌面应用..."
    
    ELECTRON_DIR="${PROJECT_ROOT}/electron"
    
    if [[ ! -d "${ELECTRON_DIR}/node_modules" ]]; then
        print_info "安装 Electron 依赖..."
        cd "$ELECTRON_DIR"
        npm install
    fi
    
    cd "$ELECTRON_DIR"
    npm run dev
}

# 主流程
main() {
    print_banner
    check_installation
    cleanup
    
    # 检查是否启动 Electron
    if [[ "$1" == "--electron" ]] || [[ "$1" == "-e" ]]; then
        print_info "启动桌面应用模式..."
        start_electron
    else
        start_backend
        start_frontend
        show_status
        
        # 打开浏览器（macOS）
        if command -v open &> /dev/null; then
            sleep 2
            open http://localhost:3000
        fi
    fi
}

main "$1"
