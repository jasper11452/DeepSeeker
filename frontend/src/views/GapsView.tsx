import { useState, useEffect } from 'react';
import { 
  AlertCircle, RefreshCw, Target, Lightbulb,
  BookOpen, ChevronRight, Search, GraduationCap,
  CheckCircle, XCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Gap {
  domain: string;
  subdomain: string;
  coverage: number;
  severity: 'high' | 'medium';
  document_count: number;
  suggestion: string;
}

interface CoverageData {
  overall_coverage: number;
  domain_coverage: {
    [domain: string]: {
      coverage: number;
      subdomains: {
        [subdomain: string]: {
          coverage: number;
          document_count: number;
          keywords: string[];
        };
      };
    };
  };
  gaps: Gap[];
  strengths: string[];
  recommendations: string[];
  total_documents: number;
}

interface LearningPath {
  stage: string;
  topics: string[];
}

export function GapsView() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [searchTopic, setSearchTopic] = useState('');
  const [missingTopics, setMissingTopics] = useState<any>(null);
  const [learningPath, setLearningPath] = useState<{ target_topic: string; learning_path: LearningPath[] } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const fetchCoverage = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/research/gaps/coverage');
      if (!response.ok) throw new Error('获取覆盖度数据失败');
      const result = await response.json();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoverage();
  }, []);

  const handleSearchMissing = async () => {
    if (!searchTopic.trim()) return;
    
    setSearchLoading(true);
    setMissingTopics(null);
    setLearningPath(null);
    
    try {
      const [missingRes, pathRes] = await Promise.all([
        fetch(`/api/research/gaps/missing/${encodeURIComponent(searchTopic)}`),
        fetch(`/api/research/gaps/learning-path/${encodeURIComponent(searchTopic)}`)
      ]);
      
      if (missingRes.ok) {
        const missing = await missingRes.json();
        setMissingTopics(missing);
      }
      
      if (pathRes.ok) {
        const path = await pathRes.json();
        setLearningPath(path);
      }
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setSearchLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-gray-500 dark:text-gray-400">正在分析知识覆盖度...</p>
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
            onClick={fetchCoverage}
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
            <AlertCircle className="w-7 h-7 text-orange-500" />
            知识空白分析
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            识别知识库中的盲区，发现需要补充的领域
          </p>
        </div>
        <button
          onClick={fetchCoverage}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新分析
        </button>
      </div>

      {/* 总体覆盖度 */}
      <div className="bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl p-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-medium opacity-90">总体知识覆盖度</h2>
            <div className="text-5xl font-bold mt-2">
              {Math.round(data.overall_coverage * 100)}%
            </div>
            <p className="text-sm opacity-75 mt-2">
              基于 {data.total_documents} 篇文档分析
            </p>
          </div>
          <Target className="w-16 h-16 opacity-30" />
        </div>
        
        {/* 进度条 */}
        <div className="mt-4 bg-white/20 rounded-full h-3">
          <div 
            className="bg-white rounded-full h-3 transition-all duration-500"
            style={{ width: `${data.overall_coverage * 100}%` }}
          />
        </div>
      </div>

      {/* 主题搜索 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <Search className="w-5 h-5 text-blue-500" />
          分析特定主题
        </h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={searchTopic}
            onChange={(e) => setSearchTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearchMissing()}
            placeholder="输入主题，例如：AI、机器学习、投资..."
            className="flex-1 px-4 py-2 bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSearchMissing}
            disabled={searchLoading || !searchTopic.trim()}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {searchLoading ? '分析中...' : '分析'}
          </button>
        </div>

        {/* 缺失主题结果 */}
        {missingTopics && (
          <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-750 rounded-lg">
            <h4 className="font-medium text-gray-900 dark:text-white mb-3">
              "{missingTopics.reference_topic}" 分析结果
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              找到 {missingTopics.related_document_count} 篇相关文档，
              覆盖率 {Math.round((missingTopics.coverage_analysis?.coverage_rate || 0) * 100)}%
            </p>
            
            {missingTopics.covered_aspects?.length > 0 && (
              <div className="mb-3">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">已覆盖方面：</p>
                <div className="flex flex-wrap gap-2">
                  {missingTopics.covered_aspects.map((aspect: string, i: number) => (
                    <span key={i} className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-sm flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {aspect}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {missingTopics.missing_aspects?.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">建议补充：</p>
                <div className="space-y-2">
                  {missingTopics.missing_aspects.map((item: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                      <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{item.aspect}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{item.importance}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 学习路径 */}
        {learningPath && learningPath.learning_path?.length > 0 && (
          <div className="mt-4 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
            <h4 className="font-medium text-gray-900 dark:text-white flex items-center gap-2 mb-3">
              <GraduationCap className="w-5 h-5 text-purple-500" />
              推荐学习路径
            </h4>
            <div className="space-y-4">
              {learningPath.learning_path.map((stage, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                    {i + 1}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{stage.stage}</p>
                    <ul className="mt-1 space-y-1">
                      {stage.topics.map((topic, j) => (
                        <li key={j} className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
                          <ChevronRight className="w-3 h-3" />
                          {topic}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 知识空白列表 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <XCircle className="w-5 h-5 text-red-500" />
            待补充领域
          </h3>
          <div className="space-y-3">
            {data.gaps.slice(0, 8).map((gap, i) => (
              <div 
                key={i}
                className={cn(
                  'p-3 rounded-lg',
                  gap.severity === 'high' 
                    ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                    : 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800'
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {gap.subdomain}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {gap.domain} · {gap.document_count} 篇文档
                    </p>
                  </div>
                  <span className={cn(
                    'px-2 py-0.5 rounded text-xs font-medium',
                    gap.severity === 'high'
                      ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                      : 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300'
                  )}>
                    {gap.severity === 'high' ? '急需补充' : '建议补充'}
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  {gap.suggestion}
                </p>
              </div>
            ))}
            
            {data.gaps.length === 0 && (
              <p className="text-center text-gray-500 dark:text-gray-400 py-4">
                太棒了！暂未发现明显知识空白
              </p>
            )}
          </div>
        </div>

        {/* 知识优势 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-green-500" />
            知识优势领域
          </h3>
          <div className="space-y-2">
            {data.strengths.length > 0 ? (
              data.strengths.map((strength, i) => (
                <div 
                  key={i}
                  className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg"
                >
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-gray-700 dark:text-gray-300">{strength}</span>
                </div>
              ))
            ) : (
              <p className="text-center text-gray-500 dark:text-gray-400 py-4">
                添加更多文档以建立知识优势
              </p>
            )}
          </div>

          {/* AI 建议 */}
          {data.recommendations.length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h4 className="font-medium text-gray-900 dark:text-white flex items-center gap-2 mb-3">
                <Lightbulb className="w-5 h-5 text-yellow-500" />
                AI 建议
              </h4>
              <div className="space-y-2">
                {data.recommendations.map((rec, i) => (
                  <div 
                    key={i}
                    className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg"
                  >
                    <p className="text-sm text-gray-700 dark:text-gray-300">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 领域覆盖度详情 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <BookOpen className="w-5 h-5 text-blue-500" />
          领域覆盖度详情
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(data.domain_coverage).map(([domain, domainData]) => (
            <DomainCard
              key={domain}
              domain={domain}
              coverage={domainData.coverage}
              subdomains={domainData.subdomains}
              isExpanded={selectedDomain === domain}
              onToggle={() => setSelectedDomain(
                selectedDomain === domain ? null : domain
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface DomainCardProps {
  domain: string;
  coverage: number;
  subdomains: { [key: string]: { coverage: number; document_count: number } };
  isExpanded: boolean;
  onToggle: () => void;
}

function DomainCard({ domain, coverage, subdomains, isExpanded, onToggle }: DomainCardProps) {
  const coveragePercent = Math.round(coverage * 100);
  const coverageColor = coverage > 0.6 ? 'green' : coverage > 0.3 ? 'yellow' : 'red';
  
  const colorClasses = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500'
  };

  return (
    <div 
      className={cn(
        'rounded-xl border transition-all cursor-pointer',
        isExpanded 
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700' 
          : 'bg-gray-50 dark:bg-gray-750 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
      )}
      onClick={onToggle}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-gray-900 dark:text-white">{domain}</h4>
          <span className={cn(
            'text-sm font-semibold',
            coverage > 0.6 ? 'text-green-600' : coverage > 0.3 ? 'text-yellow-600' : 'text-red-600'
          )}>
            {coveragePercent}%
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
          <div 
            className={cn('h-2 rounded-full transition-all', colorClasses[coverageColor])}
            style={{ width: `${coveragePercent}%` }}
          />
        </div>
        
        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600 space-y-2">
            {Object.entries(subdomains).map(([subdomain, data]) => (
              <div key={subdomain} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">{subdomain}</span>
                <span className={cn(
                  'font-medium',
                  data.coverage > 0.5 ? 'text-green-600' : data.coverage > 0.2 ? 'text-yellow-600' : 'text-red-600'
                )}>
                  {data.document_count}篇
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default GapsView;
