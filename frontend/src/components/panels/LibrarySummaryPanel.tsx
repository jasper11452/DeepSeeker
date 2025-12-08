import { useQuery } from '@tanstack/react-query';
import { documentsApi } from '../../lib/api';
import { Database, Clock } from 'lucide-react';

export function LibrarySummaryPanel() {
  const { data } = useQuery({
    queryKey: ['documents'],
    queryFn: () => documentsApi.list({ limit: 1 }),
  });

  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">资料库总结</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <Database className="w-4 h-4 text-accent-primary" />
              文档总数
            </span>
            <span className="font-mono text-gray-900 dark:text-white">{data?.total || 0}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <Clock className="w-4 h-4 text-accent-primary" />
              最近更新
            </span>
            <span className="font-mono text-gray-900 dark:text-white text-xs">
              {data?.documents[0]?.updated_at ? new Date(data.documents[0].updated_at).toLocaleDateString() : '-'}
            </span>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">智能提示</h4>
        <div className="bg-gray-50 dark:bg-dark-elevated rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-subtle">
          试着上传更多文档来丰富知识库，或者使用聊天功能查询现有文档。
        </div>
      </div>
    </div>
  );
}