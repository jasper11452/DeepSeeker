import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface IndexProgress {
  total_files: number;
  processed_files: number;
  current_file: string | null;
  errors: string[];
  status: 'idle' | 'indexing' | 'completed' | 'error';
}

interface Props {
  collectionId: number;
  isIndexing: boolean;
  onComplete?: () => void;
}

export function IndexingProgress({ collectionId, isIndexing, onComplete }: Props) {
  const [progress, setProgress] = useState<IndexProgress>({
    total_files: 0,
    processed_files: 0,
    current_file: null,
    errors: [],
    status: 'idle',
  });

  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!isIndexing) {
      setProgress({
        total_files: 0,
        processed_files: 0,
        current_file: null,
        errors: [],
        status: 'idle',
      });
      return;
    }

    // Poll for progress updates every 500ms
    const interval = setInterval(async () => {
      try {
        const currentProgress = await invoke<IndexProgress>('get_indexing_progress', {
          collection_id: collectionId,
        });

        setProgress(currentProgress);

        // Check if indexing is complete
        if (
          currentProgress.status === 'completed' ||
          (currentProgress.total_files > 0 &&
            currentProgress.processed_files >= currentProgress.total_files)
        ) {
          clearInterval(interval);
          onComplete?.();
        }
      } catch (error) {
        console.error('Failed to fetch indexing progress:', error);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isIndexing, collectionId, onComplete]);

  if (!isIndexing && progress.status === 'idle') {
    return null;
  }

  const percentage =
    progress.total_files > 0
      ? Math.round((progress.processed_files / progress.total_files) * 100)
      : 0;

  return (
    <div className="fixed bottom-4 right-4 bg-slate-900/95 backdrop-blur-xl border border-indigo-500/30 rounded-2xl shadow-2xl max-w-md overflow-hidden z-50">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center">
                {progress.status === 'completed' ? (
                  <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : progress.status === 'error' ? (
                  <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5 text-indigo-400 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                )}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-white">
                {progress.status === 'completed'
                  ? '索引完成'
                  : progress.status === 'error'
                  ? '索引出错'
                  : '正在索引...'}
              </h3>
              <p className="text-xs text-slate-400">
                {progress.processed_files} / {progress.total_files} 文件
              </p>
            </div>
          </div>

          {progress.errors.length > 0 && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="p-1 hover:bg-white/5 rounded transition-colors"
            >
              <svg
                className={`w-4 h-4 text-slate-400 transition-transform ${
                  showDetails ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300 ease-out"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-slate-500">进度</span>
            <span className="text-xs font-mono text-indigo-400">{percentage}%</span>
          </div>
        </div>

        {/* Current file */}
        {progress.current_file && progress.status === 'indexing' && (
          <div className="px-3 py-2 bg-white/5 rounded-lg">
            <p className="text-[10px] text-slate-500 mb-1">当前文件:</p>
            <p className="text-xs text-slate-300 font-mono truncate">
              {progress.current_file.split('/').pop()}
            </p>
          </div>
        )}

        {/* Error details */}
        {showDetails && progress.errors.length > 0 && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg max-h-32 overflow-y-auto">
            <p className="text-xs font-semibold text-red-400 mb-2">
              错误 ({progress.errors.length})
            </p>
            <div className="space-y-1">
              {progress.errors.map((error, index) => (
                <p key={index} className="text-[10px] text-red-300 font-mono">
                  • {error}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Performance stats */}
        {progress.status === 'completed' && (
          <div className="mt-3 pt-3 border-t border-slate-800">
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center">
                <p className="text-xs text-slate-500">总文件数</p>
                <p className="text-lg font-semibold text-white">{progress.total_files}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500">失败数</p>
                <p className="text-lg font-semibold text-red-400">{progress.errors.length}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
