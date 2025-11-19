# Day 4: Phase 1 验证测试说明

## 🎯 关键目标

**这是 Phase 1 最关键的测试！**

如果搜索无法找到"藏在三级标题下的 Python 代码块"，说明整个结构化切片和搜索系统失败。

---

## 📋 实现内容

### 1. 测试数据文件
**文件**: `/home/user/deepseeker/test-data/validation_test.md`

包含以下测试场景：
- ✅ 深层嵌套的代码块（最深 5 级标题）
- ✅ 多语言代码块（Python, JavaScript, Rust）
- ✅ 完整的标题层级结构
- ✅ 长代码块测试
- ✅ 特殊字符测试（正则表达式）

**关键测试点**：
```
DeepSeeker 验证测试文档
└── 高级功能
    └── 数据处理
        └── 数据库操作
            └── Python 异步处理示例
                └── async def fetch_data(url)  ← 这个必须能搜到！
```

### 2. 验证 UI 组件
**文件**: `/home/user/deepseeker/src/components/ValidationTest.tsx`

功能特性：
- ✅ 一键索引测试数据（硬编码路径）
- ✅ 搜索输入框 + 快捷测试按钮
- ✅ **关键显示**: 展示完整标题层级路径
- ✅ 代码块类型和语言标识
- ✅ 搜索结果排名和得分

### 3. App 集成
**文件**: `/home/user/deepseeker/src/App.tsx`

- ✅ 添加 "🧪 Phase 1 验证测试" 按钮到顶部导航
- ✅ 点击切换到验证测试模式
- ✅ 独立的全屏验证界面

---

## 🚀 如何运行测试

### 步骤 1: 启动应用
```bash
cd /home/user/deepseeker
npm run tauri dev
```

### 步骤 2: 进入验证模式
1. 应用启动后，点击右上角 **"🧪 Phase 1 验证测试"** 按钮
2. 进入验证测试专用界面

### 步骤 3: 索引测试数据
1. 点击 **"索引测试数据"** 按钮
2. 等待索引完成（应该显示 "✅ 测试数据索引完成！"）
3. 记录测试集合 ID

### 步骤 4: 执行关键测试

#### 测试 A: 搜索深层嵌套的 Python 代码
**输入查询**: `async python`

**期望结果**:
```
✅ 应该找到至少 1 个结果
✅ 结果中应该包含 async def fetch_data(url) 函数
✅ 标题层级应该显示:
   DeepSeeker 验证测试文档 > 高级功能 > 数据处理 > 数据库操作 > Python 异步处理示例
✅ 代码块类型: code
✅ 语言: python
```

**如果这个测试失败，项目不能继续！**

#### 测试 B: 类定义搜索
**输入查询**: `DataProcessor`

**期望结果**:
```
✅ 找到 DataProcessor 类定义
✅ 标题层级: DeepSeeker 验证测试文档 > 深层测试 > Level 1 > Level 2 > Level 3 - 关键代码
✅ 代码块包含 async def process(self, data) 方法
```

#### 测试 C: 函数名搜索
**输入查询**: `bubble_sort`

**期望结果**:
```
✅ 找到 bubble_sort 函数
✅ 标题层级显示嵌套结构
✅ 代码块完整（不应被分割）
```

#### 测试 D: 关键词搜索
**输入查询**: `fetch data`

**期望结果**:
```
✅ 找到包含 "fetch" 和 "data" 的代码块
✅ 可能包含多个结果（Python async, JavaScript async）
✅ 按相关性得分排序
```

---

## 📊 验证清单

使用以下清单验证所有功能正常：

### 索引功能
- [ ] 测试集合创建成功
- [ ] 测试数据索引完成无错误
- [ ] 显示集合 ID

### 搜索功能
- [ ] BM25 关键词搜索工作正常
- [ ] 向量语义搜索工作正常（如果模型可用）
- [ ] 混合搜索结果合理

### 结构化切片验证
- [ ] 代码块未被分割
- [ ] 标题层级完整保存
- [ ] 标题层级正确显示
- [ ] 深层嵌套（5 级）代码块可搜索到

### UI 显示
- [ ] 搜索结果显示清晰
- [ ] 标题路径用 " > " 分隔
- [ ] 代码块有特殊标识
- [ ] 语言标签正确显示
- [ ] 得分显示正确
- [ ] 行号显示正确

---

## ❌ 常见问题排查

### 问题 1: 索引按钮无响应
**检查**:
- 查看浏览器控制台是否有错误
- 检查 Rust 后端日志
- 确认测试数据文件存在: `/home/user/deepseeker/test-data/validation_test.md`

### 问题 2: 搜索无结果
**检查**:
- 确认已先点击"索引测试数据"
- 确认索引完成（显示绿色成功消息）
- 查看后端日志确认 FTS5 工作正常

### 问题 3: 找不到深层嵌套代码块
**这是严重问题！**
- 检查 chunker.rs 的 header_stack 逻辑
- 检查数据库中 metadata JSON 是否正确保存
- 检查 FTS5 是否索引了 metadata 字段
- 如果依然失败，需要调试切片算法

### 问题 4: 标题层级未显示
**检查**:
- ValidationTest.tsx 中 result.metadata?.headers 是否有数据
- 数据库中 chunks 表的 metadata 列是否为 NULL
- 切片时是否正确序列化了 metadata

---

## 🔬 技术细节

### 测试数据文件结构
```markdown
# Level 1 (H1)
## Level 2 (H2)
### Level 3 (H3)
#### Level 4 (H4)
##### Level 5 (H5) - Python 异步处理示例

```python
async def fetch_data(url):
    # 这段代码的 metadata 应该包含:
    # {
    #   "headers": ["DeepSeeker 验证测试文档", "高级功能", "数据处理",
    #               "数据库操作", "Python 异步处理示例"],
    #   "chunk_type": "code",
    #   "language": "python"
    # }
    ...
```
```

### 预期数据库内容
执行查询查看切片结果：
```sql
SELECT
    c.id,
    c.content,
    c.metadata,
    c.start_line,
    c.end_line
FROM chunks c
JOIN documents d ON c.doc_id = d.id
WHERE d.path LIKE '%validation_test.md'
ORDER BY c.start_line;
```

### 预期 FTS5 索引
```sql
-- 应该能通过 FTS5 搜索到
SELECT * FROM chunks_fts WHERE chunks_fts MATCH 'async python';
```

---

## 📈 成功标准

Phase 1 验证测试通过的标准：

1. ✅ **关键测试通过**: 搜索 "async python" 找到深层嵌套的 Python 代码块
2. ✅ **标题层级正确**: 显示完整 5 级标题路径
3. ✅ **代码块完整**: 代码块未被切分
4. ✅ **搜索准确**: 所有 4 个快捷测试都返回相关结果
5. ✅ **UI 正常**: 验证界面显示正常，所有功能可用

**如果任何一项失败，特别是第 1 项，需要立即停止并修复！**

---

## 📝 测试记录模板

```
=== Phase 1 验证测试记录 ===
日期: YYYY-MM-DD HH:MM
测试人员: [姓名]

[ ] 步骤 1: 应用启动成功
[ ] 步骤 2: 进入验证模式成功
[ ] 步骤 3: 索引测试数据成功
    - 集合 ID: _______
    - 索引文件数: _______

[ ] 测试 A: async python
    - 结果数: _______
    - 标题层级: _______________________
    - 代码块完整: [ ] 是 [ ] 否

[ ] 测试 B: DataProcessor
    - 结果数: _______
    - 找到类定义: [ ] 是 [ ] 否

[ ] 测试 C: bubble_sort
    - 结果数: _______
    - 代码块完整: [ ] 是 [ ] 否

[ ] 测试 D: fetch data
    - 结果数: _______
    - 多语言结果: [ ] 是 [ ] 否

总体结果: [ ] 通过 [ ] 失败
```

---

## 🎉 下一步

如果所有测试通过：
1. ✅ Phase 1 完成！
2. 截图保存测试结果
3. 更新 PHASE1_SUMMARY.md
4. 提交代码
5. 准备 Phase 2 规划

**如果测试失败，必须先修复再继续！**
