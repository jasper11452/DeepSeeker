
import { useCopilotStore } from '../../stores/copilotStore';
import { FileText, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';

export function ChunkDetailPanel() {
    const navigate = useNavigate();
    const { activeChunkDetail, isLoadingChunk } = useCopilotStore();

    if (isLoadingChunk) {
        return (
            <div className="flex items-center justify-center h-48">
                <Loader2 className="w-6 h-6 text-accent-primary animate-spin" />
            </div>
        );
    }

    if (!activeChunkDetail) {
        return null;
    }

    const { content, prev_chunk, next_chunk, filename, title, chunk_index, document_id } = activeChunkDetail;

    return (
        <div className="p-4 space-y-4">
            {/* 文档来源标题 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-accent-primary/10 dark:bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-accent-primary" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {title || filename}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            分块 #{chunk_index + 1}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => navigate(`/document/${document_id}`)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-hover text-gray-500 dark:text-gray-400 hover:text-accent-primary transition-all"
                    title="查看完整文档"
                >
                    <ExternalLink className="w-4 h-4" />
                </button>
            </div>

            {/* 上文（如有） */}
            {prev_chunk && (
                <div className="relative">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 mb-2">
                        <ChevronLeft className="w-3 h-3" />
                        <span>上文</span>
                    </div>
                    <div className="p-3 bg-gray-50 dark:bg-dark-tertiary rounded-lg border border-gray-200/50 dark:border-subtle/50">
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-4">
                            {prev_chunk}
                        </p>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50 dark:from-dark-tertiary to-transparent rounded-b-lg pointer-events-none" />
                </div>
            )}

            {/* 主要内容 */}
            <div className="relative">
                <div className="flex items-center gap-1.5 text-xs text-accent-primary mb-2 font-medium">
                    <span className="w-2 h-2 rounded-full bg-accent-primary animate-pulse" />
                    <span>引用片段</span>
                </div>
                <div className={cn(
                    "p-4 rounded-xl border-2 border-accent-primary/30 dark:border-accent-primary/40",
                    "bg-gradient-to-br from-accent-primary/5 to-emerald-500/5",
                    "dark:from-accent-primary/10 dark:to-emerald-500/10"
                )}>
                    <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                        {content}
                    </p>
                </div>
            </div>

            {/* 下文（如有） */}
            {next_chunk && (
                <div className="relative">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 mb-2">
                        <span>下文</span>
                        <ChevronRight className="w-3 h-3" />
                    </div>
                    <div className="p-3 bg-gray-50 dark:bg-dark-tertiary rounded-lg border border-gray-200/50 dark:border-subtle/50">
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-4">
                            {next_chunk}
                        </p>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50 dark:from-dark-tertiary to-transparent rounded-b-lg pointer-events-none" />
                </div>
            )}

            {/* 操作提示 */}
            <div className="pt-2 border-t border-subtle">
                <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
                    点击右上角图标查看完整文档
                </p>
            </div>
        </div>
    );
}
