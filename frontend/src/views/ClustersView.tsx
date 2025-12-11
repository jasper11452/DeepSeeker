import { useState, useEffect } from 'react';
import { 
  Layers, RefreshCw, ChevronDown, ChevronRight,
  FileText, Search
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ClusterDocument {
  id: number;
  title: string;
  filename: string;
  similarity_to_center?: number;
}

interface Cluster {
  id: number;
  label: string;
  description: string;
  documents: ClusterDocument[];
  keywords: string[];
  size: number;
}

interface ClusteringResult {
  clusters: Cluster[];
  unclustered: ClusterDocument[];
  stats: {
    total_documents: number;
    total_clusters: number;
    clustered_documents: number;
  };
}

export function ClustersView() {
  const [data, setData] = useState<ClusteringResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCluster, setExpandedCluster] = useState<number | null>(null);
  const [method, setMethod] = useState<'hdbscan' | 'kmeans'>('hdbscan');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchClusters = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/clusters?method=${method}`);
      if (!response.ok) throw new Error('获取聚类数据失败');
      const result = await response.json();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClusters();
  }, [method]);

  const filteredClusters = data?.clusters.filter(cluster => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      cluster.label.toLowerCase().includes(query) ||
      cluster.keywords.some(k => k.toLowerCase().includes(query)) ||
      cluster.documents.some(d => d.title.toLowerCase().includes(query))
    );
  }) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-gray-500 dark:text-gray-400">正在分析文档聚类...</p>
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
            onClick={fetchClusters}
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
            <Layers className="w-7 h-7 text-blue-500" />
            主题聚类
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            AI 自动归类相似文档，发现知识结构
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* 聚类方法选择 */}
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as 'hdbscan' | 'kmeans')}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg border-0 text-sm"
          >
            <option value="hdbscan">自动聚类 (HDBSCAN)</option>
            <option value="kmeans">固定聚类 (K-Means)</option>
          </select>
          <button
            onClick={fetchClusters}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            重新聚类
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      {data && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard 
            label="文档总数" 
            value={data.stats.total_documents} 
            color="blue"
          />
          <StatCard 
            label="聚类数量" 
            value={data.stats.total_clusters} 
            color="green"
          />
          <StatCard 
            label="已聚类" 
            value={`${data.stats.clustered_documents} / ${data.stats.total_documents}`}
            subtext={`${Math.round(data.stats.clustered_documents / Math.max(data.stats.total_documents, 1) * 100)}%`}
            color="purple"
          />
        </div>
      )}

      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="搜索聚类、关键词或文档..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* 聚类列表 */}
      <div className="space-y-4">
        {filteredClusters.map((cluster) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            isExpanded={expandedCluster === cluster.id}
            onToggle={() => setExpandedCluster(
              expandedCluster === cluster.id ? null : cluster.id
            )}
          />
        ))}

        {/* 未聚类文档 */}
        {data && data.unclustered.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
            <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-3">
              未归类文档 ({data.unclustered.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {data.unclustered.slice(0, 10).map((doc) => (
                <a
                  key={doc.id}
                  href={`/document/${doc.id}`}
                  className="px-3 py-1.5 bg-white dark:bg-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                >
                  {doc.title}
                </a>
              ))}
              {data.unclustered.length > 10 && (
                <span className="px-3 py-1.5 text-sm text-gray-500">
                  +{data.unclustered.length - 10} 更多
                </span>
              )}
            </div>
          </div>
        )}

        {filteredClusters.length === 0 && (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            {searchQuery ? '没有找到匹配的聚类' : '暂无聚类数据，请先添加文档'}
          </div>
        )}
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number | string;
  subtext?: string;
  color: 'blue' | 'green' | 'purple';
}

function StatCard({ label, value, subtext, color }: StatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
  };

  return (
    <div className={cn('rounded-xl p-4 border', colorClasses[color])}>
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
      {subtext && <p className="text-sm text-gray-500 dark:text-gray-400">{subtext}</p>}
    </div>
  );
}

interface ClusterCardProps {
  cluster: Cluster;
  isExpanded: boolean;
  onToggle: () => void;
}

function ClusterCard({ cluster, isExpanded, onToggle }: ClusterCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* 聚类头部 */}
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
            <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {cluster.label}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {cluster.size} 篇文档
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* 关键词标签 */}
          <div className="hidden md:flex items-center gap-2">
            {cluster.keywords.slice(0, 3).map((keyword, i) => (
              <span 
                key={i}
                className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-300"
              >
                {keyword}
              </span>
            ))}
          </div>
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* 展开内容 */}
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-gray-200 dark:border-gray-700">
          {/* 描述 */}
          {cluster.description && (
            <p className="text-gray-600 dark:text-gray-300 mt-4 mb-4">
              {cluster.description}
            </p>
          )}

          {/* 关键词 */}
          <div className="mb-4">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
              关键词
            </p>
            <div className="flex flex-wrap gap-2">
              {cluster.keywords.map((keyword, i) => (
                <span 
                  key={i}
                  className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm"
                >
                  {keyword}
                </span>
              ))}
            </div>
          </div>

          {/* 文档列表 */}
          <div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
              包含文档
            </p>
            <div className="space-y-2">
              {cluster.documents.map((doc) => (
                <a
                  key={doc.id}
                  href={`/document/${doc.id}`}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-750 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {doc.title}
                    </span>
                  </div>
                  {doc.similarity_to_center !== undefined && (
                    <span className="text-xs text-gray-500">
                      相关度 {Math.round(doc.similarity_to_center * 100)}%
                    </span>
                  )}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClustersView;
