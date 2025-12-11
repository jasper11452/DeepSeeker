import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  FileText, Plus, Loader2, Download, Copy, Check,
  BookOpen, GitCompare, BarChart3
} from 'lucide-react';
import { cn } from '../lib/utils';
import { documentsApi } from '../lib/api';

const reportsApi = {
  generate: async (params: {
    title: string;
    document_ids?: number[];
    topic?: string;
    report_type: string;
  }) => {
    const res = await fetch('/api/research/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Failed to generate report');
    return res.json();
  },
  quickSummary: async (document_ids: number[]) => {
    const res = await fetch('/api/research/reports/quick-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids }),
    });
    if (!res.ok) throw new Error('Failed to generate summary');
    return res.json();
  },
};

export function ReportsView() {
  const [selectedDocs, setSelectedDocs] = useState<number[]>([]);
  const [reportTitle, setReportTitle] = useState('');
  const [reportType, setReportType] = useState<'overview' | 'comparison' | 'analysis'>('overview');
  const [topic, setTopic] = useState('');
  const [generatedReport, setGeneratedReport] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const { data: documents } = useQuery({
    queryKey: ['documents'],
    queryFn: () => documentsApi.list({ limit: 100 }),
  });

  const generateMutation = useMutation({
    mutationFn: reportsApi.generate,
    onSuccess: (data) => setGeneratedReport(data),
  });

  const summaryMutation = useMutation({
    mutationFn: reportsApi.quickSummary,
    onSuccess: (data) => setGeneratedReport({ 
      title: '快速摘要', 
      abstract: data.summary,
      sections: [],
      sources: data.documents 
    }),
  });

  const handleGenerate = () => {
    if (!reportTitle && !topic) return;
    generateMutation.mutate({
      title: reportTitle || `关于 ${topic} 的研究报告`,
      document_ids: selectedDocs.length > 0 ? selectedDocs : undefined,
      topic: topic || undefined,
      report_type: reportType,
    });
  };

  const handleQuickSummary = () => {
    if (selectedDocs.length === 0) return;
    summaryMutation.mutate(selectedDocs);
  };

  const exportMarkdown = () => {
    if (!generatedReport) return;
    let md = `# ${generatedReport.title}\n\n`;
    if (generatedReport.abstract) md += `## 摘要\n\n${generatedReport.abstract}\n\n`;
    generatedReport.sections?.forEach((s: any) => {
      md += `## ${s.title}\n\n${s.content}\n\n`;
    });
    if (generatedReport.conclusion) md += `## 结论\n\n${generatedReport.conclusion}\n\n`;
    
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${generatedReport.title}.md`;
    a.click();
  };

  const copyToClipboard = async () => {
    if (!generatedReport) return;
    let text = `# ${generatedReport.title}\n\n`;
    if (generatedReport.abstract) text += `${generatedReport.abstract}\n\n`;
    generatedReport.sections?.forEach((s: any) => {
      text += `## ${s.title}\n\n${s.content}\n\n`;
    });
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reportTypes = [
    { id: 'overview', label: '综述报告', icon: BookOpen, desc: '概述主题的各个方面' },
    { id: 'comparison', label: '对比报告', icon: GitCompare, desc: '比较不同观点或方案' },
    { id: 'analysis', label: '深度分析', icon: BarChart3, desc: '深入分析某个问题' },
  ] as const;

  return (
    <div className="h-full flex bg-gray-50 dark:bg-gray-900">
      {/* Left Panel - Configuration */}
      <div className="w-96 flex-none border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            生成研究报告
          </h2>
          <p className="text-sm text-gray-500 mt-1">基于选定文档自动生成专业报告</p>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-6">
          {/* Report Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              报告标题
            </label>
            <input
              type="text"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="输入报告标题..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Topic */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              研究主题 (可选)
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="如: AI 在医疗领域的应用"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Report Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              报告类型
            </label>
            <div className="space-y-2">
              {reportTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setReportType(type.id)}
                  className={cn(
                    "w-full p-3 rounded-lg border text-left transition-colors",
                    reportType === type.id
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30"
                      : "border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <type.icon className={cn(
                      "w-5 h-5",
                      reportType === type.id ? "text-indigo-600" : "text-gray-400"
                    )} />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{type.label}</div>
                      <div className="text-xs text-gray-500">{type.desc}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Document Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              选择文档 ({selectedDocs.length} 已选)
            </label>
            <div className="max-h-48 overflow-auto border border-gray-200 dark:border-gray-600 rounded-lg">
              {documents?.documents?.map((doc: any) => (
                <label
                  key={doc.id}
                  className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b last:border-b-0 border-gray-100 dark:border-gray-600"
                >
                  <input
                    type="checkbox"
                    checked={selectedDocs.includes(doc.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedDocs([...selectedDocs, doc.id]);
                      } else {
                        setSelectedDocs(selectedDocs.filter(id => id !== doc.id));
                      }
                    }}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                    {doc.title || doc.filename}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || (!reportTitle && !topic)}
            className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                生成报告
              </>
            )}
          </button>
          <button
            onClick={handleQuickSummary}
            disabled={summaryMutation.isPending || selectedDocs.length === 0}
            className="w-full py-2.5 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors"
          >
            {summaryMutation.isPending ? '生成中...' : '快速摘要'}
          </button>
        </div>
      </div>

      {/* Right Panel - Preview */}
      <div className="flex-1 flex flex-col">
        <div className="flex-none p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-between">
          <h3 className="font-medium text-gray-900 dark:text-white">报告预览</h3>
          {generatedReport && (
            <div className="flex items-center gap-2">
              <button
                onClick={copyToClipboard}
                className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={exportMarkdown}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm"
              >
                <Download className="w-4 h-4" />
                导出 Markdown
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-6">
          {generatedReport ? (
            <article className="max-w-3xl mx-auto prose dark:prose-invert">
              <h1>{generatedReport.title}</h1>
              
              {generatedReport.abstract && (
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg not-prose mb-6">
                  <h4 className="text-sm font-medium text-gray-500 mb-2">摘要</h4>
                  <p className="text-gray-700 dark:text-gray-300">{generatedReport.abstract}</p>
                </div>
              )}

              {generatedReport.sections?.map((section: any, i: number) => (
                <section key={i}>
                  <h2>{section.title}</h2>
                  <p>{section.content}</p>
                </section>
              ))}

              {generatedReport.conclusion && (
                <section>
                  <h2>结论</h2>
                  <p>{generatedReport.conclusion}</p>
                </section>
              )}

              {generatedReport.sources?.length > 0 && (
                <section className="not-prose mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-500 mb-3">参考来源</h4>
                  <ul className="space-y-1">
                    {generatedReport.sources.map((source: any, i: number) => (
                      <li key={i} className="text-sm text-gray-600 dark:text-gray-400">
                        {i + 1}. {source.title || source.filename}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </article>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-gray-500">
                <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium">配置并生成报告</p>
                <p className="text-sm mt-1">选择文档、设置标题和类型后点击生成</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReportsView;
