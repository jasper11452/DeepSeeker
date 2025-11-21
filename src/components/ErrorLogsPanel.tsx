import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function ErrorLogsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen]);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const logContent = await invoke<string>('get_error_logs');
      setLogs(logContent);
    } catch (error) {
      console.error('Failed to load error logs:', error);
      setLogs(`加载错误日志失败: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const clearLogs = async () => {
    if (!confirm('确定要清除所有错误日志吗?')) {
      return;
    }

    try {
      await invoke('clear_error_logs');
      setLogs('');
      alert('错误日志已清除');
    } catch (error) {
      console.error('Failed to clear logs:', error);
      alert(`清除日志失败: ${error}`);
    }
  };

  const downloadLogs = () => {
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepseeker-errors-${new Date().toISOString().split('T')[0]}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 px-4 py-2 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/50 rounded-lg shadow-lg backdrop-blur-sm transition-colors flex items-center gap-2 z-40"
        title="查看错误日志"
      >
        <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <span className="text-xs text-slate-400">日志</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">错误日志</h2>
              <p className="text-xs text-slate-400">应用程序错误和异常记录</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadLogs}
              disabled={isLoading}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
              title="刷新"
            >
              <svg
                className={`w-4 h-4 text-slate-400 ${isLoading ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>

            {logs && (
              <>
                <button
                  onClick={downloadLogs}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                  title="下载日志"
                >
                  <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                </button>

                <button
                  onClick={clearLogs}
                  className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors"
                  title="清除日志"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </>
            )}

            <button
              onClick={() => setIsOpen(false)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex items-center gap-3 text-slate-400">
                <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
                <span>加载日志中...</span>
              </div>
            </div>
          ) : logs ? (
            <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap bg-slate-950/50 p-4 rounded-lg border border-slate-800">
              {logs}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">无错误日志</h3>
              <p className="text-sm text-slate-400">应用程序运行正常，暂无错误记录。</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-700/50 bg-slate-800/30">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>日志文件位置: ~/.local/share/deepseeker/logs/errors.log</span>
            <span>{logs ? `${logs.split('\n').length} 行` : '空'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
