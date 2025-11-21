import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface ChunkMetadata {
  headers: string[];
  chunk_type: string;
  language?: string;
}

interface ChunkData {
  chunk_id: number;
  doc_id: number;
  document_path: string;
  document_status: string;
  content: string;
  metadata: ChunkMetadata | null;
  score: number;
  start_line: number;
  end_line: number;
}

interface Props {
  docId: number;
  startLine: number;
  targetChunkId: number;
  documentPath: string;
  onClose: () => void;
  onOpenFile: (filePath: string, line: number) => void;
}

export default function ChunkPreviewPanel({
  docId,
  startLine,
  targetChunkId,
  documentPath,
  onClose,
  onOpenFile,
}: Props) {
  const [chunks, setChunks] = useState<ChunkData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchContext = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await invoke<ChunkData[]>("get_chunk_context", {
          docId,
          startLine,
          contextSize: 5,
        });
        setChunks(result);
      } catch (err) {
        console.error("Failed to fetch chunk context:", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    };

    fetchContext();
  }, [docId, startLine]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl border border-white/10 shadow-2xl max-w-5xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold text-white">文档预览</h3>
            <span className="text-xs text-slate-400 font-mono">{documentPath}</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white"
            aria-label="Close preview"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <p className="text-slate-400">加载上下文中...</p>
            </div>
          )}

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-rose-400">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>加载失败: {error}</span>
              </div>
            </div>
          )}

          {!isLoading && !error && chunks.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-400">没有找到相关内容</p>
            </div>
          )}

          {!isLoading && !error && chunks.length > 0 && (
            <div className="space-y-4">
              {chunks.map((chunk) => {
                const isTarget = chunk.chunk_id === targetChunkId;

                return (
                  <div
                    key={chunk.chunk_id}
                    className={`rounded-xl p-4 transition-all ${
                      isTarget
                        ? "bg-indigo-500/20 border-2 border-indigo-500/50 shadow-lg shadow-indigo-900/20"
                        : "bg-white/5 border border-white/10"
                    }`}
                  >
                    {/* Chunk Header */}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        {isTarget && (
                          <span className="px-2 py-0.5 bg-indigo-500/30 text-indigo-300 text-xs font-medium rounded">
                            当前块
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          Lines {chunk.start_line}-{chunk.end_line}
                        </span>
                        {chunk.metadata?.chunk_type && (
                          <span className="text-[10px] text-slate-500 uppercase">
                            {chunk.metadata.chunk_type}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Chunk Metadata */}
                    {chunk.metadata?.headers && chunk.metadata.headers.length > 0 && (
                      <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                        <span>{chunk.metadata.headers.join(" > ")}</span>
                      </div>
                    )}

                    {/* Chunk Content */}
                    <div className="relative">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500/50 rounded-full"></div>
                      {chunk.metadata?.language ? (
                        <div className="pl-4 text-sm overflow-x-auto rounded-lg">
                          <div className="absolute right-0 top-0 text-[10px] text-slate-500 bg-black/30 px-1.5 py-0.5 rounded z-10">
                            {chunk.metadata.language}
                          </div>
                          <SyntaxHighlighter
                            language={chunk.metadata.language}
                            style={vscDarkPlus}
                            customStyle={{ background: 'transparent', padding: 0, margin: 0 }}
                            wrapLines={true}
                          >
                            {chunk.content}
                          </SyntaxHighlighter>
                        </div>
                      ) : (
                        <pre className="pl-4 text-sm text-slate-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                          {chunk.content}
                        </pre>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center">
          <div className="text-xs text-slate-500">
            显示 {chunks.length} 个代码块
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium rounded-lg border border-white/10 transition-all"
            >
              关闭
            </button>
            <button
              onClick={() => onOpenFile(documentPath, startLine)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-indigo-900/20 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              在编辑器中打开
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
