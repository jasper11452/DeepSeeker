import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { FileText, Calendar, HardDrive, Loader2, ChevronLeft, Tag as TagIcon, Edit3, Save, X, Folder as FolderIcon, Plus } from 'lucide-react';
import { documentsApi, insightsApi, foldersApi, tagsApi } from '../lib/api';
import { formatDate, formatFileSize, cn } from '../lib/utils';
import { DocumentTOC } from '../components/DocumentTOC';

// Helper to generate IDs for TOC
function generateId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Simple markdown renderer (basic formatting)
function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeBlockKey = 0;

  const renderLine = (text: string) => {
    // Split by `code` or **bold** tokens
    // Note: This simple split might break if nested, but sufficient for simple markdown
    const parts = text.split(/(`[^`]+`|\*\*.*?\*\*)/g);

    return parts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code key={i} className="bg-gray-100 dark:bg-dark-tertiary px-1.5 py-0.5 rounded text-sm font-mono text-pink-500 dark:text-pink-400">
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={i} className="font-bold text-gray-900 dark:text-white">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for code block fence
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End of block
        elements.push(
          <pre key={`code-${codeBlockKey++}`} className="bg-gray-900 text-gray-100 p-4 rounded-xl overflow-x-auto my-4 text-sm font-mono leading-relaxed">
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        // Start of block
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Normal rendering
    if (line.startsWith('### ')) {
      const text = line.slice(4);
      elements.push(<h3 id={generateId(text)} key={i} className="text-lg font-semibold text-gray-900 dark:text-white mt-6 mb-2 scroll-mt-20">{text}</h3>);
      continue;
    }
    if (line.startsWith('## ')) {
      const text = line.slice(3);
      elements.push(<h2 id={generateId(text)} key={i} className="text-xl font-bold text-gray-900 dark:text-white mt-8 mb-3 scroll-mt-20">{text}</h2>);
      continue;
    }
    if (line.startsWith('# ')) {
      const text = line.slice(2);
      elements.push(<h1 id={generateId(text)} key={i} className="text-2xl font-bold text-gray-900 dark:text-white mt-8 mb-4 scroll-mt-20">{text}</h1>);
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<div key={i} className="flex gap-2 ml-2"><span className="text-accent-primary">•</span><p className="text-gray-700 dark:text-gray-300">{renderLine(line.slice(2))}</p></div>);
      continue;
    }
    if (line.startsWith('> ')) {
      elements.push(<blockquote key={i} className="border-l-4 border-accent-primary pl-4 py-1 my-2 bg-gray-50 dark:bg-dark-secondary/30 rounded-r text-gray-600 dark:text-gray-400 italic">{renderLine(line.slice(2))}</blockquote>);
      continue;
    }
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
      continue;
    }

    elements.push(<p key={i} className="text-gray-700 dark:text-gray-300 leading-relaxed min-h-[1.5em]">{renderLine(line)}</p>);
  }

  // Handle unclosed code block (fallback)
  if (inCodeBlock && codeBuffer.length > 0) {
    elements.push(
      <pre key={`code-${codeBlockKey++}`} className="bg-gray-900 text-gray-100 p-4 rounded-xl overflow-x-auto my-4 text-sm font-mono leading-relaxed">
        <code>{codeBuffer.join('\n')}</code>
      </pre>
    );
  }

  return <div className="space-y-2">{elements}</div>;
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

  const { data: document, isLoading, error, refetch } = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => documentsApi.get(documentId),
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

            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
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
                  document.file_type === 'md'
                    ? <SimpleMarkdown content={document.content} />
                    : <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{document.content}</pre>
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
