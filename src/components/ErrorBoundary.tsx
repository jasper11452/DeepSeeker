import React, { Component, ErrorInfo, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // Log error to backend
    this.logError(error, errorInfo);
  }

  private async logError(error: Error, errorInfo: ErrorInfo) {
    try {
      await invoke('log_error', {
        error: {
          message: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('Failed to log error to backend:', err);
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-8">
          <div className="max-w-2xl w-full bg-slate-800/50 backdrop-blur-xl border border-red-500/30 rounded-2xl p-8 shadow-2xl">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-white mb-2">应用程序出错了</h2>
                <p className="text-slate-300 text-sm">
                  抱歉，应用程序遇到了意外错误。错误详情已被记录。
                </p>
              </div>
            </div>

            <div className="bg-slate-900/50 rounded-lg p-4 mb-6 border border-slate-700/50">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-red-400 mb-1">错误信息:</h3>
                <p className="text-xs text-slate-300 font-mono break-all">
                  {this.state.error?.message || '未知错误'}
                </p>
              </div>

              {this.state.error?.stack && (
                <details className="mt-3">
                  <summary className="text-xs font-semibold text-slate-400 cursor-pointer hover:text-slate-300 mb-2">
                    查看堆栈跟踪
                  </summary>
                  <pre className="text-[10px] text-slate-400 overflow-auto max-h-48 bg-slate-950/50 p-3 rounded border border-slate-800">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={this.handleReload}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors"
              >
                重新加载应用
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                尝试恢复
              </button>
            </div>

            <p className="text-xs text-slate-500 mt-4 text-center">
              如果问题持续出现,请联系技术支持并提供上述错误信息
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
