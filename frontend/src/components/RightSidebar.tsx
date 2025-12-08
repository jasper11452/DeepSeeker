import React, { useState, useCallback, useEffect } from 'react';
import { useCurrentViewType } from '../hooks/useCurrentViewType';
import { LibrarySummaryPanel } from './panels/LibrarySummaryPanel';
import { DocumentInsightsPanel } from './panels/DocumentInsightsPanel';
import { ChatCopilotPanel } from './panels/ChatCopilotPanel';
import { ChunkDetailPanel } from './panels/ChunkDetailPanel';
import { useParams } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useCopilotStore } from '../stores/copilotStore';
import { Sparkles, Brain, X } from 'lucide-react';

export function RightSidebar() {
  const viewType = useCurrentViewType();
  const { id } = useParams<{ id: string }>(); // For document ID
  const { activeChunkDetail, clearActiveChunk } = useCopilotStore();

  // Parse document ID if in document view
  const documentId = id ? parseInt(id) : undefined;

  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('atlas-right-sidebar-width');
    return saved ? parseInt(saved, 10) : 320;
  });
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    localStorage.setItem('atlas-right-sidebar-width', width.toString());
  }, [width]);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        // Calculate new width: Window Width - Mouse X
        const newWidth = document.body.clientWidth - mouseMoveEvent.clientX;
        if (newWidth >= 280 && newWidth <= 600) { // Min 280, Max 600
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


  return (
    <aside
      className="border-l border-subtle bg-gradient-to-b from-gray-50 to-white dark:from-dark-secondary dark:to-dark-primary flex flex-col relative flex-shrink-0"
      style={{ width: width }}
    >
      {/* Resizer Handle */}
      <div
        className={cn(
          "absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent-primary/50 transition-colors z-50",
          isResizing && "bg-accent-primary"
        )}
        onMouseDown={startResizing}
      />

      {/* Header */}
      <header className="h-14 px-4 border-b border-subtle flex items-center justify-between flex-shrink-0 bg-white/50 dark:bg-dark-secondary/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-accent-primary to-emerald-500 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            智能副驾
          </span>
          <Sparkles className="w-3 h-3 text-accent-primary animate-pulse" />
        </div>

        {/* 当显示 chunk 详情时，显示关闭按钮 */}
        {activeChunkDetail && (
          <button
            onClick={clearActiveChunk}
            className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-dark-hover text-gray-500 dark:text-gray-400 transition-all"
            title="关闭详情"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </header>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {/* 优先显示 chunk 详情（点击引用链接时） */}
        {activeChunkDetail ? (
          <ChunkDetailPanel />
        ) : (
          <>
            {viewType === 'library' && <LibrarySummaryPanel />}
            {viewType === 'document' && documentId && <DocumentInsightsPanel documentId={documentId} />}
            {viewType === 'chat' && <ChatCopilotPanel />}
          </>
        )}
      </div>
    </aside>
  );
}