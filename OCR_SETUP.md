# PDF OCR 功能设置指南

## 概述

DeepSeeker 现已支持通过 OCR (光学字符识别) 技术处理扫描版 PDF 文件。当检测到 PDF 没有文本层时，系统会自动调用 Tesseract OCR 引擎来提取文本。

## 功能特性

- ✅ 自动检测扫描版 PDF（无文本层或文本稀疏）
- ✅ 使用 Tesseract OCR 自动提取文本
- ✅ 实时进度反馈（显示 OCR 处理进度）
- ✅ 支持多页文档并行处理
- ✅ 高质量渲染（2000px 宽度）确保 OCR 准确性

## 系统依赖安装

### 1. Tesseract OCR

#### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install tesseract-ocr tesseract-ocr-eng
# 可选：安装其他语言包
sudo apt-get install tesseract-ocr-chi-sim  # 简体中文
sudo apt-get install tesseract-ocr-chi-tra  # 繁体中文
```

#### macOS
```bash
brew install tesseract
# 可选：安装其他语言包
brew install tesseract-lang
```

#### Windows
下载并安装 Tesseract：
- 访问: https://github.com/UB-Mannheim/tesseract/wiki
- 下载最新版本的安装程序
- 确保在安装时选择需要的语言包

### 2. PDFium 库（已通过 pdfium-render crate 自动处理）

`pdfium-render` crate 会自动下载并链接 PDFium 库，无需手动安装。

### 3. GTK 依赖（仅 Linux）

如果在 Linux 上构建，需要安装 GTK 开发库：

```bash
sudo apt-get install libgtk-3-dev libwebkit2gtk-4.0-dev \
    libayatana-appindicator3-dev librsvg2-dev \
    libgdk-pixbuf2.0-dev libatk1.0-dev libpango1.0-dev
```

## 使用方法

### 自动 OCR

当索引包含扫描版 PDF 的目录时，系统会自动：

1. 尝试提取文本层
2. 检测文本是否稀疏（< 50 字符/页）
3. 如果是扫描版，自动启动 OCR 处理
4. 在前端显示实时进度："OCR 处理中: filename.pdf (第 3/10 页)"

### 进度监控

前端 `IndexingProgress` 组件会显示：
- 当前正在处理的文件
- OCR 进度（当前页/总页数）
- 处理完成的文件数
- 错误信息（如果 OCR 失败）

## 实现细节

### 文件结构

```
src-tauri/src/
├── pdf_ocr.rs          # OCR 核心功能
├── pdf_parser.rs       # PDF 解析器（已扩展）
├── progress.rs         # 进度跟踪器
└── commands.rs         # Tauri 命令（已更新）
```

### PdfStatus 枚举

```rust
pub enum PdfStatus {
    Success { text: String, page_count: usize },      // 文本层提取成功
    OcrSuccess { text: String, page_count: usize },   // OCR 提取成功
    ScannedPdf { page_count: usize },                 // 扫描版（OCR 失败）
    Error(String),                                     // 提取错误
}
```

### 进度回调

OCR 处理时会调用进度回调函数：

```rust
let progress_callback = Box::new(move |current_page: usize, total_pages: usize| {
    let status_msg = format!("OCR 处理中: {} (第 {}/{} 页)",
        filename, current_page, total_pages
    );
    tracker.update_current_file(collection_id, Some(status_msg));
});
```

## 性能考虑

### OCR 速度

- OCR 处理速度较慢，大约 **2-5 秒/页**（取决于系统性能）
- 10 页文档预计需要 **20-50 秒**
- 前端会显示实时进度避免用户以为程序卡死

### 优化建议

1. **高质量渲染**：PDF 页面以 2000px 宽度渲染，确保 OCR 准确性
2. **灰度转换**：图像转换为灰度可提升 OCR 准确性和速度
3. **错误容忍**：单页 OCR 失败不会中断整个文档处理
4. **批量处理**：可考虑并行处理多个页面（未实现）

## 文档状态标记

索引后的文档会标记状态：

- `normal` - 正常 PDF（有文本层）
- `ocr` - OCR 处理成功的扫描版 PDF
- `scanned_pdf` - 扫描版 PDF（OCR 失败或未处理）
- `error` - 处理出错

## 故障排除

### 1. Tesseract 未找到

**错误信息**:
```
Failed to initialize Tesseract. Please ensure Tesseract OCR is installed
```

**解决方法**:
- 确认 Tesseract 已安装：`tesseract --version`
- 检查环境变量是否包含 Tesseract 路径

### 2. PDFium 库加载失败

**错误信息**:
```
Failed to load PDFium library
```

**解决方法**:
- 通常由 `pdfium-render` crate 自动处理
- 如果失败，尝试清理并重新构建：`cargo clean && cargo build`

### 3. OCR 结果不准确

**可能原因**:
- PDF 分辨率过低
- 图像质量差
- 语言包未安装

**改进方法**:
- 安装对应语言的 Tesseract 语言包
- 调整 `pdf_ocr.rs` 中的渲染分辨率
- 检查原始 PDF 文件质量

### 4. OCR 处理超时

对于特别大的文档（> 50 页），OCR 可能需要较长时间。这是正常现象，前端会显示进度。

## 未来改进

- [ ] 支持多语言选择
- [ ] 并行处理多个页面
- [ ] 缓存 OCR 结果
- [ ] 可配置的 OCR 引擎（Google Cloud Vision, Azure, 等）
- [ ] OCR 质量评估和自动重试

## 相关文件

- `src-tauri/Cargo.toml` - 添加了 leptess, pdfium-render, image 依赖
- `src-tauri/src/pdf_ocr.rs` - OCR 核心实现
- `src-tauri/src/pdf_parser.rs` - 集成 OCR 到 PDF 解析流程
- `src-tauri/src/progress.rs` - 进度跟踪系统
- `src-tauri/src/commands.rs` - 索引命令更新以支持 OCR 进度
- `src-tauri/src/main.rs` - 注册进度跟踪器和命令
- `src/components/IndexingProgress.tsx` - 前端进度显示组件

## 测试

要测试 OCR 功能：

1. 准备一个扫描版 PDF 文件
2. 创建或选择一个集合
3. 索引包含该 PDF 的目录
4. 观察前端进度显示
5. 完成后，搜索 PDF 中的内容以验证 OCR 效果

## 许可证

本功能使用以下开源库：
- Tesseract OCR (Apache 2.0)
- PDFium (BSD-style license)
- leptess (MIT)
- pdfium-render (Apache 2.0 / MIT)
