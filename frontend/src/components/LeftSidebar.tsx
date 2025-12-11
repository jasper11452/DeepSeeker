import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Plus, MessageSquare, Settings, Search, Trash2, FolderOpen,
  Brain, Layers, TrendingUp, FileText, AlertCircle, Network, ChevronDown, ChevronRight
} from 'lucide-react';
import { useConversationStore } from '../stores/conversationStore';
import { useUIStore } from '../lib/store';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function LeftSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    conversations,
    activeId,
    select,
    create,
    delete: deleteConv,
    search,
    fetchConversations
  } = useConversationStore();
  const { openSettings, openCommandPalette } = useUIStore();

  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('atlas-left-sidebar-width');
    return saved ? parseInt(saved, 10) : 260;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [researchExpanded, setResearchExpanded] = useState(true);

  React.useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    localStorage.setItem('atlas-left-sidebar-width', width.toString());
  }, [width]);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = mouseMoveEvent.clientX;
        if (newWidth >= 200 && newWidth <= 480) {
          setWidth(newWidth);
        }
      }
    },
    [isResizing]
  );

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  const handleNewConversation = async () => {
    const id = await create();
    navigate(`/chat/${id}`);
  };

  const handleSelect = (id: string) => {
    select(id);
    navigate(`/chat/${id}`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('确定要删除这个对话吗？')) {
      await deleteConv(id);
      if (activeId === id) {
        navigate('/');
      }
    }
  };

  return (
    <aside
      className="bg-gray-50 dark:bg-dark-secondary flex flex-col border-r border-subtle relative flex-shrink-0"
      style={{ width: width }}
    >
      {/* Resizer Handle */}
      <div
        className={cn(
          "absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent-primary/50 transition-colors z-50",
          isResizing && "bg-accent-primary"
        )}
        onMouseDown={startResizing}
      />

      {/* Header with Global Search and Navigation */}
      <div className="p-4 space-y-3">
        {/* Global Search Button */}
        <button
          onClick={openCommandPalette}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-dark-tertiary text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-hover hover:text-gray-900 dark:hover:text-white text-sm transition-all"
        >
          <Search className="w-4 h-4" />
          <span className="flex-1 text-left">搜索文档、笔记...</span>
          <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-dark-primary text-xs text-gray-400 dark:text-gray-500">⌘K</kbd>
        </button>

        {/* Navigation Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg transition-all font-medium text-sm",
              location.pathname === '/' || location.pathname.startsWith('/document')
                ? "bg-accent-primary/10 text-accent-primary"
                : "bg-gray-100 dark:bg-dark-tertiary text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-hover"
            )}
          >
            <FolderOpen className="w-4 h-4" />
            文档库
          </button>
          <button
            onClick={handleNewConversation}
            className="flex-1 flex items-center justify-center gap-2 bg-accent-primary hover:bg-accent-secondary text-white py-2 rounded-lg transition-all font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            新建
          </button>
        </div>
      </div>

      {/* 研究助手导航 */}
      <div className="px-4 pb-2">
        <button
          onClick={() => setResearchExpanded(!researchExpanded)}
          className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-300"
        >
          <span className="flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5" />
            研究助手
          </span>
          {researchExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        
        {researchExpanded && (
          <div className="mt-1 space-y-0.5">
            <NavItem 
              icon={<Brain className="w-4 h-4" />} 
              label="洞察概览" 
              path="/research"
              active={location.pathname === '/research'}
              onClick={() => navigate('/research')}
            />
            <NavItem 
              icon={<Layers className="w-4 h-4" />} 
              label="主题聚类" 
              path="/clusters"
              active={location.pathname === '/clusters'}
              onClick={() => navigate('/clusters')}
            />
            <NavItem 
              icon={<TrendingUp className="w-4 h-4" />} 
              label="趋势分析" 
              path="/trends"
              active={location.pathname === '/trends'}
              onClick={() => navigate('/trends')}
            />
            <NavItem 
              icon={<FileText className="w-4 h-4" />} 
              label="研究报告" 
              path="/reports"
              active={location.pathname === '/reports'}
              onClick={() => navigate('/reports')}
            />
            <NavItem 
              icon={<AlertCircle className="w-4 h-4" />} 
              label="知识空白" 
              path="/gaps"
              active={location.pathname === '/gaps'}
              onClick={() => navigate('/gaps')}
            />
            <NavItem 
              icon={<Network className="w-4 h-4" />} 
              label="知识图谱" 
              path="/graph"
              active={location.pathname === '/graph'}
              onClick={() => navigate('/graph')}
            />
          </div>
        )}
      </div>

      {/* Conversation Filter */}
      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder="筛选对话..."
            className="w-full bg-gray-100 dark:bg-dark-tertiary text-xs text-gray-900 dark:text-gray-200 pl-8 pr-3 py-1.5 rounded-md border border-transparent focus:border-accent-primary focus:outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600"
            onChange={(e) => search(e.target.value)}
          />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => handleSelect(conv.id)}
              className={cn(
                "group flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-all",
                activeId === conv.id
                  ? "bg-gray-200 dark:bg-dark-hover text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-elevated hover:text-gray-900 dark:hover:text-gray-200"
              )}
            >
              <MessageSquare className={cn("w-4 h-4 shrink-0", activeId === conv.id ? "text-accent-primary" : "text-gray-400 dark:text-gray-500")} />

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{conv.title}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-600 truncate mt-0.5">
                  {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true, locale: zhCN })}
                </div>
              </div>

              <button
                onClick={(e) => handleDelete(e, conv.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-500/20 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Footer: Settings */}
      <div className="p-4 border-t border-subtle">
        <button
          onClick={openSettings}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors text-sm w-full"
        >
          <Settings className="w-4 h-4" />
          设置
        </button>
      </div>
    </aside>
  );
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  path: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all",
        active
          ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-hover hover:text-gray-900 dark:hover:text-gray-200"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
