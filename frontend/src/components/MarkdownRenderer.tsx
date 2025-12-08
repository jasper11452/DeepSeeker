import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Check, Copy } from 'lucide-react';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';

// 提取代码文本内容的辅助函数
function extractTextContent(node: React.ReactNode): string {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (!node) return '';

    if (Array.isArray(node)) {
        return node.map(extractTextContent).join('');
    }

    if (typeof node === 'object' && 'props' in node) {
        return extractTextContent((node as React.ReactElement).props.children);
    }

    return '';
}

// 自定义行内代码组件
function InlineCode({ children, className, node, ...props }: any) {
    // 检测是否为代码块（有 language 类名，说明是代码块内的 code）
    const match = /language-(\w+)/.exec(className || '');
    const isCodeBlock = !!match;

    // 代码块内的 code 标签，由 PreBlock 处理样式
    if (isCodeBlock) {
        return (
            <code className={`${className || ''} hljs`} {...props}>
                {children}
            </code>
        );
    }

    // 行内代码
    return (
        <code
            className="bg-gray-100 dark:bg-dark-tertiary px-1.5 py-0.5 rounded text-sm font-mono text-pink-500 dark:text-pink-400"
            {...props}
        >
            {children}
        </code>
    );
}

// 自定义 pre 组件，包装代码块
function PreBlock({ children, ...props }: any) {
    const [copied, setCopied] = useState(false);

    // 从 children 中提取语言信息
    let language = '';
    if (React.isValidElement(children)) {
        const childProps = children.props as any;
        const className = childProps?.className || '';
        const match = /language-(\w+)/.exec(className);
        language = match ? match[1] : '';
    }

    const handleCopy = async () => {
        const code = extractTextContent(children);
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
        }
    };

    return (
        <div className="relative group my-4">
            {/* 语言标签和复制按钮 */}
            <div className="absolute top-0 right-0 flex items-center gap-2 px-3 py-1.5 z-10">
                {language && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 uppercase font-mono">
                        {language}
                    </span>
                )}
                <button
                    onClick={handleCopy}
                    className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors opacity-0 group-hover:opacity-100"
                    title="复制代码"
                >
                    {copied ? (
                        <Check className="w-4 h-4 text-green-400" />
                    ) : (
                        <Copy className="w-4 h-4" />
                    )}
                </button>
            </div>
            <pre
                className="bg-gray-900 text-gray-100 p-4 pt-8 rounded-xl overflow-x-auto text-sm font-mono leading-relaxed whitespace-pre"
                {...props}
            >
                {children}
            </pre>
        </div>
    );
}

interface MarkdownRendererProps {
    content: string;
    isStreaming?: boolean;
    className?: string;
}

export function MarkdownRenderer({ content, isStreaming, className }: MarkdownRendererProps) {
    // 使用 useMemo 优化渲染性能
    const markdownContent = useMemo(() => {
        if (!content) return null;

        return (
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeHighlight, rehypeKatex]}
                components={{
                    // 自定义代码渲染
                    code: InlineCode as any,
                    // 段落样式
                    p: ({ children }) => (
                        <p className="text-gray-700 dark:text-gray-200 leading-relaxed mb-3 last:mb-0">
                            {children}
                        </p>
                    ),
                    // 标题样式
                    h1: ({ children }) => (
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-6 mb-4 first:mt-0">
                            {children}
                        </h1>
                    ),
                    h2: ({ children }) => (
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white mt-5 mb-3 first:mt-0">
                            {children}
                        </h2>
                    ),
                    h3: ({ children }) => (
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mt-4 mb-2 first:mt-0">
                            {children}
                        </h3>
                    ),
                    h4: ({ children }) => (
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white mt-3 mb-2 first:mt-0">
                            {children}
                        </h4>
                    ),
                    // 无序列表
                    ul: ({ children }) => (
                        <ul className="list-disc list-outside ml-5 space-y-1 text-gray-700 dark:text-gray-200 my-3">
                            {children}
                        </ul>
                    ),
                    // 有序列表
                    ol: ({ children }) => (
                        <ol className="list-decimal list-outside ml-5 space-y-1 text-gray-700 dark:text-gray-200 my-3">
                            {children}
                        </ol>
                    ),
                    // 列表项
                    li: ({ children }) => (
                        <li className="leading-relaxed">
                            {children}
                        </li>
                    ),
                    // 引用块
                    blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-accent-primary pl-4 py-1 my-3 bg-gray-50 dark:bg-dark-secondary/30 rounded-r text-gray-600 dark:text-gray-400 italic">
                            {children}
                        </blockquote>
                    ),
                    // 链接
                    a: ({ href, children }) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-primary hover:text-accent-secondary underline underline-offset-2 transition-colors"
                        >
                            {children}
                        </a>
                    ),
                    // 粗体
                    strong: ({ children }) => (
                        <strong className="font-bold text-gray-900 dark:text-white">
                            {children}
                        </strong>
                    ),
                    // 斜体
                    em: ({ children }) => (
                        <em className="italic">
                            {children}
                        </em>
                    ),
                    // 分隔线
                    hr: () => (
                        <hr className="my-6 border-gray-200 dark:border-gray-700" />
                    ),
                    // 表格
                    table: ({ children }) => (
                        <div className="overflow-x-auto my-4">
                            <table className="min-w-full border-collapse">
                                {children}
                            </table>
                        </div>
                    ),
                    thead: ({ children }) => (
                        <thead className="bg-gray-100 dark:bg-dark-tertiary">
                            {children}
                        </thead>
                    ),
                    th: ({ children }) => (
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700">
                            {children}
                        </th>
                    ),
                    td: ({ children }) => (
                        <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                            {children}
                        </td>
                    ),
                    // 删除线
                    del: ({ children }) => (
                        <del className="line-through text-gray-500">
                            {children}
                        </del>
                    ),
                    // 预格式化文本 - 使用自定义 PreBlock
                    pre: PreBlock,
                }}
            >
                {content}
            </ReactMarkdown>
        );
    }, [content]);

    return (
        <div className={`markdown-body prose prose-sm dark:prose-invert max-w-none ${className || ''}`}>
            {markdownContent}
            {isStreaming && (
                <span className="inline-block w-2 h-4 bg-accent-primary animate-pulse ml-0.5 -mb-0.5" />
            )}
        </div>
    );
}
