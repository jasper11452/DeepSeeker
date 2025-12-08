# Atlas - 本地 RAG 知识管理系统

<div align="center">

![Atlas](https://img.shields.io/badge/Atlas-RAG%20Knowledge%20Manager-blue?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.10+-green?style=flat-square&logo=python)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square&logo=typescript)
![MLX](https://img.shields.io/badge/MLX-Apple%20Silicon-orange?style=flat-square&logo=apple)

**一个完全本地运行的 RAG（检索增强生成）知识管理系统，专为 Apple Silicon 优化**

</div>

---

## ✨ 特性

- 🔒 **完全本地** - 所有数据和模型都在本地运行，无需外部 API，保护隐私
- 🍎 **Apple Silicon 优化** - 使用 MLX 框架，充分利用 M 系列芯片性能
- 📄 **多格式支持** - 支持 PDF、Markdown、Word、PPT、Excel、图片等多种文档格式
- 🔍 **智能检索** - 混合搜索（向量 + BM25）+ 重排序，精准找到相关内容
- 💬 **AI 对话** - 基于文档内容的智能问答，支持流式输出
- 🏷️ **标签管理** - 文件夹和标签系统，灵活组织文档
- 🌙 **深色模式** - 支持浅色/深色/跟随系统主题

## 🖥️ 系统要求

- **操作系统**: macOS（需要 Apple Silicon，即 M1/M2/M3/M4 芯片）
- **Python**: 3.10+
- **Node.js**: 18+
- **内存**: 建议 16GB 或以上

## 📦 安装

### 1. 克隆项目

```bash
git clone https://github.com/jasper11452/DeepSeeker.git
cd DeepSeeker
```

### 2. 后端设置

```bash
cd backend

# 创建虚拟环境（使用 uv）
uv venv
source .venv/bin/activate

# 安装依赖
uv pip install -r requirements.txt

# 复制并配置环境变量
cp .env.example .env
# 根据需要编辑 .env 文件
```

### 3. 前端设置

```bash
cd frontend

# 安装依赖
npm install
```

## 🚀 运行

### 启动后端

```bash
cd backend
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 启动前端

```bash
cd frontend
npm run dev
```

访问 http://localhost:5173 即可使用。

## 📁 项目结构

```
Atlas/
├── backend/                 # 后端 FastAPI 应用
│   ├── app/
│   │   ├── models/         # 数据库模型
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 业务逻辑
│   │   │   ├── llm.py      # LLM 服务（嵌入、生成）
│   │   │   ├── rag.py      # RAG 检索服务
│   │   │   ├── parser.py   # 文档解析
│   │   │   └── ...
│   │   └── schemas/        # Pydantic 模型
│   ├── main.py             # 应用入口
│   └── requirements.txt    # Python 依赖
│
├── frontend/               # 前端 React 应用
│   ├── src/
│   │   ├── components/     # UI 组件
│   │   ├── views/          # 页面视图
│   │   ├── stores/         # Zustand 状态管理
│   │   └── lib/            # 工具函数
│   └── package.json        # Node 依赖
│
└── README.md
```

## 🤖 使用的模型

本项目使用以下本地 MLX 模型，首次运行时会自动下载：

| 功能 | 模型 | 大小 |
|------|------|------|
| LLM 对话 | Qwen3-4B-Instruct-2507-4bit | ~2.5GB |
| 文档嵌入 | Qwen3-Embedding-0.6B-4bit-DWQ | ~400MB |
| 搜索重排序 | Qwen3-Reranker-0.6B-4bit | ~400MB |
| 图像解析 | HunyuanOCR / Qwen3-VL-4B | ~2GB |

## 🔧 配置说明

主要配置项在 `backend/.env` 文件中：

```env
# 服务器配置
HOST=0.0.0.0
PORT=8000

# 文档处理
CHUNK_SIZE=800          # 分块大小
CHUNK_OVERLAP=150       # 分块重叠

# 搜索配置
TOP_K_RETRIEVAL=20      # 初始检索数量
TOP_K_RERANK=5          # 重排序后返回数量
BM25_WEIGHT=0.3         # BM25 权重
VECTOR_WEIGHT=0.7       # 向量搜索权重
```

## 📝 功能说明

### 文档管理
- 上传 PDF、Markdown、Word 等文档
- 自动解析和向量化
- 支持文件夹和标签组织

### AI 对话
- 基于文档内容的智能问答
- 实时流式输出
- 自动引用来源

### 搜索
- 混合搜索（向量语义 + BM25 关键词）
- 智能重排序
- 高亮显示关键词

## 🛠️ 技术栈

### 后端
- **FastAPI** - 高性能异步 Web 框架
- **SQLAlchemy** - 异步 ORM
- **ChromaDB** - 向量数据库
- **MLX** - Apple Silicon 机器学习框架
- **MarkItDown** - 文档解析

### 前端
- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **TailwindCSS** - 样式框架
- **Zustand** - 状态管理

## 📄 许可证

MIT License

## 🙏 致谢

- [MLX](https://github.com/ml-explore/mlx) - Apple 的机器学习框架
- [Qwen](https://github.com/QwenLM/Qwen) - 通义千问模型
- [ChromaDB](https://github.com/chroma-core/chroma) - 向量数据库
- [MarkItDown](https://github.com/microsoft/markitdown) - 文档解析
