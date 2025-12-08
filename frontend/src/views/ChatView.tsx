import React, { useRef, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Send, User, Bot, Loader2, Edit2, Check, X, Copy, RefreshCw, FileText, ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useConversation } from '../hooks/useConversation';
import { conversationsApi, insightsApi } from '../lib/api';
import { useConversationStore } from '../stores/conversationStore';
import { useCopilotStore } from '../stores/copilotStore';
import { cn } from '../lib/utils';
import { DocumentSource } from '../types/conversation';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

// 消息内容组件，支持思考过程的渲染和 Markdown 实时渲染
function MessageContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [showThinking, setShowThinking] = useState(false);

  if (!content) {
    return isStreaming ? <span className="inline-block w-2 h-4 bg-accent-primary animate-pulse" /> : null;
  }

  // 检查是否包含思考标签
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  const isThinking = content.includes('<think>') && !content.includes('</think>');

  if (thinkMatch) {
    // 有完整的思考过程
    const thinkingContent = thinkMatch[1].trim();
    const mainContent = content.replace(/<think>[\s\S]*?<\/think>\n*/, '').trim();

    return (
      <div className="space-y-2">
        {/* 思考过程（可折叠） */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-dark-tertiary hover:bg-gray-200 dark:hover:bg-dark-hover transition-colors"
          >
            <Brain className="w-3.5 h-3.5" />
            <span>思考过程</span>
            {showThinking ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
          </button>
          {showThinking && (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-dark-secondary whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
              {thinkingContent}
            </div>
          )}
        </div>
        {/* 主要内容 - 使用 Markdown 渲染 */}
        {mainContent && (
          <MarkdownRenderer content={mainContent} isStreaming={isStreaming} />
        )}
      </div>
    );
  } else if (isThinking) {
    // 正在思考中（流式输出）
    const thinkingContent = content.replace('<think>', '').trim();
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Brain className="w-3.5 h-3.5 animate-pulse" />
          <span>正在思考...</span>
        </div>
        <div className="text-xs text-gray-400 dark:text-gray-500 whitespace-pre-wrap leading-relaxed">
          {thinkingContent}
          <span className="inline-block w-2 h-4 bg-gray-400 dark:bg-gray-500 animate-pulse ml-0.5 -mb-0.5" />
        </div>
      </div>
    );
  }

  // 普通内容 - 使用 Markdown 渲染
  return <MarkdownRenderer content={content} isStreaming={isStreaming} />;
}


export function ChatView() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const queryClient = useQueryClient();
  const { updateTitle } = useConversationStore();
  const {
    setCurrentQuery,
    setRecommendations,
    setLoadingRecommendations,
    setActiveChunkDetail,
    setLoadingChunk,
    reset: resetCopilot
  } = useCopilotStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [inputValue, setInputValue] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // 本地消息状态，用于乐观更新
  const [localMessages, setLocalMessages] = useState<any[]>([]);

  const { data: conversation, isLoading } = useConversation(conversationId);

  // Sync messages from server to local state
  // 注意：当正在流式传输时，不要用服务器数据覆盖本地临时消息
  useEffect(() => {
    if (conversation?.messages && !isStreaming) {
      setLocalMessages(conversation.messages);
    }
  }, [conversation?.messages, isStreaming]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (localMessages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [localMessages]);

  // Sync title input
  useEffect(() => {
    if (conversation) {
      setTitleInput(conversation.title);
    }
  }, [conversation]);

  // Reset copilot when conversation changes
  useEffect(() => {
    resetCopilot();
  }, [conversationId, resetCopilot]);

  // Handle autoSend parameter (from recommended questions)
  const [searchParams, setSearchParams] = useSearchParams();
  const autoSendProcessedRef = useRef<string | null>(null);

  useEffect(() => {
    const autoSendMessage = searchParams.get('autoSend');

    // 检查是否已经处理过这个特定的 autoSend 消息
    // 同时确保对话已加载完成（!isLoading）
    if (autoSendMessage &&
      conversationId &&
      !isStreaming &&
      !isLoading &&
      localMessages.length === 0 &&
      autoSendProcessedRef.current !== autoSendMessage) {

      // 标记为已处理，防止重复发送
      autoSendProcessedRef.current = autoSendMessage;

      // 立即清除 URL 参数
      setSearchParams({}, { replace: true });

      // 直接发送消息（不使用 setTimeout 避免竞态条件）
      sendMessage(autoSendMessage);
    }
  }, [searchParams, conversationId, isStreaming, isLoading, localMessages.length, setSearchParams]);

  // 当 conversationId 变化时重置标记
  useEffect(() => {
    autoSendProcessedRef.current = null;
  }, [conversationId]);

  // 实时推荐
  useEffect(() => {
    const query = inputValue.trim();
    setCurrentQuery(query);

    if (!query) {
      setRecommendations([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingRecommendations(true);
      try {
        const recommendations = await insightsApi.getRecommendations(query, 3);
        setRecommendations(recommendations);
      } catch (error) {
        console.error('Failed to load recommendations:', error);
        setRecommendations([]);
      } finally {
        setLoadingRecommendations(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [inputValue, setCurrentQuery, setRecommendations, setLoadingRecommendations]);

  // 核心发送消息函数
  const sendMessage = async (messageContent: string, skipUserMessage: boolean = false) => {
    if (!messageContent.trim() || !conversationId || isStreaming) return;

    setIsStreaming(true);

    // 1. 乐观更新：立即显示用户消息（除非是重试模式）
    const tempUserMsg = skipUserMessage ? null : {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      content: messageContent,
      timestamp: new Date().toISOString(),
      sources: null
    };

    // 2. 占位：立即显示助手正在思考/回答
    const tempAssistantMsg = {
      id: `temp-assistant-${Date.now()}`,
      role: 'assistant',
      content: '', // 初始为空，稍后流式填充
      timestamp: new Date().toISOString(),
      sources: null,
      isStreaming: true // 标记正在流式传输
    };

    if (skipUserMessage) {
      setLocalMessages(prev => [...prev, tempAssistantMsg]);
    } else {
      setLocalMessages(prev => [...prev, tempUserMsg!, tempAssistantMsg]);
    }

    try {
      // 3. 流式获取响应
      let fullContent = '';
      let sources: DocumentSource[] | null = null;

      for await (const chunk of conversationsApi.sendMessageStream(conversationId, messageContent)) {
        if (chunk.type === 'sources') {
          sources = chunk.data;
          // 更新 sources
          setLocalMessages(prev => {
            const next = [...prev];
            const lastMsg = next[next.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.sources = sources;
            }
            return next;
          });
        } else if (chunk.type === 'content') {
          fullContent += chunk.data;
          // 更新内容
          setLocalMessages(prev => {
            const next = [...prev];
            const lastMsg = next[next.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = fullContent;
            }
            return next;
          });
        } else if (chunk.type === 'done') {
          // 完成：确保最后一次更新完整内容和状态
          setLocalMessages(prev => {
            const next = [...prev];
            const lastMsg = next[next.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.isStreaming = false;
              // 确保内容同步（可选，防止流式丢包）
              if (chunk.data?.response) {
                lastMsg.content = chunk.data.response;
              }
            }
            return next;
          });
        }
      }
    } catch (error) {
      console.error("Stream error:", error);

      // 检查是否是 429 错误（并发请求被拒绝）
      const is429Error = error instanceof Error && error.message.includes('429');

      if (is429Error) {
        // 429 错误：移除刚添加的临时消息，因为请求没有被处理
        setLocalMessages(prev => {
          // 移除最后添加的临时消息
          const next = [...prev];
          // 如果最后一条是空的assistant消息，移除它
          if (next.length > 0 && next[next.length - 1].role === 'assistant' && !next[next.length - 1].content) {
            next.pop();
          }
          // 如果倒数第二条是刚添加的user消息（temp开头），也移除
          if (next.length > 0 && next[next.length - 1].id?.startsWith?.('temp-user-')) {
            next.pop();
          }
          return next;
        });
      } else {
        // 其他错误：显示错误信息
        setLocalMessages(prev => {
          const next = [...prev];
          if (next.length > 0) {
            const lastMsg = next[next.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content += "\n[出错了，请重试]";
              lastMsg.isStreaming = false;
            }
          }
          return next;
        });
      }
    } finally {
      setIsStreaming(false);
      // 双重保险：确保最后一条消息不再处于 loading 状态
      setLocalMessages(prev => {
        const next = [...prev];
        if (next.length > 0) {
          const lastMsg = next[next.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
            lastMsg.isStreaming = false;
          }
        }
        return next;
      });

      // 清空推荐
      setRecommendations([]);
      setCurrentQuery('');
      // 让 react-query 重新获取最新数据以确保一致性
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      // 更新列表（为了标题等）
      useConversationStore.getState().fetchConversations();
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim()) return;
    const message = inputValue;
    setInputValue('');
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const saveTitle = async () => {
    if (conversationId && titleInput.trim() !== conversation?.title) {
      await updateTitle(conversationId, titleInput);
    }
    setIsEditingTitle(false);
  };

  // 复制消息内容
  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // 重试：重新发送上一条用户消息
  const handleRetry = async (messageIndex: number) => {
    if (isStreaming || !conversationId) return;

    // 找到这条助手消息之前的用户消息
    let userMessageContent = '';
    let userMessageIndex = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (localMessages[i].role === 'user') {
        userMessageContent = localMessages[i].content;
        userMessageIndex = i;
        break;
      }
    }

    if (!userMessageContent) return;

    // 移除用户消息及其后的所有消息（重新发送完整对话）
    // 这样确保我们不会有重复的用户消息，而且能重新触发完整的问答流
    setLocalMessages(prev => prev.slice(0, userMessageIndex));

    // 重新发送消息（不跳过用户消息，像新消息一样发送）
    await sendMessage(userMessageContent, false);
  };

  if (!conversationId) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">选择一个对话</div>;
  }

  if (isLoading && !conversation && localMessages.length === 0) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-dark-primary">
      {/* Header */}
      <header className="px-6 py-4 border-b border-subtle flex items-center justify-between bg-gray-50/50 dark:bg-dark-secondary">
        {isEditingTitle ? (
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <input
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              className="flex-1 bg-white dark:bg-dark-tertiary px-2 py-1 rounded border border-accent-primary focus:outline-none text-gray-900 dark:text-white text-lg font-semibold"
              autoFocus
            />
            <button onClick={saveTitle} className="p-1 hover:text-green-600 dark:hover:text-green-400"><Check className="w-4 h-4" /></button>
            <button onClick={() => setIsEditingTitle(false)} className="p-1 hover:text-red-600 dark:hover:text-red-400"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <h1
            className="text-lg font-semibold text-gray-900 dark:text-white cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-2 group"
            onClick={() => setIsEditingTitle(true)}
          >
            {conversation?.title || "新对话"}
            <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 text-gray-400 dark:text-gray-500" />
          </h1>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {localMessages.filter(msg => msg && msg.role).map((msg, index) => (
          <div key={msg.id} className={cn("flex gap-4 max-w-3xl mx-auto group", msg.role === 'user' ? "flex-row-reverse" : "")}>
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
              msg.role === 'assistant' ? "bg-gradient-to-br from-accent-primary to-emerald-500" : "bg-gray-200 dark:bg-dark-hover"
            )}>
              {msg.role === 'assistant' ? <Bot className="w-5 h-5 text-white" /> : <User className="w-5 h-5 text-gray-500 dark:text-gray-400" />}
            </div>

            <div className="flex flex-col gap-1 max-w-[80%]">
              <div className={cn(
                "rounded-2xl px-4 py-3",
                msg.role === 'user'
                  ? "bg-accent-primary/10 dark:bg-accent-primary/20 text-gray-900 dark:text-gray-100 border border-accent-primary/20 dark:border-accent-primary/30"
                  : "bg-gray-50 dark:bg-dark-elevated/80 text-gray-700 dark:text-gray-200 border border-gray-100 dark:border-white/5"
              )}>
                <MessageContent content={msg.content} isStreaming={msg.isStreaming} />
              </div>

              {/* 助手消息的操作按钮 */}
              {msg.role === 'assistant' && msg.content && !msg.isStreaming && (
                <div className="flex flex-col gap-2 mt-2">
                  {/* 引用来源 */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {msg.sources.map((source: any, idx: number) => (
                        <button
                          key={`${source.document_id}-${source.chunk_id}-${idx}`}
                          onClick={async () => {
                            setLoadingChunk(true);
                            try {
                              const detail = await insightsApi.getChunkDetail(source.chunk_id);
                              setActiveChunkDetail(detail);
                            } catch (error) {
                              console.error('Failed to load chunk detail:', error);
                            } finally {
                              setLoadingChunk(false);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 dark:bg-dark-tertiary text-xs text-gray-600 dark:text-gray-400 hover:bg-accent-primary/10 hover:text-accent-primary transition-colors border border-transparent hover:border-accent-primary/20"
                          title={`查看: ${source.filename}`}
                        >
                          <FileText className="w-3 h-3" />
                          <span className="max-w-[150px] truncate">[{idx + 1}] {source.filename}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 操作按钮栏 */}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity self-start">
                    <button
                      onClick={() => handleCopy(msg.content)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-hover transition-colors"
                      title="复制"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRetry(index)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-hover transition-colors"
                      title="重试"
                      disabled={isStreaming}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <footer className="px-6 py-6 bg-white dark:bg-dark-primary border-t border-subtle">
        <div className="max-w-3xl mx-auto relative">
          <input
            ref={inputRef}
            className="w-full bg-gray-50 dark:bg-dark-tertiary text-gray-900 dark:text-white rounded-xl pl-4 pr-12 py-3.5 focus:outline-none focus:ring-2 focus:ring-accent-primary/50 placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-sm dark:shadow-none border border-gray-200 dark:border-white/10"
            placeholder="输入内容进行对话..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-accent-primary text-white hover:bg-accent-secondary disabled:opacity-50 disabled:hover:bg-accent-primary transition-all"
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming}
          >
            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </footer>
    </div>
  );
}
