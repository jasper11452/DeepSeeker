import React from 'react';
import { useNavigate } from 'react-router-dom';
import { DocumentSource } from '../../types/conversation';
import { useConversationStore } from '../../stores/conversationStore';
import { useConversation } from '../../hooks/useConversation';
import { FileText } from 'lucide-react';

export function ChatSourcesPanel() {
  const navigate = useNavigate();
  const activeId = useConversationStore(state => state.activeId);
  const { data: conversation } = useConversation(activeId || undefined);

  // Extract unique sources from all messages
  const sources = React.useMemo(() => {
    if (!conversation?.messages) return [];
    const allSources: DocumentSource[] = [];
    conversation.messages.forEach(msg => {
      if (msg.sources) {
        allSources.push(...msg.sources);
      }
    });
    // Deduplicate by chunk_id
    const unique = new Map();
    allSources.forEach(s => unique.set(s.chunk_id, s));
    return Array.from(unique.values());
  }, [conversation]);

  if (!sources.length) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        暂无引用文档
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">涉及的文档片段</h3>
      <div className="space-y-3">
        {sources.map((source) => (
          <div 
            key={source.chunk_id}
            onClick={() => navigate(`/document/${source.document_id}`)}
            className="group cursor-pointer bg-white dark:bg-dark-elevated border border-gray-200 dark:border-subtle rounded-lg p-3 hover:border-accent-primary/50 dark:hover:border-accent-primary/50 transition-all shadow-sm dark:shadow-none"
          >
            <div className="flex items-center gap-2 mb-2 text-accent-primary">
              <FileText className="w-3 h-3" />
              <span className="text-xs font-medium truncate">{source.filename}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed group-hover:text-gray-900 dark:group-hover:text-gray-300">
              {source.preview}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-gray-400 dark:text-gray-600">相关度: {(source.score * 100).toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-600 text-center mt-4">
        点击卡片跳转至文档详情
      </p>
    </div>
  );
}
