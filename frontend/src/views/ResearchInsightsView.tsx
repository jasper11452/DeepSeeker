import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Brain, TrendingUp, Layers, FileText, AlertCircle, 
  ChevronRight, Sparkles, Target, Lightbulb, RefreshCw 
} from 'lucide-react';
import { cn } from '../lib/utils';

// API 调用
const researchApi = {
  getOverview: async () => {
    const res = await fetch('/api/research/analysis/overview');
    if (!res.ok) throw new Error('Failed to fetch overview');
    return res.json();
  },
  getCoverage: async () => {
    const res = await fetch('/api/research/gaps/coverage');
    if (!res.ok) throw new Error('Failed to fetch coverage');
    return res.json();
  },
  getTrends: async (timeRange: string) => {
    const res = await fetch(`/api/research/trends?time_range=${timeRange}`);
    if (!res.ok) throw new Error('Failed to fetch trends');
    return res.json();
  },
  getClusters: async () => {
    const res = await fetch('/api/research/clusters');
    if (!res.ok) throw new Error('Failed to fetch clusters');
    return res.json();
  },
};

export function ResearchInsightsView() {
  const [activeTab, setActiveTab] = useState<'overview' | 'coverage' | 'trends' | 'clusters'>('overview');

  const { data: overview, isLoading: loadingOverview, refetch: refetchOverview } = useQuery({
    queryKey: ['research-overview'],
    queryFn: researchApi.getOverview,
    staleTime: 5 * 60 * 1000,
  });

  const { data: coverage, isLoading: loadingCoverage } = useQuery({
    queryKey: ['research-coverage'],
    queryFn: researchApi.getCoverage,
    enabled: activeTab === 'coverage',
  });

  const { data: trends, isLoading: loadingTrends } = useQuery({
    queryKey: ['research-trends', 'month'],
    queryFn: () => researchApi.getTrends('month'),
    enabled: activeTab === 'trends',
  });

  const { data: clusters, isLoading: loadingClusters } = useQuery({
    queryKey: ['research-clusters'],
    queryFn: researchApi.getClusters,
    enabled: activeTab === 'clusters',
  });

  const tabs = [
    { id: 'overview', label: '概览', icon: Brain },
    { id: 'coverage', label: '知识覆盖', icon: Target },
    { id: 'trends', label: '趋势分析', icon: TrendingUp },
    { id: 'clusters', label: '主题聚类', icon: Layers },
  ] as const;

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="flex-none px-6 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">研究洞察</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">AI 驱动的知识分析</p>
            </div>
          </div>
          <button
            onClick={() => refetchOverview()}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'overview' && (
          <OverviewPanel data={overview} loading={loadingOverview} />
        )}
        {activeTab === 'coverage' && (
          <CoveragePanel data={coverage} loading={loadingCoverage} />
        )}
        {activeTab === 'trends' && (
          <TrendsPanel data={trends} loading={loadingTrends} />
        )}
        {activeTab === 'clusters' && (
          <ClustersPanel data={clusters} loading={loadingClusters} />
        )}
      </div>
    </div>
  );
}

function OverviewPanel({ data, loading }: { data: any; loading: boolean }) {
  if (loading) return <LoadingState />;
  if (!data) return <EmptyState message="暂无数据" />;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="知识覆盖度"
          value={`${Math.round((data.coverage?.overall || 0) * 100)}%`}
          icon={Target}
          color="indigo"
        />
        <StatCard
          title="热门主题"
          value={data.trends?.hot_topics?.length || 0}
          subtitle="个活跃主题"
          icon={TrendingUp}
          color="green"
        />
        <StatCard
          title="主题聚类"
          value={data.clusters?.total || 0}
          subtitle="个文档分组"
          icon={Layers}
          color="purple"
        />
      </div>

      {/* Insights Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Strengths */}
        <InsightCard
          title="知识优势"
          icon={Lightbulb}
          color="green"
          items={data.coverage?.strengths || []}
          emptyText="暂无明显优势领域"
        />

        {/* Hot Topics */}
        <InsightCard
          title="热门主题"
          icon={TrendingUp}
          color="orange"
          items={data.trends?.hot_topics || []}
          emptyText="暂无热门主题"
        />

        {/* Knowledge Gaps */}
        <InsightCard
          title="知识空白"
          icon={AlertCircle}
          color="red"
          items={data.coverage?.top_gaps || []}
          emptyText="知识覆盖良好"
        />

        {/* Emerging Topics */}
        <InsightCard
          title="新兴趋势"
          icon={Sparkles}
          color="purple"
          items={data.trends?.emerging || []}
          emptyText="暂无新兴趋势"
        />
      </div>

      {/* Recommendations */}
      {data.recommendations?.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            AI 建议
          </h3>
          <ul className="space-y-3">
            {data.recommendations.map((rec: string, i: number) => (
              <li key={i} className="flex items-start gap-3">
                <ChevronRight className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
                <span className="text-gray-700 dark:text-gray-300">{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CoveragePanel({ data, loading }: { data: any; loading: boolean }) {
  if (loading) return <LoadingState />;
  if (!data) return <EmptyState message="暂无覆盖度数据" />;

  return (
    <div className="space-y-6">
      {/* Overall Coverage */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">总体覆盖度</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1 h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${data.overall_coverage * 100}%` }}
            />
          </div>
          <span className="text-2xl font-bold text-indigo-600">
            {Math.round(data.overall_coverage * 100)}%
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          基于 {data.total_documents} 篇文档分析
        </p>
      </div>

      {/* Domain Coverage */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">领域覆盖详情</h3>
        <div className="space-y-4">
          {Object.entries(data.domain_coverage || {}).map(([domain, domainData]: [string, any]) => (
            <div key={domain} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900 dark:text-white">{domain}</span>
                <span className="text-sm text-gray-500">
                  {Math.round(domainData.coverage * 100)}%
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className={cn(
                    "h-full rounded-full transition-all",
                    domainData.coverage > 0.6 ? "bg-green-500" :
                    domainData.coverage > 0.3 ? "bg-yellow-500" : "bg-red-500"
                  )}
                  style={{ width: `${domainData.coverage * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gaps List */}
      {data.gaps?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            需要补充的领域
          </h3>
          <div className="space-y-3">
            {data.gaps.slice(0, 10).map((gap: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">{gap.subdomain}</span>
                  <span className="text-sm text-gray-500 ml-2">({gap.domain})</span>
                </div>
                <span className={cn(
                  "px-2 py-1 text-xs rounded-full",
                  gap.severity === 'high' 
                    ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                )}>
                  {gap.severity === 'high' ? '急需补充' : '建议补充'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrendsPanel({ data, loading }: { data: any; loading: boolean }) {
  if (loading) return <LoadingState />;
  if (!data) return <EmptyState message="暂无趋势数据" />;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="分析文档" value={data.total_documents} icon={FileText} color="blue" />
        <StatCard title="热门主题" value={data.hot_topics?.length || 0} icon={TrendingUp} color="green" />
        <StatCard title="新兴主题" value={data.emerging_topics?.length || 0} icon={Sparkles} color="purple" />
        <StatCard title="下降主题" value={data.declining_topics?.length || 0} icon={AlertCircle} color="red" />
      </div>

      {/* Trends List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">主题趋势</h3>
        <div className="space-y-3">
          {data.trends?.slice(0, 15).map((trend: any, i: number) => (
            <div key={i} className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center",
                trend.direction === 'rising' ? "bg-green-100 text-green-600" :
                trend.direction === 'declining' ? "bg-red-100 text-red-600" :
                "bg-gray-100 text-gray-600"
              )}>
                {trend.direction === 'rising' ? '↑' : trend.direction === 'declining' ? '↓' : '—'}
              </div>
              <div className="flex-1">
                <span className="font-medium text-gray-900 dark:text-white">{trend.topic}</span>
                <span className="text-sm text-gray-500 ml-2">({trend.document_count} 篇文档)</span>
              </div>
              <span className={cn(
                "text-sm font-medium",
                trend.direction === 'rising' ? "text-green-600" :
                trend.direction === 'declining' ? "text-red-600" : "text-gray-500"
              )}>
                {trend.change_rate > 0 ? '+' : ''}{Math.round(trend.change_rate * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClustersPanel({ data, loading }: { data: any; loading: boolean }) {
  if (loading) return <LoadingState />;
  if (!data) return <EmptyState message="暂无聚类数据" />;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="主题聚类" value={data.stats?.total_clusters || 0} icon={Layers} color="purple" />
        <StatCard title="已分类文档" value={data.stats?.clustered_documents || 0} icon={FileText} color="green" />
        <StatCard title="未分类文档" value={data.unclustered?.length || 0} icon={AlertCircle} color="gray" />
      </div>

      {/* Clusters Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.clusters?.map((cluster: any) => (
          <div key={cluster.id} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">{cluster.label}</h4>
                <p className="text-sm text-gray-500 mt-1">{cluster.description}</p>
              </div>
              <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-sm rounded-full">
                {cluster.size} 篇
              </span>
            </div>
            {cluster.keywords?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {cluster.keywords.map((kw: string, i: number) => (
                  <span key={i} className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Helper Components
function StatCard({ title, value, subtitle, icon: Icon, color }: {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ElementType;
  color: 'indigo' | 'green' | 'purple' | 'red' | 'blue' | 'orange' | 'gray';
}) {
  const colors = {
    indigo: 'from-indigo-500 to-indigo-600',
    green: 'from-green-500 to-green-600',
    purple: 'from-purple-500 to-purple-600',
    red: 'from-red-500 to-red-600',
    blue: 'from-blue-500 to-blue-600',
    orange: 'from-orange-500 to-orange-600',
    gray: 'from-gray-500 to-gray-600',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={cn("p-2 rounded-lg bg-gradient-to-br", colors[color])}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {value}
            {subtitle && <span className="text-sm font-normal text-gray-500 ml-1">{subtitle}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function InsightCard({ title, icon: Icon, color, items, emptyText }: {
  title: string;
  icon: React.ElementType;
  color: 'green' | 'orange' | 'red' | 'purple';
  items: string[];
  emptyText: string;
}) {
  const colors = {
    green: 'text-green-600 bg-green-100 dark:bg-green-900/30',
    orange: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30',
    red: 'text-red-600 bg-red-100 dark:bg-red-900/30',
    purple: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
        <div className={cn("p-1.5 rounded-lg", colors[color])}>
          <Icon className="w-4 h-4" />
        </div>
        {title}
      </h3>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.slice(0, 5).map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <ChevronRight className="w-4 h-4 text-gray-400" />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500 text-sm">{emptyText}</p>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-gray-500">正在分析...</p>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <Brain className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">{message}</p>
        <p className="text-sm text-gray-400 mt-1">添加更多文档以获取洞察</p>
      </div>
    </div>
  );
}

export default ResearchInsightsView;
