import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface PerformanceStats {
  total_collections: number;
  total_documents: number;
  total_chunks: number;
  database_size_mb: number;
  index_size_mb: number;
  avg_search_time_ms: number;
  recent_searches: SearchStats[];
  memory_usage_mb?: number;
}

interface SearchStats {
  query: string;
  results_count: number;
  time_ms: number;
  timestamp: string;
}

export function PerformanceMonitor() {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadStats();
      const interval = setInterval(loadStats, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const data = await invoke<PerformanceStats>('get_performance_stats');
      setStats(data);
    } catch (error) {
      console.error('Failed to load performance stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 left-4 px-4 py-2 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/50 rounded-lg shadow-lg backdrop-blur-sm transition-colors flex items-center gap-2 z-40"
        title="性能监控"
      >
        <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        <span className="text-xs text-slate-400">性能</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">性能监控</h2>
              <p className="text-xs text-slate-400">实时系统性能指标</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                isLoading ? 'bg-yellow-500/10 text-yellow-400' : 'bg-green-500/10 text-green-400'
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`} />
              <span className="text-xs font-medium">{isLoading ? '刷新中' : '实时'}</span>
            </div>

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
          {stats ? (
            <div className="space-y-6">
              {/* Database Stats */}
              <div>
                <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-3">数据库统计</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    label="集合数"
                    value={stats.total_collections}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                        />
                      </svg>
                    }
                  />
                  <StatCard
                    label="文档数"
                    value={stats.total_documents.toLocaleString()}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    }
                  />
                  <StatCard
                    label="索引块数"
                    value={stats.total_chunks.toLocaleString()}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                        />
                      </svg>
                    }
                  />
                  <StatCard
                    label="数据库大小"
                    value={`${stats.database_size_mb.toFixed(2)} MB`}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                        />
                      </svg>
                    }
                  />
                </div>
              </div>

              {/* Search Performance */}
              <div>
                <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-3">搜索性能</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatCard
                    label="平均搜索时间"
                    value={`${stats.avg_search_time_ms.toFixed(0)} ms`}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                    }
                    trend={stats.avg_search_time_ms < 100 ? 'good' : stats.avg_search_time_ms < 500 ? 'ok' : 'slow'}
                  />
                  <StatCard
                    label="索引大小"
                    value={`${stats.index_size_mb.toFixed(2)} MB`}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                        />
                      </svg>
                    }
                  />
                  {stats.memory_usage_mb && (
                    <StatCard
                      label="内存使用"
                      value={`${stats.memory_usage_mb.toFixed(0)} MB`}
                      icon={
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                          />
                        </svg>
                      }
                    />
                  )}
                </div>
              </div>

              {/* Recent Searches */}
              {stats.recent_searches && stats.recent_searches.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-3">
                    最近搜索 (性能)
                  </h3>
                  <div className="bg-slate-950/50 rounded-lg border border-slate-800 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-800/50">
                          <tr>
                            <th className="text-left px-4 py-3 text-slate-400 font-medium">查询</th>
                            <th className="text-right px-4 py-3 text-slate-400 font-medium">结果数</th>
                            <th className="text-right px-4 py-3 text-slate-400 font-medium">耗时</th>
                            <th className="text-right px-4 py-3 text-slate-400 font-medium">时间</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {stats.recent_searches.map((search, index) => (
                            <tr key={index} className="hover:bg-white/5">
                              <td className="px-4 py-3 text-slate-300 font-mono max-w-xs truncate">
                                {search.query}
                              </td>
                              <td className="px-4 py-3 text-slate-400 text-right">{search.results_count}</td>
                              <td className="px-4 py-3 text-right">
                                <span
                                  className={`px-2 py-1 rounded text-[10px] font-semibold ${
                                    search.time_ms < 100
                                      ? 'bg-green-500/20 text-green-400'
                                      : search.time_ms < 500
                                      ? 'bg-yellow-500/20 text-yellow-400'
                                      : 'bg-red-500/20 text-red-400'
                                  }`}
                                >
                                  {search.time_ms}ms
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-500 text-right font-mono text-[10px]">
                                {new Date(search.timestamp).toLocaleTimeString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="flex items-center gap-3 text-slate-400">
                <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
                <span>加载性能数据中...</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-700/50 bg-slate-800/30">
          <p className="text-xs text-slate-500 text-center">
            数据每 5 秒自动刷新 • 基于 SQLite + sqlite-vec 优化
          </p>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: 'good' | 'ok' | 'slow';
}

function StatCard({ label, value, icon, trend }: StatCardProps) {
  const trendColors = {
    good: 'border-green-500/20 bg-green-500/5',
    ok: 'border-yellow-500/20 bg-yellow-500/5',
    slow: 'border-red-500/20 bg-red-500/5',
  };

  return (
    <div
      className={`p-4 rounded-lg border transition-all ${
        trend ? trendColors[trend] : 'border-white/5 bg-white/5 hover:bg-white/10'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="text-slate-400">{icon}</div>
        {trend && (
          <div
            className={`w-2 h-2 rounded-full ${
              trend === 'good' ? 'bg-green-400' : trend === 'ok' ? 'bg-yellow-400' : 'bg-red-400'
            }`}
          />
        )}
      </div>
      <p className="text-2xl font-bold text-white mb-1">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
