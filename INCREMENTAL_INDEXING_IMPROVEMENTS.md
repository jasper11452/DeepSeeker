# 增量索引与文件监听改进

## 概述

本次更新完善了 DeepSeeker 的增量索引系统，提升了文件监听的健壮性和性能。

## 主要改进

### 1. 去抖动优化 (Debounce Optimization)

**问题**: 文件保存时可能瞬间触发多次文件系统事件，导致重复更新。

**解决方案**:
- 在 `src-tauri/src/watcher.rs` 中实现了 `DebounceState` 结构
- 使用 HashMap 追踪文件的最后修改时间
- 设置 500ms 的去抖动延迟
- 只有在文件稳定一段时间后才触发实际的增量更新

**代码位置**: `src-tauri/src/watcher.rs:9-71`

**效果**: 避免了重复的文件处理，减少了不必要的 embedding 计算。

### 2. 原子化更新 (Atomic Updates)

**问题**: 旧实现中，删除和插入操作不在同一个事务中，可能导致更新失败时数据丢失。

**解决方案**:
- 使用 SQLite 事务确保操作的原子性
- 在事务中执行所有数据库操作：
  1. DELETE old document and chunks
  2. INSERT new document
  3. INSERT new chunks with embeddings
- 只有所有操作成功后才 COMMIT，失败则自动 ROLLBACK

**代码位置**:
- `src-tauri/src/commands.rs:714-765` (update_file_incremental)
- `src-tauri/src/watcher.rs:380-424` (update_file_sync)

**效果**: 防止了更新失败导致的数据不一致问题。

### 3. 智能 Diff (Smart Diff)

**问题**: 即使文件只修改了一小部分，也会为所有 chunks 重新生成 embedding（最耗时的操作）。

**解决方案**:
- 为每个 chunk 的内容计算 SHA256 hash
- 从数据库加载旧的 chunks 及其 embeddings
- 比较新旧 chunks 的 content hash
- 对于内容未变化的 chunks，直接重用旧的 embedding
- 只为新增或修改的 chunks 生成新的 embedding

**代码位置**:
- `src-tauri/src/commands.rs:607-712` (update_file_incremental)
- `src-tauri/src/watcher.rs:267-369` (update_file_sync)

**效果**: 显著减少了 embedding 计算时间，特别是对大文件的局部修改场景。

## 性能提升

假设一个 1000 行的文档被分成 50 个 chunks：

- **场景 1**: 修改 5 行（影响 1-2 个 chunks）
  - 旧方案: 重新计算 50 个 embeddings
  - 新方案: 重用 48-49 个 embeddings，只计算 1-2 个
  - **性能提升**: ~25倍

- **场景 2**: 大范围修改（影响 20 个 chunks）
  - 旧方案: 重新计算 50 个 embeddings
  - 新方案: 重用 30 个 embeddings，只计算 20 个
  - **性能提升**: ~2.5倍

## 日志改进

新的日志输出提供了更详细的信息：

```
Smart Diff: 50 chunks total, 2 need new embeddings, 48 reusing old
✓ Incrementally updated /path/to/file.md (50 chunks, 48 embeddings reused, 2 new)
```

## 技术细节

### Debounce 机制

```rust
pub struct DebounceState {
    pending_files: Arc<Mutex<HashMap<String, Instant>>>,
    debounce_delay: Duration,
}
```

- 使用 Arc<Mutex<>> 确保线程安全
- 延迟检查通过 sleep + should_process 实现
- 成功处理后自动清理 pending 状态

### Smart Diff 算法

1. 计算旧 chunks 的 content hash → embedding 映射
2. 对于每个新 chunk：
   - 计算 content hash
   - 在映射中查找
   - 如果找到：重用旧 embedding
   - 如果未找到：加入待计算列表
3. 批量生成新的 embeddings
4. 合并重用的和新生成的 embeddings

### 事务保证

```rust
let tx = conn.transaction()?;
// DELETE + INSERT operations
tx.commit()?;
```

如果任何操作失败，事务会自动回滚，保证数据一致性。

## 兼容性

- 无需数据库迁移
- 完全向后兼容
- 对现有功能无影响

## 测试建议

1. 创建一个大型 Markdown 文件（>1000 行）
2. 索引到 collection
3. 修改文件的一小部分
4. 保存并观察日志中的 "Smart Diff" 信息
5. 验证搜索结果正确更新

## 未来优化方向

1. **Chunk Hash 持久化**: 在数据库中添加 `chunk_hash` 字段，避免每次都重新计算
2. **增量 FTS 更新**: 目前 FTS5 索引由触发器自动维护，可考虑进一步优化
3. **并行 Embedding 生成**: 对于多个文件同时修改的场景，可以并行处理
4. **LRU Cache**: 为最近访问的 embeddings 添加缓存

## 相关文件

- `src-tauri/src/watcher.rs` - 文件监听与去抖动
- `src-tauri/src/commands.rs` - Tauri 命令处理
- `src-tauri/src/db.rs` - 数据库操作
