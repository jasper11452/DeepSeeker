import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { FileText, Calendar, HardDrive, Loader2, ChevronLeft, Tag as TagIcon, Edit3, Save, X, Folder as FolderIcon, Plus, ExternalLink, AlertTriangle } from 'lucide-react';
import { documentsApi, insightsApi, foldersApi, tagsApi } from '../lib/api';
import { formatDate, formatFileSize, cn } from '../lib/utils';
import { DocumentTOC } from '../components/DocumentTOC';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

// 扩展 DocumentDetail 类型以包含新增字段
interface DocumentDetailExtended {
  id: number;
  filename: string;
  title?: string;
  file_type: string;
  file_size: number;
  content?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  chunk_count: number;
  status?: string;
  processing_message?: string;
  processing_progress?: number;
  folder_id?: number;
  folder?: { id: number; name: string } | null;
  tags?: { id: number; name: string; color: string }[];
  file_path?: string;
  file_exists?: boolean;
}

// 预处理 OCR 内容：清理格式问题和幻觉（保守策略）
function preprocessOcrContent(content: string): string {
  if (!content) return content;

  let cleaned = content;

  // === 0. 规范化页面分隔符格式（先于其他清理）===
  // 将 "--- 第 X 页 ---" 格式统一转换为 "## 第 X 页"
  cleaned = cleaned.replace(/---\s*第\s*(\d+)\s*页\s*---/g, '## 第 $1 页');

  // === 1. 清理幻觉行 ===
  // 这些是 OCR 模型常见的独立成行的幻觉输出
  // 使用更宽松的匹配：可选的句号和其他标点
  const hallucinationLinePatterns = [
    /^\s*markers[.\s]*$/gim,
    /^\s*references[.\s]*$/gim,
    /^\s*or image references[.\s]*$/gim,
    /^\s*image references[.\s]*$/gim,
    /^\s*or mathematical symbols[.\s]*$/gim,
    /^\s*but make sure[^\n]*$/gim,
    /^\s*as much as possible[.\s]*$/gim,
    /^\s*make sure[^\n]*$/gim,
    /^\s*please note[^\n]*$/gim,
    /^\s*note that[^\n]*$/gim,
    /^\s*the following[^\n]*$/gim,
    /^\s*here is[^\n]*$/gim,
    /^\s*below is[^\n]*$/gim,
    /^\s*convert this[^\n]*$/gim,
  ];

  // 多次应用清理，确保彻底
  for (let pass = 0; pass < 3; pass++) {
    for (const pattern of hallucinationLinePatterns) {
      cleaned = cleaned.replace(pattern, '');
    }
  }

  // === 2. 清理幻觉前缀 ===
  // 清理文档开头的幻觉（以逗号开头的不完整句子）
  cleaned = cleaned.replace(/^[\s,]*,?\s*including[^.#\n]*[.。]?\s*/i, '');
  cleaned = cleaned.replace(/^[\s,]*,?\s*such as[^.#\n]*[.。]?\s*/i, '');

  // 清理行首的幻觉前缀（幻觉词汇后跟着有效内容）
  // 如 "or image references. ### Table"
  const linePrefixHallucinations = [
    /^or image references[.\s]+/gim,
    /^or mathematical symbols[.\s]+/gim,
    /^image references[.\s]+/gim,
    /^references[.\s]+(?=[#\*A-Z])/gim,
    /^markers[.\s]+(?=[#\*A-Z])/gim,
  ];
  for (const pattern of linePrefixHallucinations) {
    cleaned = cleaned.replace(pattern, '');
  }

  // 清理每个 "## 第 X 页" 后的幻觉
  // 使用更强力的清理：匹配所有已知的幻觉词汇
  const pageHallucinationPattern = /(##\s*第\s*\d+\s*页)\s*\n\n?\s*(markers|references|or image references|image references|or mathematical symbols)[.\s]*\n*/gi;
  // 多次应用以确保全部清理
  for (let i = 0; i < 5; i++) {
    cleaned = cleaned.replace(pageHallucinationPattern, '$1\n\n');
  }

  // 额外清理：逗号开头的片段
  cleaned = cleaned.replace(
    /(##\s*第\s*\d+\s*页)\s*\n\n[\s,]*,?\s*including[^.#\n]*[.。]?\s*/gi,
    '$1\n\n'
  );
  cleaned = cleaned.replace(
    /(##\s*第\s*\d+\s*页)\s*\n\n[\s,]*,?\s*such as[^.#\n]*[.。]?\s*/gi,
    '$1\n\n'
  );
  cleaned = cleaned.replace(
    /(##\s*第\s*\d+\s*页)\s*\n\n[\s,]*,\s*[a-z][^.#\n]*[.。]\s*/gi,
    '$1\n\n'
  );

  // === 3. 移除重复的表格 ===
  // 检测并移除连续重复的 Markdown 表格
  const tablePattern = /(\|[^\n]+\|\n(?:\|[-:|\s]+\|\n)?(?:\|[^\n]+\|\n)*)/g;
  const tables = cleaned.match(tablePattern);
  if (tables) {
    const seenTables = new Set<string>();
    for (const table of tables) {
      // 用表格前两行作为指纹
      const lines = table.trim().split('\n');
      const fingerprint = lines.slice(0, 2).join('\n').toLowerCase().replace(/\s+/g, ' ');

      if (seenTables.has(fingerprint)) {
        // 移除重复表格，只保留一次
        cleaned = cleaned.replace(table, '');
      } else {
        seenTables.add(fingerprint);
      }
    }
  }

  // === 3.5. 清理 OCR 重复循环模式 ===
  // 这是 OCR 模型常见的循环输出问题
  // ### Result + **Verification** 循环
  cleaned = cleaned.replace(/(### Result\s*\n\s*\*\*Verification\*\*\s*\n\s*){3,}/g, '$1');
  // 连续相同的 Markdown 标题
  cleaned = cleaned.replace(/(###\s*[^\n]+\n\s*){5,}/g, '$1');
  cleaned = cleaned.replace(/(\*\*[^\*\n]+\*\*\s*\n\s*){5,}/g, '$1');

  // === 4. 规范化空行 ===
  // 合并连续的多个空行为最多两个空行
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');

  // 清理 Markdown 标题前后的多余空行
  cleaned = cleaned.replace(/\n{3,}(#{1,6}\s)/g, '\n\n$1');
  cleaned = cleaned.replace(/(#{1,6}\s[^\n]+)\n{3,}/g, '$1\n\n');

  // === 5. 转换 LaTeX 公式格式 ===
  // OCR 输出的公式格式可能是 (\...) 或 \(...\) 而不是标准的 $...$
  // 转换块级公式：\[...\] -> $$...$$
  cleaned = cleaned.replace(/\\\[([\\s\\S]*?)\\\]/g, '$$$$1$$');

  // 转换内联公式：\(...\) -> $...$
  cleaned = cleaned.replace(/\\\((.*?)\\\)/g, '$$$1$$');

  // 转换包含 LaTeX 命令的 (...) -> $...$
  cleaned = cleaned.replace(/\(([^()]*\\[a-zA-Z][^()]*)\)/g, (match, content) => {
    // 检查是否包含 LaTeX 命令
    if (/\\[a-zA-Z]+/.test(content)) {
      return `$${content}$`;
    }
    return match; // 不是 LaTeX，保持原样
  });

  // === 6. 清理特殊字符 ===
  // 移除一些常见的 OCR 错误字符
  cleaned = cleaned.replace(/\u00a0/g, ' '); // 不间断空格 -> 普通空格
  cleaned = cleaned.replace(/\u200b/g, '');  // 零宽空格
  cleaned = cleaned.replace(/\ufeff/g, '');  // BOM

  // 合并行内多个连续空格为单个（不影响换行）
  cleaned = cleaned.split('\n').map(line => {
    // 对于表格行，保留格式
    if (line.trim().startsWith('|') || line.includes(' | ')) {
      return line;
    }
    // 对于代码块标记，保留原样
    if (line.trim().startsWith('```')) {
      return line;
    }
    // 对于包含 LaTeX 公式的行，保留原样
    if (line.includes('$')) {
      return line;
    }
    // 其他行：清理多余空格但保留缩进
    const leadingSpaces = line.match(/^(\s*)/)?.[1] || '';
    const rest = line.slice(leadingSpaces.length).replace(/  +/g, ' ');
    return leadingSpaces + rest;
  }).join('\n');

  return cleaned.trim();
}

// 文档内容渲染器：预处理后使用 MarkdownRenderer 渲染
function DocumentContent({ content }: { content: string }) {
  // 预处理 OCR 内容
  const processedContent = useMemo(() => {
    return preprocessOcrContent(content);
  }, [content]);

  return <MarkdownRenderer content={processedContent} className="document-content" />;
}

export function DocumentDetailView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const documentId = parseInt(id || '0', 10);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const { data: document, isLoading, error, refetch } = useQuery<DocumentDetailExtended>({
    queryKey: ['document', documentId],
    queryFn: () => documentsApi.get(documentId) as Promise<DocumentDetailExtended>,
    enabled: documentId > 0,
    refetchInterval: (query) => {
      // Poll if document is processing
      const status = query.state.data?.status;
      return status && status !== 'completed' && status !== 'failed' ? 1000 : false;
    },
  });

  // Fetch folders and tags
  const { data: allFolders = [] } = useQuery({ queryKey: ['folders'], queryFn: foldersApi.list });
  const { data: allTags = [] } = useQuery({ queryKey: ['tags'], queryFn: tagsApi.list });

  // Move Mutation
  const moveMutation = useMutation({
    mutationFn: (folderId: number | null) => documentsApi.move(documentId, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['documents'] }); // Refresh list view
    }
  });

  // Update Tags Mutation
  const updateTagsMutation = useMutation({
    mutationFn: (tagIds: number[]) => documentsApi.updateTags(documentId, tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] }); // Document counts might change
    }
  });

  // 文档加载后自动触发洞察生成（后台静默执行）
  useEffect(() => {
    if (document?.id) {
      // 静默触发洞察生成，不阻塞UI
      insightsApi.getDocumentInsights(document.id).catch(() => {
        // 忽略错误，不影响用户体验
      });
    }
  }, [document?.id]);

  // Check if we should start in edit mode (from URL param)
  useEffect(() => {
    if (searchParams.get('edit') === 'true' && document) {
      setIsEditing(true);
      setEditTitle(document.title || document.filename);
      setEditContent(document.content || '');
      // Clear the edit param from URL
      setSearchParams({});
    }
  }, [searchParams, document, setSearchParams]);

  // Initialize edit content when entering edit mode
  const handleStartEdit = useCallback(() => {
    if (document) {
      setEditTitle(document.title || document.filename);
      setEditContent(document.content || '');
      setIsEditing(true);
    }
  }, [document]);

  // Save and vectorize
  const handleSave = useCallback(async () => {
    if (!document) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const result = await documentsApi.update(documentId, {
        title: editTitle,
        content: editContent,
      });

      // Show success message with chunk count info
      const chunkInfo = result.chunk_count !== null
        ? `（已向量化 ${result.chunk_count} 个分块）`
        : '';
      setSaveMessage(`保存成功${chunkInfo}`);

      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      // 触发洞察重新生成
      queryClient.invalidateQueries({ queryKey: ['insights', documentId] });
      // 后台刷新洞察
      insightsApi.refreshDocumentInsights(documentId).catch(() => { });

      await refetch();

      // Exit edit mode after a short delay
      setTimeout(() => {
        setIsEditing(false);
        setSaveMessage(null);
      }, 1500);
    } catch (err) {
      console.error('Failed to save document:', err);
      setSaveMessage('保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  }, [document, documentId, editTitle, editContent, queryClient, refetch]);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditTitle('');
    setEditContent('');
    setSaveMessage(null);
  }, []);

  // Check for unsaved changes
  const hasChanges = document && (
    editTitle !== (document.title || document.filename) ||
    editContent !== (document.content || '')
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-accent-primary animate-spin" />
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 h-full">
        <FileText className="w-12 h-12 mb-4 opacity-50" />
        <p>无法加载文档</p>
        <Link to="/" className="mt-4 text-accent-primary hover:underline">返回文档库</Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-dark-primary">
      {/* Header */}
      <div className="px-8 py-6 border-b border-subtle bg-gray-50/50 dark:bg-dark-secondary/50">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {/* Breadcrumb */}
            <div className="flex items-center gap-3 mb-3">
              <Link
                to="/"
                className="w-8 h-8 rounded-lg hover:bg-gray-200 dark:hover:bg-dark-hover flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all"
              >
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Link to="/" className="hover:text-accent-primary transition-colors">文档库</Link>
                <span>/</span>
                {/* Folder Selector / Breadcrumb */}
                <div className="relative group">
                  <button className="hover:bg-gray-200 dark:hover:bg-dark-tertiary px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors">
                    <FolderIcon className="w-3 h-3" />
                    <span className="max-w-[100px] truncate">
                      {document.folder ? document.folder.name : '未分类'}
                    </span>
                  </button>
                  {/* Hover Dropdown for quick move */}
                  <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-dark-elevated shadow-lg rounded-lg border border-gray-200 dark:border-default p-1 hidden group-hover:block z-20 max-h-60 overflow-y-auto">
                    <button
                      onClick={() => moveMutation.mutate(null)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-dark-hover mb-1 text-gray-700 dark:text-gray-300",
                        !document.folder_id && "bg-accent-primary/10 text-accent-primary"
                      )}
                    >
                      未分类 (Root)
                    </button>
                    {allFolders.map(folder => (
                      <button
                        key={folder.id}
                        onClick={() => moveMutation.mutate(folder.id)}
                        className={cn(
                          "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-dark-hover text-gray-700 dark:text-gray-300 truncate",
                          document.folder_id === folder.id && "bg-accent-primary/10 text-accent-primary"
                        )}
                      >
                        {folder.name}
                      </button>
                    ))}
                  </div>
                </div>
                <span>/</span>
                <span className="text-gray-400 dark:text-gray-500">{document.file_type.toUpperCase()}</span>
              </div>
            </div>

            {isEditing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-2xl font-bold text-gray-900 dark:text-white mb-3 bg-transparent border-b-2 border-accent-primary focus:outline-none w-full"
                placeholder="文档标题"
              />
            ) : (
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
                {document.title || document.filename}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>{formatDate(document.created_at)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" />
                <span>{formatFileSize(document.file_size)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <TagIcon className="w-3.5 h-3.5" />
                <span>{document.chunk_count} 个分块</span>
              </div>

              {/* 源文件路径显示 */}
              {document.file_path && !document.file_path.startsWith('note://') && (
                <div className="flex items-center gap-1.5">
                  {document.file_exists ? (
                    <>
                      <ExternalLink className="w-3.5 h-3.5 text-accent-primary" />
                      <span
                        className="text-accent-primary hover:underline cursor-pointer max-w-[300px] truncate"
                        title={`源文件路径: ${document.file_path}\n点击复制路径`}
                        onClick={() => {
                          navigator.clipboard.writeText(document.file_path || '');
                          // 可以添加一个 toast 提示"路径已复制"
                        }}
                      >
                        📁 {document.file_path.split('/').pop()}
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-amber-500" title={`源文件已删除: ${document.file_path}`}>
                        源文件已删除
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Tags Section */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {document.tags?.map(tag => (
                <div key={tag.id} className="flex items-center bg-gray-100 dark:bg-dark-tertiary px-2 py-0.5 rounded-full text-xs text-gray-600 dark:text-gray-300">
                  <div className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                  <button
                    onClick={() => {
                      const newTags = document.tags?.filter(t => t.id !== tag.id).map(t => t.id) || [];
                      updateTagsMutation.mutate(newTags);
                    }}
                    className="ml-1.5 hover:text-red-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              <div className="relative group">
                <button className="flex items-center gap-1 text-xs text-accent-primary hover:bg-accent-primary/10 px-2 py-0.5 rounded-full transition-colors">
                  <Plus className="w-3 h-3" />
                  添加标签
                </button>
                {/* Tag Dropdown */}
                <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-dark-elevated shadow-lg rounded-lg border border-gray-200 dark:border-default p-1 hidden group-hover:block z-20 max-h-60 overflow-y-auto">
                  {allTags.filter(t => !document.tags?.some(dt => dt.id === t.id)).length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-gray-400">无可用标签</div>
                  )}
                  {allTags.filter(t => !document.tags?.some(dt => dt.id === t.id)).map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => {
                        const currentTagIds = document.tags?.map(t => t.id) || [];
                        updateTagsMutation.mutate([...currentTagIds, tag.id]);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-dark-hover text-gray-700 dark:text-gray-300 flex items-center gap-2"
                    >
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Edit/Save buttons */}
          <div className="flex items-center gap-2">
            {saveMessage && (
              <span className={`text-sm ${saveMessage.includes('成功') ? 'text-green-500' : 'text-red-500'}`}>
                {saveMessage}
              </span>
            )}
            {isEditing ? (
              <>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 dark:bg-dark-tertiary text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-hover transition-all disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !hasChanges}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {isSaving ? '保存中...' : '保存并向量化'}
                </button>
              </>
            ) : (
              <button
                onClick={handleStartEdit}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
              >
                <Edit3 className="w-4 h-4" />
                编辑
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-6xl mx-auto flex gap-12 items-start">
          <div className="flex-1 min-w-0 max-w-3xl">
            {isEditing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="开始编写内容..."
                className="w-full h-[calc(100vh-300px)] min-h-[400px] bg-gray-50 dark:bg-dark-tertiary rounded-xl p-6 text-gray-700 dark:text-gray-300 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary font-mono text-sm"
              />
            ) : (
              <>
                {document.status && document.status !== 'completed' && document.status !== 'failed' ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <Loader2 className="w-12 h-12 text-accent-primary animate-spin mb-4" />
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                      正在处理文档
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 mb-6">
                      {document.processing_message || '正在分析内容...'}
                    </p>
                    <div className="w-64 h-2 bg-gray-200 dark:bg-dark-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-primary transition-all duration-300"
                        style={{ width: `${document.processing_progress || 0}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      {Math.round(document.processing_progress || 0)}%
                    </p>
                  </div>
                ) : document.status === 'failed' ? (
                  <div className="flex flex-col items-center justify-center py-20 text-red-500">
                    <X className="w-12 h-12 mb-4" />
                    <h2 className="text-xl font-semibold mb-2">处理失败</h2>
                    <p className="text-gray-500 dark:text-gray-400 mb-4">{document.processing_message}</p>
                  </div>
                ) : document.content ? (
                  // 对所有文档类型都使用增强的 markdown 渲染
                  <DocumentContent content={document.content} />
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
                    <FileText className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg mb-4">暂无内容</p>
                    <button
                      onClick={handleStartEdit}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
                    >
                      <Edit3 className="w-4 h-4" />
                      开始编辑
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* TOC Sidebar */}
        {!isEditing && document?.file_type === 'md' && document?.content && (
          <DocumentTOC content={document.content} />
        )}
      </div>
    </div>
  );
}
