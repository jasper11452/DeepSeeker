import React, { useCallback } from 'react';

import { DocumentSource } from '../../types/conversation';
import { useConversationStore } from '../../stores/conversationStore';
import { useCopilotStore } from '../../stores/copilotStore';
import { useConversation } from '../../hooks/useConversation';
import { insightsApi, RelevantChunk } from '../../lib/api';
import { FileText, Loader2, Sparkles, Search, Lightbulb, BookOpen } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ClickableSourceProps {
    source: DocumentSource;
    onClick: () => void;
}

function ClickableSource({ source, onClick }: ClickableSourceProps) {
    return (
        <div
            onClick={onClick}
            className="group cursor-pointer bg-white dark:bg-dark-elevated border border-gray-200 dark:border-subtle rounded-xl p-3 hover:border-accent-primary/50 dark:hover:border-accent-primary/50 transition-all shadow-sm dark:shadow-none hover:shadow-md dark:hover:shadow-none"
        >
            <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-lg bg-accent-primary/10 dark:bg-accent-primary/20 flex items-center justify-center">
                    <FileText className="w-3 h-3 text-accent-primary" />
                </div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1">
                    {source.filename}
                </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                {source.preview}
            </p>
            <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-gray-400 dark:text-gray-600 bg-gray-100 dark:bg-dark-tertiary px-1.5 py-0.5 rounded">
                    相关度: {(source.score * 100).toFixed(0)}%
                </span>
                <span className="text-[10px] text-accent-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    点击查看详情 →
                </span>
            </div>
        </div>
    );
}

interface RecommendationCardProps {
    chunk: RelevantChunk;
    onClick: () => void;
}

function RecommendationCard({ chunk, onClick }: RecommendationCardProps) {
    return (
        <div
            onClick={onClick}
            className="group cursor-pointer bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200/50 dark:border-amber-700/30 rounded-xl p-3 hover:border-amber-400/50 dark:hover:border-amber-500/50 transition-all"
        >
            <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400 truncate flex-1">
                    {chunk.filename}
                </span>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">
                {chunk.preview}
            </p>
        </div>
    );
}

export function ChatCopilotPanel() {
    const activeId = useConversationStore(state => state.activeId);
    const { data: conversation } = useConversation(activeId || undefined);
    const {
        recommendations,
        isLoadingRecommendations,
        currentQuery,
        setActiveChunkDetail,
        setLoadingChunk
    } = useCopilotStore();

    // 点击引用时加载 chunk 详情
    const handleSourceClick = useCallback(async (source: DocumentSource) => {
        setLoadingChunk(true);
        try {
            const detail = await insightsApi.getChunkDetail(source.chunk_id);
            setActiveChunkDetail(detail);
        } catch (error) {
            console.error('Failed to load chunk detail:', error);
        } finally {
            setLoadingChunk(false);
        }
    }, [setActiveChunkDetail, setLoadingChunk]);

    // 点击推荐时加载详情
    const handleRecommendationClick = useCallback(async (chunk: RelevantChunk) => {
        setLoadingChunk(true);
        try {
            const detail = await insightsApi.getChunkDetail(chunk.chunk_id);
            setActiveChunkDetail(detail);
        } catch (error) {
            console.error('Failed to load chunk detail:', error);
        } finally {
            setLoadingChunk(false);
        }
    }, [setActiveChunkDetail, setLoadingChunk]);

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

    return (
        <div className="p-4 space-y-6">
            {/* 实时推荐区域 */}
            {currentQuery && (
                <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
                        <Search className="w-4 h-4 text-amber-500" />
                        <span>为你推荐</span>
                        {isLoadingRecommendations && (
                            <Loader2 className="w-3 h-3 animate-spin text-amber-500 ml-auto" />
                        )}
                    </h3>

                    {recommendations.length > 0 ? (
                        <div className="space-y-2">
                            {recommendations.map((chunk) => (
                                <RecommendationCard
                                    key={chunk.chunk_id}
                                    chunk={chunk}
                                    onClick={() => handleRecommendationClick(chunk)}
                                />
                            ))}
                        </div>
                    ) : !isLoadingRecommendations ? (
                        <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-4 bg-gray-50 dark:bg-dark-tertiary rounded-lg">
                            暂无相关推荐
                        </div>
                    ) : null}
                </div>
            )}

            {/* 引用文档区域 */}
            <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-accent-primary" />
                    <span>引用来源</span>
                    {sources.length > 0 && (
                        <span className="ml-auto text-xs bg-accent-primary/10 text-accent-primary px-1.5 py-0.5 rounded">
                            {sources.length}
                        </span>
                    )}
                </h3>

                {sources.length > 0 ? (
                    <div className="space-y-3">
                        {sources.map((source) => (
                            <ClickableSource
                                key={source.chunk_id}
                                source={source}
                                onClick={() => handleSourceClick(source)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-8 bg-gray-50 dark:bg-dark-tertiary rounded-xl border border-dashed border-gray-200 dark:border-subtle">
                        <Sparkles className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-400 dark:text-gray-500">
                            开始对话后，引用的文档将在这里显示
                        </p>
                    </div>
                )}
            </div>

            {/* 帮助提示 */}
            <div className={cn(
                "p-3 rounded-xl border",
                "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20",
                "border-blue-200/50 dark:border-blue-700/30"
            )}>
                <p className="text-[11px] text-blue-600 dark:text-blue-400 leading-relaxed">
                    💡 <strong>提示：</strong>点击引用卡片可在此处查看详细上下文，无需跳转页面。
                </p>
            </div>
        </div>
    );
}
