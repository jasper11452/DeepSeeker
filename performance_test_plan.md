# 性能基准测试计划

## 目标
验证 DeepSeeker 在大规模数据集下的性能表现

## 测试场景

### 场景 1: 索引性能
- **数据集**: 1000个 Markdown 文件，平均 50KB/文件
- **总大小**: ~50MB
- **指标**:
  - 索引耗时 < 5分钟
  - CPU 使用率 < 80%
  - 内存峰值 < 2GB

### 场景 2: 搜索性能
- **前提**: 索引完成，数据库包含 100,000+ chunks
- **测试用例**:
  1. 纯关键词搜索 (BM25)
  2. 纯语义搜索 (Vector)
  3. 混合搜索 (Hybrid)
- **指标**:
  - P50 查询延迟 < 100ms
  - P95 查询延迟 < 200ms
  - P99 查询延迟 < 500ms

### 场景 3: 并发搜索
- **并发度**: 10个并发查询
- **指标**:
  - 平均延迟 < 300ms
  - 无崩溃
  - 内存稳定

## 测试脚本

### 准备测试数据
```bash
# 下载开源项目 README 文件
git clone https://github.com/rust-lang/rust.git test-repos/rust
git clone https://github.com/microsoft/vscode.git test-repos/vscode
# ... 更多项目

# 统计文件数
find test-repos -name "*.md" | wc -l
```

### 索引性能测试
```bash
# 记录开始时间
start_time=$(date +%s)

# 索引大文件夹
# (使用 Tauri 命令或直接调用 Rust 函数)

# 记录结束时间
end_time=$(date +%s)
echo "索引耗时: $((end_time - start_time)) 秒"
```

### 搜索性能测试
```rust
// src-tauri/benches/search_bench.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn benchmark_search(c: &mut Criterion) {
    let db = setup_test_db(); // 预加载 100k chunks

    c.bench_function("bm25_search", |b| {
        b.iter(|| {
            search::bm25_search(black_box("async python"), black_box(1), black_box(20))
        })
    });

    c.bench_function("hybrid_search", |b| {
        b.iter(|| {
            search::hybrid_search(black_box("fetch data"), black_box(1), black_box(20))
        })
    });
}

criterion_group!(benches, benchmark_search);
criterion_main!(benches);
```

## 优化检查清单

### 数据库优化
- [ ] FTS5 索引是否使用了正确的 tokenizer
- [ ] 是否创建了必要的 B-tree 索引
- [ ] 是否启用了 WAL 模式
- [ ] 是否配置了合理的 cache_size

### 向量搜索优化
- [ ] 是否使用 sqlite-vec 虚拟表查询
- [ ] 是否启用了批量嵌入
- [ ] 向量维度是否可以降低（1024 → 768）

### 应用层优化
- [ ] 是否使用连接池
- [ ] 是否缓存常用查询
- [ ] 是否实现了查询结果分页
- [ ] 是否使用了惰性加载

## 性能基准参考

### 竞品对比
| 产品 | 索引速度 | 查询延迟 | 数据规模 |
|------|---------|---------|---------|
| Algolia | ~1000 docs/s | < 50ms | 百万级 |
| Elasticsearch | ~500 docs/s | < 100ms | 千万级 |
| **DeepSeeker** | ? | ? | ? |

### 目标
- 索引速度: > 100 docs/s
- 查询延迟: < 200ms (P95)
- 数据规模: 支持 100k+ chunks

## 故障排查

### 索引慢
- 检查: 是否为每个 chunk 单独 INSERT（应该用批量事务）
- 检查: 是否同步调用嵌入模型（应该批量嵌入）
- 检查: FTS5 触发器是否造成性能瓶颈

### 搜索慢
- 检查: 是否全表扫描向量（应该用 sqlite-vec 索引）
- 检查: 是否每次都重新加载模型（应该全局单例）
- 检查: BM25 候选集是否过大（limit × 3 是否合理）

## 下一步

1. **立即**: 运行小规模测试（1000 chunks）
2. **本周**: 运行中等规模测试（10k chunks）
3. **下周**: 运行大规模测试（100k chunks）
4. **优化**: 根据测试结果优化瓶颈
5. **文档**: 在 README 中发布性能数据
