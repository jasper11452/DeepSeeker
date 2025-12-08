import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  FileText,
  Plus,
  Settings,
  MessageSquare,
  Network,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { searchApi, documentsApi, Document } from '../lib/api';
import { useUIStore } from '../stores/uiStore';
import { useConversationStore } from '../stores/conversationStore';

interface CommandPaletteProps {
  onClose: () => void;
}

interface CommandItem {
  id: string;
  type: 'document' | 'action' | 'search';
  title: string;
  description?: string;
  isHtml?: boolean;
  icon: React.ReactNode;
  shortcut?: string[];
  onSelect: () => void;
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { openSettings } = useUIStore();
  const { create } = useConversationStore();

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch documents
  const { data: documentsData } = useQuery({
    queryKey: ['documents'],
    queryFn: () => documentsApi.list({ limit: 20 }),
  });

  // Quick search
  const { data: searchResults } = useQuery({
    queryKey: ['quickSearch', query],
    queryFn: () => searchApi.quickSearch(query, 5),
    enabled: query.length >= 2,
  });

  // Build command items
  const commandItems = useMemo(() => {
    const items: CommandItem[] = [];

    // Actions
    const actions: CommandItem[] = [
      {
        id: 'new-note',
        type: 'action',
        title: '新建笔记',
        description: '创建一篇新的笔记文档',
        icon: <Plus className="w-4 h-4" />,
        shortcut: ['⌘', 'N'],
        onSelect: () => {
          // TODO: Implement new note creation (maybe navigate to a new note route or open modal)
          alert('功能开发中');
          onClose();
        },
      },
      {
        id: 'open-graph',
        type: 'action',
        title: '打开知识图谱',
        description: '可视化探索知识关联',
        icon: <Network className="w-4 h-4" />,
        shortcut: ['⌘', 'G'],
        onSelect: () => {
          navigate('/graph');
          onClose();
        },
      },
      {
        id: 'open-chat',
        type: 'action',
        title: '新建对话',
        description: '开始新的智能问答',
        icon: <MessageSquare className="w-4 h-4" />,
        onSelect: async () => {
          const id = await create();
          navigate(`/chat/${id}`);
          onClose();
        },
      },
      {
        id: 'open-settings',
        type: 'action',
        title: '设置',
        description: '应用配置',
        icon: <Settings className="w-4 h-4" />,
        shortcut: ['⌘', ','],
        onSelect: () => {
          openSettings();
          onClose();
        },
      },
    ];

    // If query exists, show search results first
    if (query.length >= 2 && searchResults?.results) {
      searchResults.results.forEach((result: any) => {
        items.push({
          id: `search-result-${result.chunk_id}`,
          type: 'search',
          title: result.filename || '搜索结果',
          description: result.preview, // Backend provides highlighted preview (HTML)
          isHtml: true,
          icon: <FileText className="w-4 h-4" />,
          onSelect: () => {
            navigate(`/document/${result.document_id}`);
            onClose();
          },
        });
      });
    }

    // Filter actions by query
    const filteredActions = actions.filter(
      (action) =>
        !query ||
        action.title.toLowerCase().includes(query.toLowerCase()) ||
        action.description?.toLowerCase().includes(query.toLowerCase())
    );

    items.push(...filteredActions);

    // Add recent documents if no query
    if (!query && documentsData?.documents) {
      documentsData.documents.slice(0, 5).forEach((doc: Document) => {
        items.push({
          id: `doc - ${doc.id} `,
          type: 'document',
          title: doc.title || doc.filename,
          description: doc.filename,
          icon: <FileText className="w-4 h-4" />,
          onSelect: () => {
            navigate(`/ document / ${doc.id} `);
            onClose();
          },
        });
      });
    }

    return items;
  }, [query, searchResults, documentsData, onClose, openSettings, navigate, create]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, commandItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (commandItems[selectedIndex]) {
            commandItems[selectedIndex].onSelect();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandItems, selectedIndex]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Group items by type
  const groupedItems = useMemo(() => {
    const groups: { title: string; items: CommandItem[] }[] = [];

    const searchItems = commandItems.filter((i) => i.type === 'search');
    const documentItems = commandItems.filter((i) => i.type === 'document');
    const actionItems = commandItems.filter((i) => i.type === 'action');

    if (searchItems.length > 0) {
      groups.push({ title: '搜索结果', items: searchItems });
    }
    if (documentItems.length > 0) {
      groups.push({ title: '最近文档', items: documentItems });
    }
    if (actionItems.length > 0) {
      groups.push({ title: '快捷操作', items: actionItems });
    }

    return groups;
  }, [commandItems]);

  let itemIndex = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="relative w-[580px] bg-white dark:bg-dark-elevated border border-default rounded-2xl shadow-lg overflow-hidden animate-fade-in">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-subtle">
          <Search className="w-5 h-5 text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文档、笔记或执行命令..."
            className="flex-1 bg-transparent text-base text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-600 outline-none"
          />
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto py-2">
          {groupedItems.map((group) => (
            <div key={group.title} className="mb-2">
              <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {group.title}
              </div>
              {group.items.map((item) => {
                itemIndex++;
                const isSelected = itemIndex === selectedIndex;
                const currentIndex = itemIndex;

                return (
                  <div
                    key={item.id}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(currentIndex)}
                    className={cn(
                      'flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all',
                      isSelected ? 'bg-gray-100 dark:bg-dark-hover' : 'hover:bg-gray-50 dark:hover:bg-dark-hover/50'
                    )}
                  >
                    <div
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center',
                        isSelected
                          ? 'bg-accent-glow text-accent-secondary'
                          : 'bg-gray-100 dark:bg-dark-tertiary text-gray-500 dark:text-gray-400'
                      )}
                    >
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 dark:text-white">{item.title}</div>
                      {item.description && (
                        item.isHtml ? (
                          <div
                            className="text-xs text-gray-500 truncate"
                            dangerouslySetInnerHTML={{ __html: item.description }}
                          />
                        ) : (
                          <div className="text-xs text-gray-500 truncate">
                            {item.description}
                          </div>
                        )
                      )}
                    </div>
                    {item.shortcut && (
                      <div className="flex gap-1">
                        {item.shortcut.map((key, i) => (
                          <kbd
                            key={i}
                            className="px-2 py-1 text-xs font-mono text-gray-500 bg-gray-100 dark:bg-dark-tertiary rounded"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {commandItems.length === 0 && (
            <div className="py-12 text-center text-gray-500">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>未找到相关结果</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-subtle flex justify-between text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-dark-tertiary rounded font-mono">↑↓</kbd>
            <span>导航</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-dark-tertiary rounded font-mono">↵</kbd>
            <span>打开</span>
          </div>
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-dark-tertiary rounded font-mono">esc</kbd>
            <span>关闭</span>
          </div>
        </div>
      </div>
    </div>
  );
}