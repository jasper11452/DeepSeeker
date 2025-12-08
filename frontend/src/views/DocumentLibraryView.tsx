import React, { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FileText, Upload, Trash2, Loader2, Plus, PenLine, X, Menu } from 'lucide-react';
import { documentsApi, foldersApi, tagsApi, Document } from '../lib/api';
import { formatDate, formatFileSize, cn } from '../lib/utils';
import { FolderTree } from '../components/FolderTree';
import { TagSelector } from '../components/TagSelector';

export function DocumentLibraryView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Filter state
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [activeTagId, setActiveTagId] = useState<number | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);

  // Fetch folders
  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: foldersApi.list,
  });

  // Fetch tags
  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: tagsApi.list,
  });

  // Fetch documents with filters
  const { data, isLoading, error } = useQuery({
    queryKey: ['documents', activeFolderId, activeTagId],
    queryFn: () => documentsApi.list({
      limit: 50,
      folder_id: activeFolderId,
      tag_id: activeTagId
    }),
    refetchInterval: (query) => {
      const docs = query.state.data?.documents || [];
      const hasProcessing = docs.some(d => d.status && d.status !== 'completed' && d.status !== 'failed');
      return hasProcessing ? 2000 : false;
    },
  });

  // Folder Mutations
  const createFolderMutation = useMutation({
    mutationFn: (data: { name: string; parentId?: number }) =>
      foldersApi.create({ name: data.name, parent_id: data.parentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['folders'] }),
  });

  const updateFolderMutation = useMutation({
    mutationFn: (data: { id: number; name: string }) =>
      foldersApi.update(data.id, { name: data.name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['folders'] }),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: foldersApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setActiveFolderId(null);
    },
  });

  // Tag Mutations
  const createTagMutation = useMutation({
    mutationFn: (name: string) => tagsApi.create({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  });

  const deleteTagMutation = useMutation({
    mutationFn: tagsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setActiveTagId(null);
    },
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: documentsApi.upload,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      // 短暂延迟后再次刷新，确保后端已开始处理并返回状态
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['documents'] });
      }, 500);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: documentsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => uploadMutation.mutate(file));
  }, [uploadMutation]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Handle file input
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => uploadMutation.mutate(file));
    e.target.value = '';
  }, [uploadMutation]);

  const handleDocClick = (doc: Document) => {
    navigate(`/document/${doc.id}`);
  };

  // Handle create note
  const handleCreateNote = async () => {
    if (!noteTitle.trim()) return;

    setIsCreating(true);
    try {
      const result = await documentsApi.createNote(noteTitle.trim());
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowCreateDialog(false);
      setNoteTitle('');
      // Navigate to the new note for editing
      navigate(`/document/${result.id}?edit=true`);
    } catch (err) {
      console.error('Failed to create note:', err);
      alert('创建笔记失败');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      className="flex-1 flex h-full overflow-hidden"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Sidebar Toggle (Mobile) */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-40 w-64 bg-gray-50 dark:bg-dark-secondary border-r border-subtle transform transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 flex flex-col",
        !showSidebar && "-translate-x-full lg:hidden"
      )}>
        <div className="flex-1 overflow-y-auto p-2">
          <FolderTree
            folders={folders}
            activeFolderId={activeFolderId}
            onSelectFolder={(id) => {
              setActiveFolderId(id);
              setActiveTagId(null); // Clear tag filter when changing folder
            }}
            onCreateFolder={(name, parentId) => createFolderMutation.mutate({ name, parentId })}
            onUpdateFolder={(id, name) => updateFolderMutation.mutate({ id, name })}
            onDeleteFolder={(id) => deleteFolderMutation.mutate(id)}
          />

          <div className="my-2 border-t border-subtle" />

          <TagSelector
            tags={tags}
            selectedTagId={activeTagId}
            onSelectTag={(id) => {
              setActiveTagId(id);
              setActiveFolderId(null); // Clear folder filter when selecting tag? Or allow both? 
              // Let's allow one main filter mode for simplicity initially, or both.
              // If I select a tag, I might want to see all docs with that tag regardless of folder.
              if (id) setActiveFolderId(null);
            }}
            onCreateTag={(name) => createTagMutation.mutate(name)}
            onDeleteTag={(id) => deleteTagMutation.mutate(id)}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-dark-primary relative transition-all">
        {/* Header */}
        <div className="px-6 py-4 border-b border-subtle flex items-center justify-between bg-white dark:bg-dark-primary">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-hover"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                {activeFolderId
                  ? folders.find(f => f.id === activeFolderId)?.name || 'Folder'
                  : activeTagId
                    ? `#${tags.find(t => t.id === activeTagId)?.name || 'Tag'}`
                    : '文档库'}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {data?.total || 0} 个文档
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-all"
            >
              <PenLine className="w-4 h-4" />
              创建笔记
            </button>
            <label className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-secondary text-white text-sm font-medium cursor-pointer transition-all">
              <Plus className="w-4 h-4" />
              上传文档
              <input
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.md,.txt,.docx,.pptx,.xlsx,.xls,.html,.htm,.json,.xml,.csv,.zip,.epub"
                onChange={handleFileSelect}
              />
            </label>
          </div>
        </div>

        {/* Create Note Dialog */}
        {showCreateDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-dark-elevated rounded-2xl shadow-xl w-[400px] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">创建新笔记</h2>
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-hover flex items-center justify-center text-gray-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                placeholder="输入笔记标题..."
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateNote()}
                autoFocus
                className="w-full px-4 py-3 rounded-lg bg-gray-100 dark:bg-dark-tertiary text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-primary"
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="px-4 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-hover transition-all"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateNote}
                  disabled={!noteTitle.trim() || isCreating}
                  className="px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Document List */}
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50/50 dark:bg-gradient-mesh">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-accent-primary animate-spin" />
            </div>
          )}

          {error && (
            <div className="text-center py-12 text-red-500 dark:text-red-400">
              加载失败，请检查后端服务
            </div>
          )}

          {data && data.documents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-dark-tertiary flex items-center justify-center mb-4">
                <Upload className="w-8 h-8 text-gray-400 dark:text-gray-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">暂无文档</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">拖放文件到此处，或点击上传按钮</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs">
                支持: PDF, Word, PPT, Excel, Markdown, TXT, HTML, JSON, CSV, EPUB, ZIP
              </p>
            </div>
          )}

          {data && data.documents.length > 0 && (
            <div className="grid gap-3">
              {data.documents.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => handleDocClick(doc)}
                  className="group flex items-center gap-4 p-4 rounded-xl bg-white dark:bg-dark-elevated border border-gray-200 dark:border-default hover:border-accent-primary/50 dark:hover:border-accent-primary/50 cursor-pointer transition-all shadow-sm dark:shadow-none"
                >
                  <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-dark-tertiary flex items-center justify-center">
                    <FileText className="w-5 h-5 text-accent-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {doc.title || doc.filename}
                    </div>
                    {doc.status === 'completed' || !doc.status ? (
                      <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {formatFileSize(doc.file_size)} · {formatDate(doc.created_at)}
                      </span>
                    ) : (
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs ${doc.status === 'failed' ? 'text-red-500' : 'text-accent-primary'}`}>
                          {doc.status === 'failed' ? '处理失败' : doc.processing_message || '正在处理...'}
                        </span>
                        {doc.status !== 'failed' && (
                          <div className="w-20 h-1 bg-gray-200 dark:bg-dark-tertiary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent-primary transition-all duration-300"
                              style={{ width: `${doc.processing_progress || 0}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(doc.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 w-8 h-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/20 flex items-center justify-center text-gray-400 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {
          uploadMutation.isPending && (
            <div className="fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-white dark:bg-dark-elevated border border-gray-200 dark:border-default shadow-lg">
              <Loader2 className="w-4 h-4 text-accent-primary animate-spin" />
              <span className="text-sm text-gray-900 dark:text-white">正在上传...</span>
            </div>
          )
        }
      </div>
    </div >
  );
}
