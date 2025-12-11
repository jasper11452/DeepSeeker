# DeepSeeker - AI 研究助手

<div align="center">

![DeepSeeker](https://img.shields.io/badge/DeepSeeker-AI%20Research%20Assistant-blue?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.10+-green?style=flat-square&logo=python)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square&logo=typescript)
![Electron](https://img.shields.io/badge/Electron-Desktop%20App-9feaf9?style=flat-square&logo=electron)
![MLX](https://img.shields.io/badge/MLX-Apple%20Silicon-orange?style=flat-square&logo=apple)

**一个深度分析型 AI 研究助手，帮你从文档中发现洞察**

专为研究人员、分析师和知识工作者设计

</div>

---

## 🎯 产品定位

DeepSeeker 是一款**深度分析型 AI 研究助手**，不仅仅是文档管理工具，更是你的智能研究伙伴。它能：

- 🔍 **发现隐藏关联** - AI 自动发现你可能忽略的文档间联系
- 🎯 **识别知识盲区** - 主动提醒你研究领域的空白点
- 📊 **追踪趋势变化** - 分析你关注领域的发展脉络
- 📝 **生成研究综述** - 基于多文档自动生成专业报告

## ✨ 核心特性

### 🧠 智能知识发现
- **隐含关联发现** - AI 分析文档语义，发现非显式的主题关联
- **知识图谱可视化** - 直观展示文档、概念、实体间的关系网络
- **相似文档推荐** - 基于内容语义推荐相关阅读材料

### 📊 主题聚类分析
- **自动文档分类** - 无监督聚类算法自动归类相似文档
- **主题标签生成** - AI 生成每个聚类的主题描述
- **跨文档主题追踪** - 追踪同一主题在不同文档中的论述

### 📈 趋势洞察
- **时间线分析** - 按时间维度分析主题演变
- **热点识别** - 发现你收藏内容中的热门话题
- **变化检测** - 监测关注领域的新发展和变化

### 📝 研究报告生成
- **多文档综述** - 自动整合多篇文档生成研究综述
- **关键洞察提炼** - 提取核心观点和论据
- **引用溯源** - 每个观点都可追溯到原始文档

### 💡 知识空白提醒
- **覆盖度分析** - 分析你的知识库在各子领域的覆盖程度
- **缺失识别** - 主动提示："你收集了很多 AI 内容，但缺少 X 方面的资料"
- **学习路径建议** - 推荐需要补充的知识方向

### 🔒 完全本地运行
- **隐私优先** - 所有数据和模型都在本地，无需联网
- **Apple Silicon 优化** - 使用 MLX 框架，充分利用 M 系列芯片
- **桌面应用** - Electron 封装，原生体验

## 🖥️ 系统要求

- **操作系统**: macOS（需要 Apple Silicon，即 M1/M2/M3/M4 芯片）
- **Python**: 3.10+
- **Node.js**: 18+
- **内存**: 建议 16GB 或以上
- **存储**: 首次安装需要约 6GB 用于 AI 模型

## 📦 安装

### 🚀 一键安装（推荐）

```bash
# 克隆项目
git clone https://github.com/jasper11452/DeepSeeker.git
cd DeepSeeker

# 运行一键安装脚本
./setup.sh

# 如果网络受限，使用国内镜像源
./setup.sh --mirror
```

一键安装脚本会自动完成：
- ✅ 系统环境检测（macOS Apple Silicon、Python、Node.js）
- ✅ 安装 uv 包管理器
- ✅ 创建 Python 虚拟环境
- ✅ 安装后端 Python 依赖
- ✅ 安装前端 Node.js 依赖
- ✅ 下载所有 AI 模型（约 5-6GB）
- ✅ 初始化数据库

### 🖥️ 桌面应用安装

```bash
# 安装 Electron 依赖
cd electron
npm install

# 构建桌面应用
npm run build

# 启动桌面应用
npm start
```

## 🚀 运行

### 桌面应用（推荐）
```bash
# 启动桌面应用
npm run electron
```

### 网页版
```bash
# 启动服务
./start.sh

# 停止服务
./stop.sh
```

启动后会自动打开浏览器访问 http://localhost:5173

## 📁 项目结构

```
DeepSeeker/
├── backend/                 # 后端 FastAPI 应用
│   ├── app/
│   │   ├── models/         # 数据库模型
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 业务逻辑
│   │   │   ├── llm.py      # LLM 服务
│   │   │   ├── rag.py      # RAG 检索服务
│   │   │   ├── insights.py # 🆕 洞察发现服务
│   │   │   ├── clustering.py # 🆕 主题聚类服务
│   │   │   ├── trends.py   # 🆕 趋势分析服务
│   │   │   ├── reports.py  # 🆕 报告生成服务
│   │   │   ├── gaps.py     # 🆕 知识空白分析
│   │   │   └── ...
│   │   └── schemas/        # Pydantic 模型
│   ├── main.py             # 应用入口
│   └── requirements.txt    # Python 依赖
│
├── frontend/               # 前端 React 应用
│   ├── src/
│   │   ├── components/     # UI 组件
│   │   ├── views/          # 页面视图
│   │   │   ├── InsightsView.tsx    # 🆕 洞察面板
│   │   │   ├── ClustersView.tsx    # 🆕 主题聚类
│   │   │   ├── TrendsView.tsx      # 🆕 趋势分析
│   │   │   └── ReportsView.tsx     # 🆕 报告生成
│   │   ├── stores/         # Zustand 状态管理
│   │   └── lib/            # 工具函数
│   └── package.json        # Node 依赖
│
├── electron/               # 🆕 Electron 桌面应用
│   ├── main.js             # 主进程
│   ├── preload.js          # 预加载脚本
│   └── package.json        # Electron 依赖
│
└── README.md
```

## 🤖 使用的模型

| 功能 | 模型 | 大小 |
|------|------|------|
| LLM 对话 | Qwen3-4B-Instruct-2507-4bit | ~2.5GB |
| 文档嵌入 | Qwen3-Embedding-0.6B-4bit-DWQ | ~400MB |
| 搜索重排序 | Qwen3-Reranker-0.6B-4bit | ~400MB |
| 图像/文档 OCR | DeepSeek-OCR-4bit | ~2GB |

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

# 聚类配置
MIN_CLUSTER_SIZE=3      # 最小聚类大小
CLUSTERING_THRESHOLD=0.7 # 聚类阈值

# 洞察配置
INSIGHT_UPDATE_INTERVAL=3600  # 洞察更新间隔（秒）
```

## 📝 使用场景

### 学术研究
- 收集论文并自动聚类
- 发现跨学科的隐藏关联
- 生成文献综述初稿

### 市场调研
- 整理行业报告
- 追踪市场趋势变化
- 识别未覆盖的细分领域

### 个人知识管理
- 组织学习笔记
- 发现知识盲区
- 建立知识网络

### 内容创作
- 整合多来源素材
- 提炼核心观点
- 生成内容大纲

## 🛠️ 技术栈

### 后端
- **FastAPI** - 高性能异步 Web 框架
- **SQLAlchemy** - 异步 ORM
- **ChromaDB** - 向量数据库
- **MLX** - Apple Silicon 机器学习框架
- **scikit-learn** - 聚类算法
- **NetworkX** - 图分析

### 前端
- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **TailwindCSS** - 样式框架
- **Zustand** - 状态管理
- **D3.js** - 数据可视化
- **react-force-graph** - 知识图谱可视化

### 桌面应用
- **Electron** - 跨平台桌面应用框架

## 🗺️ 路线图

- [x] 基础 RAG 问答
- [x] 文档管理与搜索
- [x] 知识图谱可视化
- [ ] 🚧 Electron 桌面应用
- [ ] 🚧 智能知识发现
- [ ] 🚧 主题聚类分析
- [ ] 🚧 趋势洞察
- [ ] 🚧 研究报告生成
- [ ] 🚧 知识空白提醒
- [ ] 多语言支持
- [ ] 插件系统
- [ ] 云同步（可选）

## 📄 许可证

MIT License

## 🙏 致谢

- [MLX](https://github.com/ml-explore/mlx) - Apple 的机器学习框架
- [Qwen](https://github.com/QwenLM/Qwen) - 通义千问模型
- [ChromaDB](https://github.com/chroma-core/chroma) - 向量数据库
- [Electron](https://www.electronjs.org/) - 桌面应用框架
