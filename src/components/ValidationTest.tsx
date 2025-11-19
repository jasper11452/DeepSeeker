import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface SearchResult {
  chunk_id: number;
  doc_id: number;
  document_path: string;
  content: string;
  metadata: {
    headers: string[];
    chunk_type: string;
    language?: string;
  } | null;
  score: number;
  start_line: number;
  end_line: number;
}

export function ValidationTest() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [testCollectionId, setTestCollectionId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  // 硬编码导入测试数据
  const handleIndexTestData = async () => {
    try {
      setIndexing(true);
      setMessage('正在创建测试集合...');

      // 创建测试集合
      const collection = await invoke('create_collection', {
        name: 'Phase1_Validation_Test',
        folderPath: null,
      }) as { id: number };

      setTestCollectionId(collection.id);
      setMessage(`测试集合已创建 (ID: ${collection.id})，正在索引测试文件...`);

      // 硬编码测试数据路径
      const testDataPath = '/home/user/deepseeker/test-data';

      // 索引测试目录
      await invoke('index_directory', {
        collectionId: collection.id,
        directoryPath: testDataPath,
      });

      setMessage('✅ 测试数据索引完成！现在可以开始搜索测试。');
    } catch (error) {
      setMessage(`❌ 索引失败: ${error}`);
      console.error('Indexing error:', error);
    } finally {
      setIndexing(false);
    }
  };

  // 执行搜索
  const handleSearch = async () => {
    if (!query.trim()) {
      setMessage('请输入搜索关键词');
      return;
    }

    if (testCollectionId === null) {
      setMessage('请先点击"索引测试数据"按钮');
      return;
    }

    try {
      setLoading(true);
      setMessage(`正在搜索: "${query}"...`);

      const searchResults = await invoke('search', {
        query: query,
        collectionId: testCollectionId,
        limit: 20,
      }) as SearchResult[];

      setResults(searchResults);
      setMessage(`✅ 找到 ${searchResults.length} 个结果`);
    } catch (error) {
      setMessage(`❌ 搜索失败: ${error}`);
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

  // 快捷测试按钮
  const runQuickTest = async (testQuery: string) => {
    setQuery(testQuery);
    setMessage(`执行快捷测试: "${testQuery}"`);

    // 等待状态更新后执行搜索
    setTimeout(async () => {
      if (testCollectionId === null) {
        setMessage('请先点击"索引测试数据"按钮');
        return;
      }

      try {
        setLoading(true);
        const searchResults = await invoke('search', {
          query: testQuery,
          collectionId: testCollectionId,
          limit: 20,
        }) as SearchResult[];

        setResults(searchResults);
        setMessage(`✅ 找到 ${searchResults.length} 个结果`);
      } catch (error) {
        setMessage(`❌ 搜索失败: ${error}`);
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Phase 1 验证测试</h1>
        <p className="text-gray-600">
          关键目标: 搜索"藏在三级标题下的 Python 代码块"
        </p>
      </div>

      {/* 操作区 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">步骤 1: 索引测试数据</h2>
        <button
          onClick={handleIndexTestData}
          disabled={indexing || testCollectionId !== null}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {indexing ? '索引中...' : testCollectionId ? '✓ 已索引' : '索引测试数据'}
        </button>

        {testCollectionId && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded">
            <p className="text-green-800">
              ✓ 测试集合 ID: {testCollectionId}
            </p>
          </div>
        )}
      </div>

      {/* 搜索区 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">步骤 2: 执行搜索测试</h2>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="输入搜索关键词 (例如: async python, fetch data)"
            className="flex-1 px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            onClick={handleSearch}
            disabled={loading || !testCollectionId}
            className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? '搜索中...' : '搜索'}
          </button>
        </div>

        {/* 快捷测试按钮 */}
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">快捷测试 (点击直接搜索):</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => runQuickTest('async python')}
              disabled={!testCollectionId || loading}
              className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
            >
              async python
            </button>
            <button
              onClick={() => runQuickTest('fetch data')}
              disabled={!testCollectionId || loading}
              className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
            >
              fetch data
            </button>
            <button
              onClick={() => runQuickTest('DataProcessor')}
              disabled={!testCollectionId || loading}
              className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
            >
              DataProcessor
            </button>
            <button
              onClick={() => runQuickTest('bubble_sort')}
              disabled={!testCollectionId || loading}
              className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
            >
              bubble_sort
            </button>
          </div>
        </div>

        {/* 状态消息 */}
        {message && (
          <div className={`p-3 rounded ${
            message.startsWith('✅') ? 'bg-green-50 border border-green-200 text-green-800' :
            message.startsWith('❌') ? 'bg-red-50 border border-red-200 text-red-800' :
            'bg-blue-50 border border-blue-200 text-blue-800'
          }`}>
            {message}
          </div>
        )}
      </div>

      {/* 结果列表 */}
      {results.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">
            搜索结果 ({results.length})
          </h2>

          <div className="space-y-4">
            {results.map((result, index) => (
              <div
                key={result.chunk_id}
                className="border border-gray-200 rounded-lg p-4 hover:border-blue-400 transition-colors"
              >
                {/* 排名和得分 */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-500">
                    #{index + 1}
                  </span>
                  <span className="text-sm text-gray-500">
                    Score: {result.score.toFixed(4)}
                  </span>
                </div>

                {/* 标题路径 (关键!) */}
                {result.metadata?.headers && result.metadata.headers.length > 0 && (
                  <div className="mb-2 p-2 bg-yellow-50 border-l-4 border-yellow-400">
                    <p className="text-xs text-gray-600 mb-1">标题层级:</p>
                    <p className="text-sm font-medium text-gray-800">
                      {result.metadata.headers.join(' > ')}
                    </p>
                  </div>
                )}

                {/* 代码块信息 */}
                {result.metadata?.chunk_type === 'code' && (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                      代码块
                    </span>
                    {result.metadata.language && (
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                        {result.metadata.language}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      行 {result.start_line}-{result.end_line}
                    </span>
                  </div>
                )}

                {/* 内容预览 */}
                <div className="bg-gray-50 p-3 rounded overflow-auto">
                  <pre className="text-sm text-gray-800 whitespace-pre-wrap">
                    {result.content.length > 300
                      ? result.content.substring(0, 300) + '...'
                      : result.content}
                  </pre>
                </div>

                {/* 文件路径 */}
                <div className="mt-2 text-xs text-gray-500">
                  📄 {result.document_path}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 关键验证提示 */}
      {testCollectionId && results.length === 0 && query && !loading && (
        <div className="bg-red-50 border-2 border-red-500 rounded-lg p-6">
          <h3 className="text-xl font-bold text-red-800 mb-2">
            ⚠️ 未找到结果
          </h3>
          <p className="text-red-700">
            如果搜索"async python"无法找到嵌套在深层标题下的代码块，说明切片或搜索功能有问题！
          </p>
        </div>
      )}
    </div>
  );
}
