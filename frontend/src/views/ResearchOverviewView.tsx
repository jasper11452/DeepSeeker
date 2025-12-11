import { useState, useEffect } from 'react';
import { 
  Brain, TrendingUp, FileText, AlertCircle, 
  Sparkles, ChevronRight, RefreshCw, Target,
  Lightbulb, BarChart3, Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface OverviewData {
  coverage: {
    overall: number;
    strengths: string[];
    top_gaps: string[];
  };
  trends: {
    hot_topics: string[];
    emerging: string[];
    declining: string[];
  };
  clusters: {
    total: number;
    largest: {
      label: string;
      size: number;
    } | null;
  };
  recommendations: string[];
}

export function ResearchOverviewView() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/research/analysis/overview');
      if (!response.ok) throw new Error('获取分析数据失败');
      const result = await response.json();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-gray-500 dark:text-gray-400">正在分析知识库...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500">{error}</p>
          <button 
            onClick={fetchOverview}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Brain className="w-7 h-7 text-purple-500" />
            研究助手
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            AI 驱动的知识分析与洞察发现
          </p>
        </div>
        <button
          onClick={fetchOverview}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新分析
        </button>
      </div>

      {/* 覆盖度概览卡片 */}
      <div className="bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl p-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-medium opacity-90">知识库覆盖度</h2>
            <div className="text-5xl font-bold mt-2">
              {Math.round(data.coverage.overall * 100)}%
            </div>
            <p className="text-sm opacity-75 mt-2">
              基于预定义知识领域的覆盖程度
            </p>
          </div>
          <Target className="w-16 h-16 opacity-30" />
        </div>
        
        {/* 进度条 */}
        <div className="mt-4 bg-white/20 rounded-full h-2">
          <div 
            className="bg-white rounded-full h-2 transition-all duration-500"
            style={{ width: `${data.coverage.overall * 100}%` }}
          />
        </div>
      </div>

      {/* 功能入口网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <FeatureCard
          icon={<Layers className="w-6 h-6" />}
          title="主题聚类"
          description="自动归类相似文档"
          value={`${data.clusters.total} 个聚类`}
          href="/clusters"
          color="blue"
        />
        <FeatureCard
          icon={<TrendingUp className="w-6 h-6" />}
          title="趋势分析"
          description="追踪关注领域变化"
          value={`${data.trends.hot_topics.length} 个热点`}
          href="/trends"
          color="green"
        />
        <FeatureCard
          icon={<FileText className="w-6 h-6" />}
          title="研究报告"
          description="自动生成文档综述"
          href="/reports"
          color="purple"
        />
        <FeatureCard
          icon={<AlertCircle className="w-6 h-6" />}
          title="知识空白"
          description="发现缺失的知识领域"
          value={`${data.coverage.top_gaps.length} 处空白`}
          href="/gaps"
          color="orange"
        />
      </div>

      {/* 详细分析区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 知识优势 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-yellow-500" />
            知识优势领域
          </h3>
          <div className="space-y-2">
            {data.coverage.strengths.length > 0 ? (
              data.coverage.strengths.map((strength, i) => (
                <div 
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded-lg"
                >
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="text-gray-700 dark:text-gray-300">{strength}</span>
                </div>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                暂无明显优势领域，继续添加文档以建立知识库
              </p>
            )}
          </div>
        </div>

        {/* 知识空白 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <AlertCircle className="w-5 h-5 text-orange-500" />
            待补充领域
          </h3>
          <div className="space-y-2">
            {data.coverage.top_gaps.length > 0 ? (
              data.coverage.top_gaps.map((gap, i) => (
                <div 
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg"
                >
                  <div className="w-2 h-2 bg-orange-500 rounded-full" />
                  <span className="text-gray-700 dark:text-gray-300">{gap}</span>
                </div>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                暂未发现明显知识空白
              </p>
            )}
          </div>
        </div>

        {/* 热门主题 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            热门主题
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.trends.hot_topics.length > 0 ? (
              data.trends.hot_topics.map((topic, i) => (
                <span 
                  key={i}
                  className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm"
                >
                  {topic}
                </span>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                添加更多文档以发现热门主题
              </p>
            )}
          </div>
          
          {data.trends.emerging.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">新兴主题</p>
              <div className="flex flex-wrap gap-2">
                {data.trends.emerging.map((topic, i) => (
                  <span 
                    key={i}
                    className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm flex items-center gap-1"
                  >
                    <TrendingUp className="w-3 h-3" />
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* AI 建议 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <Lightbulb className="w-5 h-5 text-purple-500" />
            AI 建议
          </h3>
          <div className="space-y-3">
            {data.recommendations.length > 0 ? (
              data.recommendations.map((rec, i) => (
                <div 
                  key={i}
                  className="flex gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg"
                >
                  <div className="flex-shrink-0 w-6 h-6 bg-purple-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                    {i + 1}
                  </div>
                  <p className="text-gray-700 dark:text-gray-300 text-sm">{rec}</p>
                </div>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                继续使用 DeepSeeker 以获取个性化建议
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  value?: string;
  href: string;
  color: 'blue' | 'green' | 'purple' | 'orange';
}

function FeatureCard({ icon, title, description, value, href, color }: FeatureCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
  };

  return (
    <a
      href={href}
      className="block bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all group"
    >
      <div className={cn('w-12 h-12 rounded-lg flex items-center justify-center mb-3', colorClasses[color])}>
        {icon}
      </div>
      <h3 className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
        {title}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        {description}
      </p>
      {value && (
        <p className="text-lg font-semibold text-gray-900 dark:text-white mt-2">
          {value}
        </p>
      )}
      <div className="flex items-center gap-1 text-sm text-blue-500 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
        查看详情 <ChevronRight className="w-4 h-4" />
      </div>
    </a>
  );
}

export default ResearchOverviewView;
