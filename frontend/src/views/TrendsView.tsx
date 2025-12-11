import { useState, useEffect } from 'react';
import { 
  TrendingUp, TrendingDown, Minus, RefreshCw,
  Calendar, BarChart3, Flame, Sparkles, Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrendItem {
  topic: string;
  direction: 'rising' | 'stable' | 'declining';
  change_rate: number;
  document_count: number;
  timeline: { date: string; count: number }[];
}

interface TrendsData {
  time_range: string;
  total_documents: number;
  trends: TrendItem[];
  hot_topics: string[];
  emerging_topics: string[];
  declining_topics: string[];
}

interface HeatmapData {
  time_range: string;
  data: { date: string; count: number }[];
  stats: {
    total_days: number;
    total_documents: number;
    max_daily: number;
    avg_daily: number;
    active_days: number;
  };
}

export function TrendsView() {
  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'quarter' | 'year'>('month');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [trendsRes, heatmapRes] = await Promise.all([
        fetch(`/api/research/trends?time_range=${timeRange}`),
        fetch(`/api/research/trends/heatmap?time_range=${timeRange}`)
      ]);
      
      if (!trendsRes.ok || !heatmapRes.ok) {
        throw new Error('获取趋势数据失败');
      }
      
      const trends = await trendsRes.json();
      const heatmap = await heatmapRes.json();
      
      setTrendsData(trends);
      setHeatmapData(heatmap);
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [timeRange]);

  const timeRangeLabels = {
    week: '最近一周',
    month: '最近一月',
    quarter: '最近三月',
    year: '最近一年'
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-gray-500 dark:text-gray-400">正在分析趋势...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-500">{error}</p>
          <button 
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-green-500" />
            趋势分析
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            追踪你关注领域的变化趋势
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* 时间范围选择 */}
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {(['week', 'month', 'quarter', 'year'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  timeRange === range
                    ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                )}
              >
                {timeRangeLabels[range]}
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
        </div>
      </div>

      {/* 活动概览 */}
      {heatmapData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<Calendar className="w-5 h-5" />}
            label="活跃天数"
            value={heatmapData.stats.active_days}
            subtext={`共 ${heatmapData.stats.total_days} 天`}
          />
          <StatCard
            icon={<BarChart3 className="w-5 h-5" />}
            label="总文档数"
            value={heatmapData.stats.total_documents}
          />
          <StatCard
            icon={<Flame className="w-5 h-5" />}
            label="单日最高"
            value={heatmapData.stats.max_daily}
            subtext="篇文档"
          />
          <StatCard
            icon={<Clock className="w-5 h-5" />}
            label="日均添加"
            value={heatmapData.stats.avg_daily.toFixed(1)}
            subtext="篇文档"
          />
        </div>
      )}

      {/* 主题分类 */}
      {trendsData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 热门主题 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <Flame className="w-5 h-5 text-orange-500" />
              热门主题
            </h3>
            <div className="space-y-2">
              {trendsData.hot_topics.length > 0 ? (
                trendsData.hot_topics.map((topic, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedTopic(topic)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-lg transition-colors',
                      selectedTopic === topic
                        ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                        : 'bg-gray-50 dark:bg-gray-750 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                  >
                    <span className="font-medium">{topic}</span>
                  </button>
                ))
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-sm">暂无数据</p>
              )}
            </div>
          </div>

          {/* 新兴主题 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-green-500" />
              新兴主题
            </h3>
            <div className="space-y-2">
              {trendsData.emerging_topics.length > 0 ? (
                trendsData.emerging_topics.map((topic, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedTopic(topic)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors',
                      selectedTopic === topic
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : 'bg-gray-50 dark:bg-gray-750 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                  >
                    <span className="font-medium">{topic}</span>
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  </button>
                ))
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-sm">暂无数据</p>
              )}
            </div>
          </div>

          {/* 下降主题 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <TrendingDown className="w-5 h-5 text-red-500" />
              关注下降
            </h3>
            <div className="space-y-2">
              {trendsData.declining_topics.length > 0 ? (
                trendsData.declining_topics.map((topic, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedTopic(topic)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors',
                      selectedTopic === topic
                        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                        : 'bg-gray-50 dark:bg-gray-750 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                  >
                    <span className="font-medium">{topic}</span>
                    <TrendingDown className="w-4 h-4 text-red-500" />
                  </button>
                ))
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-sm">暂无数据</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 趋势详情列表 */}
      {trendsData && trendsData.trends.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              主题趋势详情
            </h3>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {trendsData.trends.slice(0, 15).map((trend, i) => (
              <TrendRow key={i} trend={trend} />
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {trendsData && trendsData.trends.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>暂无趋势数据</p>
          <p className="text-sm mt-1">添加更多文档以分析主题趋势</p>
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  subtext?: string;
}

function StatCard({ icon, label, value, subtext }: StatCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-2">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      {subtext && <p className="text-sm text-gray-500 dark:text-gray-400">{subtext}</p>}
    </div>
  );
}

interface TrendRowProps {
  trend: TrendItem;
}

function TrendRow({ trend }: TrendRowProps) {
  const directionConfig = {
    rising: {
      icon: <TrendingUp className="w-4 h-4" />,
      color: 'text-green-500',
      bg: 'bg-green-100 dark:bg-green-900/30',
      label: '上升'
    },
    stable: {
      icon: <Minus className="w-4 h-4" />,
      color: 'text-gray-500',
      bg: 'bg-gray-100 dark:bg-gray-700',
      label: '稳定'
    },
    declining: {
      icon: <TrendingDown className="w-4 h-4" />,
      color: 'text-red-500',
      bg: 'bg-red-100 dark:bg-red-900/30',
      label: '下降'
    }
  };

  const config = directionConfig[trend.direction];
  const changePercent = Math.abs(trend.change_rate * 100).toFixed(0);

  return (
    <div className="px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750">
      <div className="flex items-center gap-4">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', config.bg, config.color)}>
          {config.icon}
        </div>
        <div>
          <p className="font-medium text-gray-900 dark:text-white">{trend.topic}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {trend.document_count} 篇相关文档
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className={cn('font-medium', config.color)}>
          {trend.direction === 'rising' ? '+' : trend.direction === 'declining' ? '-' : ''}{changePercent}%
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{config.label}</p>
      </div>
    </div>
  );
}

export default TrendsView;
