# Phase 1: 核心引擎与验证 - 完成总结

## 📋 目标

**不做 UI，只写 Rust 单元测试。必须证明"能搜准"。**

---

## ✅ Day 1: 数据库与 FTS5/Vec 基础设施

### 完成内容

1. **sqlite-vec 集成**
   - ✅ 添加 `sqlite-vec = "0.1"` 依赖
   - ✅ 使用 `sqlite3_auto_extension` 正确加载扩展
   - ✅ 验证 `vec_version()` 确保扩展已加载
   - ✅ 创建 `chunks_vec` 虚拟表 (float[1024])

2. **Schema 设计**
   - ✅ `collections` 表：id, name, folder_path, file_count, last_sync
   - ✅ `documents` 表：id, collection_id, path, hash, last_modified
   - ✅ `chunks` 表：id, doc_id, content, **embedding BLOB**, metadata, start_line, end_line
   - ✅ `chunks_fts` 虚拟表：FTS5 全文搜索索引
   - ✅ `chunks_vec` 虚拟表：向量相似度搜索

3. **幽灵数据清理**
   - ✅ 启动时自动清理：`main.rs:42-52`
   - ✅ 手动清理命令：`cleanup_ghost_data()`
   - ✅ 级联删除：documents → chunks → fts

4. **单元测试** (6个)
   - `test_init_database` - 数据库初始化
   - `test_fts5_enabled` - FTS5 虚拟表验证
   - `test_ghost_data_cleanup` - 幽灵数据清理
   - `test_cascade_delete` - 级联删除
   - `test_fts5_triggers` - FTS5 触发器
   - `test_sqlite_vec_loaded` - sqlite-vec 加载验证

### 关键文件

- `src-tauri/Cargo.toml:25` - sqlite-vec 依赖
- `src-tauri/src/db.rs:10-34` - 扩展加载
- `src-tauri/src/db.rs:126-131` - chunks_vec 虚拟表
- `src-tauri/src/main.rs:42-52` - 启动时清理

---

## ✅ Day 2: 结构化切片算法 (The Secret Sauce)

### 完成内容

1. **Context Stack (header_stack)**
   - ✅ 维护 H1 > H2 > H3 > H4 层级结构
   - ✅ 标题切换时自动重置上下文
   - ✅ 代码块继承完整标题层级

2. **代码块处理**
   - ✅ **强制不切分** - `chunker.rs:108-126`
   - ✅ 语言识别：Fenced (`python`) 和 Indented
   - ✅ 上下文保留：代码块记录所在标题路径

3. **测试用例** (10个复杂场景)
   - `test_complex_nested_headers_with_code` - 深层嵌套 + 代码块
   - `test_multiple_code_blocks_same_header` - 同标题多代码块
   - `test_deep_nesting` - H1>H2>H3>H4 层级
   - `test_code_block_special_chars` - 特殊字符处理
   - `test_mixed_content_types` - 混合内容
   - `test_empty_code_blocks` - 空代码块
   - `test_long_text_chunking` - 超长文本切分
   - `test_indented_code_blocks` - 缩进代码块
   - `test_realistic_readme` - 真实 README 测试
   - `test_header_context_reset` - 上下文重置验证

4. **测试 Fixture**
   - `src-tauri/tests/fixtures/sample_readme.md` - 200+ 行真实 README

### 关键特性

```rust
// 代码块永不分割（chunker.rs:108）
Event::End(TagEnd::CodeBlock) => {
    let chunk = ChunkInfo {
        content: code_block_content.trim().to_string(),
        headers: self.header_stack.clone(), // 完整上下文
        chunk_type: "code".to_string(),
        language: code_block_lang.clone(),
        ...
    };
    self.chunks.push(chunk); // 一次性存储
}
```

### 关键文件

- `src-tauri/src/chunker.rs:14-24` - MarkdownChunker 结构
- `src-tauri/src/chunker.rs:64-84` - Header 处理逻辑
- `src-tauri/src/chunker.rs:86-126` - 代码块处理
- `src-tauri/src/chunker.rs:315-701` - 10个单元测试

---

## ✅ Day 3: 混合检索 (Hybrid Search) 实现

### 完成内容

1. **Embedding 模型 (embeddings.rs)**
   - ✅ ONNX Runtime 集成
   - ✅ BAAI/bge-m3 模型加载
   - ✅ Tokenizer (HuggingFace tokenizers)
   - ✅ `embed(text)` - 单文本嵌入
   - ✅ `embed_batch(texts)` - 批量嵌入
   - ✅ 向量归一化 & 余弦相似度

2. **混合检索算法 (search.rs)**

```rust
// 混合评分公式
hybrid_score = 0.7 × vec_similarity + 0.3 × bm25_normalized
```

**流程：**
1. BM25 搜索获取候选集 (limit × 3)
2. 生成查询向量
3. 获取候选集的向量
4. 计算混合得分
5. 重新排序，返回 top-k

**Fallback 机制：**
- 嵌入模型不可用时 → 纯 BM25 搜索
- 文档无嵌入时 → vec_score = 0.0

3. **权重调优**
   - BM25: 0.3 (关键词精确匹配)
   - Vector: 0.7 (语义相似度)
   - **原因：** 向量搜索能捕获"同义词"、"语义相关性"

4. **单元测试** (6个)
   - `test_search_empty_db` - 空数据库搜索
   - `test_bm25_score_normalization` - BM25 归一化
   - `test_f32_serialization` - 向量序列化
   - `test_hybrid_weights` - 权重验证
   - `test_bytes_to_f32_conversion` - 类型转换
   - `test_hybrid_search_fallback` - Fallback 机制

### 关键算法

#### BM25 归一化
```rust
// FTS5 rank 是负数，越小越好
bm25_normalized = 1.0 / (1.0 + |rank|)
```

#### 向量相似度
```rust
// 余弦相似度 (归一化向量的点积)
similarity = dot(query_vec, doc_vec) / (||query_vec|| × ||doc_vec||)
```

#### 嵌入存储
```rust
// BLOB 存储：f32[] → Vec<u8>
embedding_bytes = embedding.iter()
    .flat_map(|f| f.to_le_bytes())
    .collect()
```

### 关键文件

- `src-tauri/Cargo.toml:31-33` - ONNX Runtime 依赖
- `src-tauri/src/embeddings.rs` - 完整嵌入实现 (237 行)
- `src-tauri/src/search.rs:9-10` - 混合权重常量
- `src-tauri/src/search.rs:18-40` - 混合检索入口
- `src-tauri/src/search.rs:98-201` - hybrid_search_full 核心算法

---

## 📊 最终成果

### 代码统计

| 模块 | 文件 | 新增行数 | 测试数 |
|------|------|---------|--------|
| 数据库 | db.rs | +240 | 6 |
| 切片器 | chunker.rs | +387 | 10 |
| 嵌入 | embeddings.rs | +237 | 3 |
| 搜索 | search.rs | +206 | 6 |
| **总计** | | **+1070** | **25** |

### 测试覆盖

- ✅ 数据库初始化与扩展加载
- ✅ 幽灵数据清理与级联删除
- ✅ Markdown 结构化切片（10种复杂场景）
- ✅ 向量归一化与相似度计算
- ✅ 混合检索权重与 Fallback

---

## 🚀 Day 4 计划：验证性 UI

### 目标

**如果搜不到"藏在三级标题下的 Python 代码块"，项目直接原地解散！**

### 任务清单

1. ⏳ 创建简化的测试 UI
   - Input 框：搜索查询
   - List 视图：搜索结果

2. ⏳ 硬编码测试数据
   - 导入本地复杂 README 文件夹
   - 确保有深层嵌套代码块

3. ⏳ 终极测试
   - 查询："python async function"
   - 期望：找到嵌套在 `# Main > ## Module > ### Implementation` 下的 Python 代码
   - **成功标准：** 返回结果包含正确的代码块 + 完整标题路径

---

## 💡 核心创新点

1. **结构感知切片**
   - 代码块永不分割 ✅
   - 维护标题层级上下文 ✅
   - 语义边界保护 ✅

2. **混合检索智能融合**
   - BM25 关键词精确性 (30%)
   - Vector 语义泛化性 (70%)
   - Fallback 无缝降级 ✅

3. **幽灵数据管理**
   - 启动时自动清理 ✅
   - 级联删除保证一致性 ✅

---

## 📝 使用说明

### 下载 bge-m3 模型

```bash
# 创建模型目录
mkdir -p ~/.deepseeker/models/bge-m3

# 下载 ONNX 模型和 tokenizer
# 方法 1: 从 HuggingFace 下载
# https://huggingface.co/BAAI/bge-m3

# 方法 2: 使用 huggingface-cli
pip install -U "huggingface_hub[cli]"
huggingface-cli download BAAI/bge-m3 \
    model.onnx tokenizer.json \
    --local-dir ~/.deepseeker/models/bge-m3
```

### 运行测试

```bash
cd src-tauri

# 数据库测试
cargo test db::tests --lib

# 切片器测试
cargo test chunker::tests --lib

# 嵌入测试
cargo test embeddings::tests --lib

# 搜索测试
cargo test search::tests --lib

# 全部测试
cargo test --lib
```

### 编译项目

```bash
# 开发模式
npm run tauri dev

# 生产构建
npm run tauri build
```

---

## ⚠️ 已知限制

1. **环境依赖**
   - 需要手动下载 bge-m3 模型
   - 无模型时自动 fallback 到 BM25

2. **向量存储**
   - 当前使用 BLOB 存储
   - 未使用 sqlite-vec 虚拟表（待优化）

3. **性能**
   - 未启用批量嵌入优化
   - 向量搜索未使用索引（全扫描）

---

## 📅 下一步

### Phase 2: UI 与端到端验证
- Day 4: 验证性 UI
- Day 5: 性能优化（批量嵌入、向量索引）
- Day 6: 端到端集成测试

### Phase 3: 生产就绪
- CI/CD pipeline
- 性能基准测试
- 文档完善

---

**团队备注：** Phase 1 代码已通过所有单元测试，混合检索核心引擎已验证可用。Day 4 将进行最终的端到端搜索能力验证。
