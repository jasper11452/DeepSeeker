#!/bin/bash
# DeepSeeker - Unstructured + Nougat 依赖安装脚本
# 
# 此脚本用于安装 Unstructured + Nougat 组合方案所需的依赖
# 这是学术论文解析的最佳方案，公式还原准确率可达 95%+

set -e

echo "======================================"
echo "DeepSeeker - 安装 Unstructured + Nougat"
echo "======================================"
echo ""

# 检测 Python 环境
if [ -d ".venv" ]; then
    echo "📦 检测到虚拟环境，激活中..."
    source .venv/bin/activate
else
    echo "⚠️  未检测到虚拟环境，将使用系统 Python"
fi

echo ""
echo "🔧 安装 Unstructured（PDF 解析核心）..."
pip install "unstructured[pdf]" --break-system-packages 2>/dev/null || pip install "unstructured[pdf]"

echo ""
echo "🔧 安装 Nougat（公式识别引擎）..."
# Nougat 需要 transformers 和 torch
pip install transformers torch torchvision --break-system-packages 2>/dev/null || pip install transformers torch torchvision
pip install nougat-ocr --break-system-packages 2>/dev/null || pip install nougat-ocr

echo ""
echo "🔧 安装其他依赖..."
pip install Pillow>=10.0.0 --break-system-packages 2>/dev/null || pip install Pillow>=10.0.0

echo ""
echo "======================================"
echo "✅ 安装完成！"
echo "======================================"
echo ""
echo "使用方式："
echo "  1. 在 .env 文件中设置: PDF_PARSE_STRATEGY=unstructured_nougat"
echo "  2. 或者保持默认值（已设为 unstructured_nougat）"
echo ""
echo "可用的解析策略："
echo "  - unstructured_nougat: Unstructured + Nougat（推荐，学术论文首选）"
echo "  - nougat_full: 纯 Nougat 全页解析（最高精度，较慢）"
echo "  - auto: 自动选择（根据文档特征）"
echo "  - ocr: PaddleOCR（扫描版 PDF）"
echo "  - text_extraction: PyMuPDF（文字版 PDF）"
echo ""
echo "首次使用时，Nougat 模型会自动下载（约 1GB）"
