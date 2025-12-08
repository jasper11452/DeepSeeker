import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsApi, insightsApi } from '../../lib/api';
import { HelpCircle, Sparkles, RefreshCw, Loader2, Tag, BookOpen, MessageCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useNavigate } from 'react-router-dom';
import { useConversationStore } from '../../stores/conversationStore';

interface DocumentInsightsPanelProps {
  documentId: number;
}

export function DocumentInsightsPanel({ documentId }: DocumentInsightsPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createConversation = useConversationStore(state => state.create);

  // 获取文档基本信息
  const { data: document } = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => documentsApi.get(documentId),
    enabled: !!documentId,
  });

  // 获取 AI 洞察
  const { data: insights, isLoading: isLoadingInsights } = useQuery({
    queryKey: ['insights', documentId],
    queryFn: () => insightsApi.getDocumentInsights(documentId),
    enabled: !!documentId,
  });

  // 刷新洞察
  const refreshMutation = useMutation({
    mutationFn: () => insightsApi.refreshDocumentInsights(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insights', documentId] });
    },
  });

  // 点击相关问题时创建新对话并自动发送问题
  const handleQuestionClick = useCallback(async (question: string) => {
    try {
      const newId = await createConversation();
      // 导航到对话页面，并通过URL参数传递要自动发送的问题
      navigate(`/chat/${newId}?autoSend=${encodeURIComponent(question)}`);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  }, [createConversation, navigate]);

  if (!document) return null;

  // 使用API返回的推荐问题，如果没有则使用默认问题
  const suggestedQuestions = (insights && insights.suggested_questions && insights.suggested_questions.length > 0)
    ? insights.suggested_questions
    : [
      `"${document.title || document.filename}" 这篇文档主要讲了什么？`,
      `${document.title || document.filename} 有哪些关键结论？`,
      `这篇文档适合什么场景使用？`,
    ];

  return (
    <div className="p-4 space-y-6">
      {/* AI 摘要 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent-primary" />
            AI 摘要
          </h3>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || isLoadingInsights}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-hover text-gray-400 dark:text-gray-500 transition-all disabled:opacity-50"
            title="重新生成"
          >
            {refreshMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {isLoadingInsights ? (
          <div className="flex items-center justify-center py-8 bg-gray-50 dark:bg-dark-tertiary rounded-xl">
            <Loader2 className="w-5 h-5 text-accent-primary animate-spin" />
          </div>
        ) : (
          <div className={cn(
            "p-4 rounded-xl border",
            "bg-gradient-to-br from-accent-primary/5 to-emerald-500/5",
            "dark:from-accent-primary/10 dark:to-emerald-500/10",
            "border-accent-primary/20 dark:border-accent-primary/30"
          )}>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {insights?.summary || "正在生成摘要..."}
            </p>
            {insights?.is_cached && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                已缓存 • 点击刷新按钮重新生成
              </p>
            )}
          </div>
        )}
      </div>

      {/* 关键词 */}
      {insights?.keywords && insights.keywords.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2 mb-3">
            <Tag className="w-4 h-4 text-purple-500" />
            关键概念
          </h3>
          <div className="flex flex-wrap gap-2">
            {insights.keywords.map((keyword, idx) => (
              <span
                key={idx}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium",
                  "bg-purple-50 dark:bg-purple-900/30",
                  "text-purple-600 dark:text-purple-400",
                  "border border-purple-200/50 dark:border-purple-700/30"
                )}
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 相关问题 */}
      <div>
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2 mb-3">
          <MessageCircle className="w-4 h-4 text-blue-500" />
          推荐问题
        </h3>
        <ul className="space-y-2">
          {suggestedQuestions.map((q, i) => (
            <li
              key={i}
              onClick={() => handleQuestionClick(q)}
              className={cn(
                "text-sm p-3 rounded-xl cursor-pointer transition-all",
                "bg-blue-50 dark:bg-blue-900/20",
                "hover:bg-blue-100 dark:hover:bg-blue-900/30",
                "text-blue-600 dark:text-blue-400",
                "border border-blue-200/50 dark:border-blue-700/30",
                "hover:border-blue-300 dark:hover:border-blue-600/50"
              )}
            >
              <span className="flex items-center gap-2">
                <HelpCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="line-clamp-2">{q}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 文档统计 */}
      <div className={cn(
        "p-3 rounded-xl",
        "bg-gray-50 dark:bg-dark-tertiary",
        "border border-gray-200/50 dark:border-subtle/50"
      )}>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">文档信息</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <div>类型: <span className="text-gray-700 dark:text-gray-300">{document.file_type.toUpperCase()}</span></div>
          <div>分块: <span className="text-gray-700 dark:text-gray-300">{document.chunk_count}</span></div>
        </div>
      </div>
    </div>
  );
}
