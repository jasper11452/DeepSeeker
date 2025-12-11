#!/bin/bash
# ============================================
# DeepSeeker - 一键安装脚本
# 自动创建环境、安装依赖、下载模型
# ============================================

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"

# 默认不使用国内镜像
USE_CHINA_MIRROR=false

# ============================================
# 工具函数
# ============================================

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
    echo "║           本地 RAG 知识管理系统 - 一键安装脚本                  ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "${BLUE}[步骤 $1]${NC} ${GREEN}$2${NC}"
}

print_info() {
    echo -e "${CYAN}[信息]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[警告]${NC} $1"
}

print_error() {
    echo -e "${RED}[错误]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[成功]${NC} $1"
}

# ============================================
# 参数解析
# ============================================

show_help() {
    echo "使用方法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  -m, --mirror    使用国内镜像源（pip、npm、HuggingFace）"
    echo "  -h, --help      显示帮助信息"
    echo ""
    echo "示例:"
    echo "  $0              使用默认源安装"
    echo "  $0 --mirror     使用国内镜像源安装（推荐网络受限用户）"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mirror)
            USE_CHINA_MIRROR=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_error "未知选项: $1"
            show_help
            exit 1
            ;;
    esac
done

# ============================================
# 环境检测
# ============================================

check_system() {
    print_step "1/7" "系统环境检测..."
    
    # 检测操作系统
    OS_TYPE=$(uname -s)
    if [[ "$OS_TYPE" != "Darwin" ]]; then
        print_error "本项目仅支持 macOS (Apple Silicon)，检测到: $OS_TYPE"
        exit 1
    fi
    
    # 检测 CPU 架构
    ARCH=$(uname -m)
    if [[ "$ARCH" != "arm64" ]]; then
        print_error "本项目需要 Apple Silicon (M1/M2/M3/M4)，检测到: $ARCH"
        exit 1
    fi
    
    print_success "操作系统: macOS (Apple Silicon)"
    
    # 检测 Python
    if command -v python3 &> /dev/null; then
        PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
        PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
        PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)
        
        if [[ "$PYTHON_MAJOR" -lt 3 ]] || [[ "$PYTHON_MAJOR" -eq 3 && "$PYTHON_MINOR" -lt 10 ]]; then
            print_error "需要 Python 3.10+，当前版本: $PYTHON_VERSION"
            exit 1
        fi
        print_success "Python 版本: $PYTHON_VERSION"
    else
        print_error "未找到 Python，请先安装 Python 3.10+"
        exit 1
    fi
    
    # 检测 Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version | sed 's/v//')
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
        
        if [[ "$NODE_MAJOR" -lt 18 ]]; then
            print_error "需要 Node.js 18+，当前版本: $NODE_VERSION"
            exit 1
        fi
        print_success "Node.js 版本: $NODE_VERSION"
    else
        print_error "未找到 Node.js，请先安装 Node.js 18+"
        exit 1
    fi
    
    # 检测 uv
    if ! command -v uv &> /dev/null; then
        print_warning "未找到 uv，将自动安装..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
        # 添加到当前 session 的 PATH
        export PATH="$HOME/.cargo/bin:$PATH"
        if ! command -v uv &> /dev/null; then
            print_error "uv 安装失败，请手动安装: https://github.com/astral-sh/uv"
            exit 1
        fi
    fi
    UV_VERSION=$(uv --version 2>&1 | head -n1)
    print_success "uv 版本: $UV_VERSION"
    
    echo ""
}

# ============================================
# 镜像源配置
# ============================================

configure_mirrors() {
    if [[ "$USE_CHINA_MIRROR" == true ]]; then
        print_step "2/7" "配置国内镜像源..."
        
        # 设置 pip 镜像
        export UV_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
        export UV_EXTRA_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
        print_info "pip 镜像: 清华大学 (pypi.tuna.tsinghua.edu.cn)"
        
        # 设置 HuggingFace 镜像
        export HF_ENDPOINT="https://hf-mirror.com"
        print_info "HuggingFace 镜像: hf-mirror.com"
        
        # 设置 npm 镜像将在 npm install 时使用
        NPM_MIRROR="https://registry.npmmirror.com"
        print_info "npm 镜像: npmmirror.com"
        
        print_success "国内镜像源配置完成"
    else
        print_step "2/7" "使用默认源..."
        NPM_MIRROR=""
        print_info "使用官方源（如需国内镜像，请使用 --mirror 参数）"
    fi
    echo ""
}

# ============================================
# 后端环境设置
# ============================================

setup_backend() {
    print_step "3/7" "设置后端环境..."
    
    cd "$BACKEND_DIR"
    
    # 创建虚拟环境
    if [[ ! -d ".venv" ]]; then
        print_info "创建 Python 虚拟环境..."
        uv venv
    else
        print_info "虚拟环境已存在，跳过创建"
    fi
    
    # 激活虚拟环境
    source .venv/bin/activate
    
    # 安装依赖
    print_info "安装 Python 依赖（这可能需要几分钟）..."
    if [[ "$USE_CHINA_MIRROR" == true ]]; then
        uv pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    else
        uv pip install -r requirements.txt
    fi
    
    # 创建 .env 文件（如果不存在）
    if [[ ! -f ".env" ]]; then
        print_info "创建配置文件..."
        cp .env.example .env
        print_success "已创建 .env 配置文件，可根据需要进行修改"
    else
        print_info ".env 配置文件已存在"
    fi
    
    # 创建必要目录
    mkdir -p uploads
    mkdir -p ml_models
    mkdir -p chroma_db
    
    print_success "后端环境设置完成"
    echo ""
}

# ============================================
# 前端环境设置
# ============================================

setup_frontend() {
    print_step "4/7" "设置前端环境..."
    
    cd "$FRONTEND_DIR"
    
    # 安装依赖
    print_info "安装前端依赖..."
    if [[ "$USE_CHINA_MIRROR" == true ]]; then
        npm install --registry=https://registry.npmmirror.com
    else
        npm install
    fi
    
    print_success "前端环境设置完成"
    echo ""
}

# ============================================
# 模型下载
# ============================================

download_models() {
    print_step "5/7" "下载 AI 模型..."
    
    cd "$BACKEND_DIR"
    source .venv/bin/activate
    
    # 模型列表
    MODELS=(
        "mlx-community/Qwen3-4B-Instruct-2507-4bit"
        "mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ"
        "lmstudio-community/Qwen3-VL-4B-Instruct-MLX-4bit"
        "mlx-community/Qwen3-Reranker-0.6B-4bit"
    )
    
    MODEL_NAMES=(
        "LLM 对话模型 (Qwen3-4B)"
        "文档嵌入模型 (Qwen3-Embedding)"
        "视觉 OCR 模型 (Qwen3-VL)"
        "搜索重排序模型 (Qwen3-Reranker)"
    )
    
    MODEL_DIR="${BACKEND_DIR}/ml_models"
    
    echo ""
    print_info "将下载以下模型（首次下载约 5-6GB）："
    for i in "${!MODELS[@]}"; do
        echo "  - ${MODEL_NAMES[$i]}: ${MODELS[$i]}"
    done
    echo ""
    
    # 使用 Python 下载模型
    for i in "${!MODELS[@]}"; do
        MODEL_ID="${MODELS[$i]}"
        MODEL_NAME="${MODEL_NAMES[$i]}"
        LOCAL_DIR="${MODEL_DIR}/${MODEL_ID//\//_}"
        
        if [[ -d "$LOCAL_DIR" ]] && [[ "$(ls -A "$LOCAL_DIR" 2>/dev/null)" ]]; then
            print_info "✓ ${MODEL_NAME} 已缓存"
        else
            print_info "正在下载: ${MODEL_NAME}..."
            python3 -c "
from huggingface_hub import snapshot_download
import os

model_id = '${MODEL_ID}'
local_dir = '${LOCAL_DIR}'
os.makedirs(local_dir, exist_ok=True)

try:
    snapshot_download(
        repo_id=model_id,
        local_dir=local_dir,
        local_dir_use_symlinks=False,
    )
    print(f'✓ 下载完成: {model_id}')
except Exception as e:
    print(f'✗ 下载失败: {e}')
    exit(1)
"
            if [[ $? -eq 0 ]]; then
                print_success "✓ ${MODEL_NAME} 下载完成"
            else
                print_error "✗ ${MODEL_NAME} 下载失败"
            fi
        fi
    done
    
    echo ""
    print_success "模型下载完成"
    echo ""
}

# ============================================
# 数据库初始化
# ============================================

init_database() {
    print_step "6/7" "初始化数据库..."
    
    cd "$BACKEND_DIR"
    source .venv/bin/activate
    
    # 通过启动一次应用来初始化数据库
    print_info "初始化 SQLite 数据库..."
    python3 -c "
import asyncio
from app.database import engine, Base

async def init():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print('数据库初始化完成')

asyncio.run(init())
" 2>/dev/null || print_info "数据库已存在"
    
    print_success "数据库初始化完成"
    echo ""
}

# ============================================
# 完成提示
# ============================================

show_completion() {
    print_step "7/7" "安装完成！"
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                     安装成功完成！                              ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}启动方式：${NC}"
    echo ""
    echo -e "${YELLOW}方式一：使用启动脚本（推荐）${NC}"
    echo "  ./start.sh"
    echo ""
    echo -e "${YELLOW}方式二：手动启动${NC}"
    echo "  # 终端 1 - 启动后端"
    echo "  cd backend"
    echo "  source .venv/bin/activate"
    echo "  uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000"
    echo ""
    echo "  # 终端 2 - 启动前端"
    echo "  cd frontend"
    echo "  npm run dev"
    echo ""
    echo -e "${CYAN}访问地址：${NC}"
    echo "  Web 界面: http://localhost:5173"
    echo "  后端 API: http://localhost:8000"
    echo "  API 文档: http://localhost:8000/docs"
    echo ""
    echo -e "${YELLOW}桌面应用：${NC}"
    echo "  ./start.sh --electron"
    echo ""
    echo -e "${CYAN}研究助手功能：${NC}"
    echo "  🧠 智能知识发现 - 发现文档间的隐含关联"
    echo "  📊 主题聚类分析 - 自动归类相似文档"
    echo "  📈 趋势洞察     - 分析关注领域的变化"
    echo "  📝 研究报告生成 - 基于多文档自动综述"
    echo "  ⚠️  知识空白提醒 - 识别知识库的盲区"
    echo ""
    
    if [[ "$USE_CHINA_MIRROR" == true ]]; then
        echo -e "${PURPLE}[提示] 已使用国内镜像源配置${NC}"
        echo ""
    fi
}

# ============================================
# 主流程
# ============================================

main() {
    print_banner
    
    if [[ "$USE_CHINA_MIRROR" == true ]]; then
        echo -e "${PURPLE}[模式] 使用国内镜像源${NC}"
    else
        echo -e "${PURPLE}[模式] 使用默认源${NC}"
    fi
    echo ""
    
    check_system
    configure_mirrors
    setup_backend
    setup_frontend
    download_models
    init_database
    show_completion
}

# 运行主流程
main
