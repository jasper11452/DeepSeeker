import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import SearchFilters, { SearchFiltersState } from "./SearchFilters";
import ChunkPreviewPanel from "./ChunkPreviewPanel";

interface SearchResult {
  chunk_id: number;
  doc_id: number;
  document_path: string;
  document_status: string; // 'normal', 'scanned_pdf', 'error'
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

interface IndexProgress {
  total_files: number;
  processed_files: number;
  current_file: string | null;
}

interface Props {
  collectionId: number;
  collectionName: string;
}

export default function SearchInterface({ collectionId, collectionName }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [filters, setFilters] = useState<SearchFiltersState>({ fileTypes: [] });
  const [previewChunk, setPreviewChunk] = useState<SearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [results]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K to focus input
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      // Navigation only if not searching and has results
      if (results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = prev + 1;
          return next >= results.length ? 0 : next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = prev - 1;
          return next < 0 ? results.length - 1 : next;
        });
      } else if (e.key === "Enter") {
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          e.preventDefault();
          const result = results[selectedIndex];
          setPreviewChunk(result);
        }
      } else if (e.key === "Escape") {
        if (previewChunk) {
          setPreviewChunk(null);
        } else {
          inputRef.current?.blur();
          setSelectedIndex(-1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [results, selectedIndex, previewChunk]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && resultsRef.current) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex]);

  // Highlight search keywords in content
  const highlightText = useCallback((text: string, searchQuery: string) => {
    if (!searchQuery.trim()) return text;

    // Split query into individual keywords
    const keywords = searchQuery.trim().split(/\s+/).filter(k => k.length > 0);

    // Create a regex pattern that matches any of the keywords (case-insensitive)
    const pattern = keywords
      .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // Escape special regex chars
      .join('|');

    const regex = new RegExp(`(${pattern})`, 'gi');

    // Split text by matches and create highlighted segments
    const parts = text.split(regex);

    return parts.map((part, index) => {
      // Check if this part matches any keyword (case-insensitive)
      const isMatch = keywords.some(k =>
        part.toLowerCase() === k.toLowerCase()
      );

      if (isMatch) {
        return <mark key={index} className="bg-yellow-400/20 text-yellow-200 font-semibold rounded px-0.5">{part}</mark>;
      }
      return <span key={index}>{part}</span>;
    });
  }, []);

  // Detect ghost files on mount
  const { data: ghostFiles, refetch: refetchGhostFiles } = useQuery<string[]>({
    queryKey: ["ghostFiles", collectionId],
    queryFn: async () => {
      return await invoke("detect_ghost_files");
    },
  });

  const searchMutation = useMutation({
    mutationFn: async (args: { query: string; filters: SearchFiltersState }) => {
      setIsSearching(true);
      try {
        const results = await invoke<SearchResult[]>("search", {
          query: args.query,
          collection_id: collectionId,
          filters: args.filters,
          limit: 20,
        });
        return results;
      } finally {
        setIsSearching(false);
      }
    },
    onSuccess: (data) => {
      setResults(data);
    },
  });

  const indexMutation = useMutation({
    mutationFn: async (directoryPath: string) => {
      return await invoke<IndexProgress>("index_directory", {
        collection_id: collectionId,
        directory_path: directoryPath,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      refetchGhostFiles();
    },
  });

  const fullReindexMutation = useMutation({
    mutationFn: async (directoryPath: string) => {
      return await invoke<IndexProgress>("full_reindex", {
        collection_id: collectionId,
        directory_path: directoryPath,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      refetchGhostFiles();
    },
  });

  const cleanupGhostMutation = useMutation({
    mutationFn: async () => {
      return await invoke<number>("cleanup_ghost_data");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      refetchGhostFiles();
    },
  });

  const handleSearch = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (query.trim()) {
        searchMutation.mutate({ query, filters });
      }
    },
    [query, filters, searchMutation]
  );

  // Re-search when filters change if there is a query
  useEffect(() => {
    if (query.trim()) {
      handleSearch();
    }
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleIndexDirectory = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Select folder to index",
    });

    if (selected) {
      indexMutation.mutate(selected as string);
    }
  };

  const handleFullReindex = async () => {
    if (!confirm("⚠️ Full reindex will DELETE all indexed data for this collection and re-scan. Continue?")) {
      return;
    }

    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Select folder to reindex",
    });

    if (selected) {
      fullReindexMutation.mutate(selected as string);
    }
  };

  const handleCleanupGhost = async () => {
    if (!ghostFiles || ghostFiles.length === 0) {
      alert("No ghost files detected!");
      return;
    }

    if (!confirm(`Clean up ${ghostFiles.length} deleted file(s) from the index?`)) {
      return;
    }

    cleanupGhostMutation.mutate();
  };

  const handleOpenFile = async (filePath: string, line: number) => {
    try {
      await invoke("open_file_at_line", {
        file_path: filePath,
        line: line,
      });
    } catch (error) {
      console.error("Failed to open file:", error);
      alert(`Failed to open file: ${error}`);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold text-white tracking-tight">{collectionName}</h2>
        <div className="flex gap-3">
          <button
            onClick={handleIndexDirectory}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-200 text-sm font-medium rounded-lg border border-white/10 transition-all flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Index Directory
          </button>
          <button
            onClick={handleFullReindex}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-200 text-sm font-medium rounded-lg border border-white/10 transition-all flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reindex
          </button>
        </div>
      </div>

      {/* Ghost file notification */}
      {ghostFiles && ghostFiles.length > 0 && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 rounded-lg">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h4 className="text-amber-200 font-medium text-sm">Ghost Files Detected</h4>
              <p className="text-amber-200/70 text-xs">Found {ghostFiles.length} files in index that no longer exist on disk.</p>
            </div>
          </div>
          <button
            onClick={handleCleanupGhost}
            disabled={cleanupGhostMutation.isPending}
            className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-medium rounded-lg transition-colors"
          >
            {cleanupGhostMutation.isPending ? "Cleaning..." : "Clean Up"}
          </button>
        </div>
      )}

      {cleanupGhostMutation.isSuccess && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Cleaned up {cleanupGhostMutation.data} ghost file(s)
        </div>
      )}

      {(indexMutation.isPending || fullReindexMutation.isPending) && (
        <div className="mb-6 p-6 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-indigo-300 font-medium">Indexing files...</p>
          <p className="text-indigo-300/60 text-sm mt-1">This might take a moment depending on the collection size.</p>
        </div>
      )}

      {(indexMutation.isSuccess || fullReindexMutation.isSuccess) && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p>
            Indexing complete! Processed {indexMutation.data?.processed_files || fullReindexMutation.data?.processed_files} files.
          </p>
        </div>
      )}

      <form onSubmit={handleSearch} className="mb-4 relative group">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
        <div className="relative flex items-center">
          <div className="absolute left-4 text-slate-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your knowledge base... (Cmd+K)"
            className="w-full pl-12 pr-4 py-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all text-lg shadow-xl"
            autoFocus
          />
          <button
            type="submit"
            disabled={isSearching}
            className="absolute right-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-indigo-900/20"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      <SearchFilters onFilterChange={setFilters} />

      <div className="flex flex-col gap-4" ref={resultsRef}>
        {results.length === 0 && !isSearching && query && (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-slate-400 text-lg">No results found for "{query}"</p>
            <p className="text-slate-600 text-sm mt-1">Try adjusting your search terms or indexing more files.</p>
          </div>
        )}

        {results.map((result, index) => (
          <div
            key={result.chunk_id}
            className={`group border rounded-xl p-5 transition-all duration-200 cursor-pointer hover:shadow-xl hover:shadow-indigo-900/10 hover:-translate-y-0.5 ${selectedIndex === index
              ? "bg-white/10 border-indigo-500/50 ring-1 ring-indigo-500/50"
              : "bg-white/5 hover:bg-white/10 border-white/5 hover:border-indigo-500/30"
              }`}
            onClick={() => setPreviewChunk(result)}
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-xs text-indigo-300/70 bg-indigo-500/10 px-2 py-1 rounded w-fit">
                  {result.document_path.split('/').pop()}
                </span>
                <span className="text-[10px] text-slate-500">
                  {result.document_path} • Lines {result.start_line}-{result.end_line}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                  {result.metadata?.chunk_type || "text"}
                </span>
                <div className="px-2 py-1 bg-white/5 rounded text-[10px] font-mono text-slate-400">
                  {result.score.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Display warning for scanned PDFs or errors */}
            {result.document_status === "scanned_pdf" && (
              <div className="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2 text-xs text-amber-300">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <strong>Scanned PDF</strong> - No text layer available
              </div>
            )}
            {result.document_status === "error" && (
              <div className="mb-3 px-3 py-2 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-xs text-rose-300">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <strong>Processing Error</strong> - Failed to extract content
              </div>
            )}

            {result.metadata?.headers && result.metadata.headers.length > 0 && (
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                {result.metadata.headers.join(" > ")}
              </div>
            )}

            <div className="relative">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500/50 rounded-full"></div>
              {result.metadata?.language ? (
                <div className="pl-4 text-sm overflow-x-auto rounded-lg">
                  <div className="absolute right-0 top-0 text-[10px] text-slate-500 bg-black/30 px-1.5 py-0.5 rounded z-10">
                    {result.metadata.language}
                  </div>
                  <SyntaxHighlighter
                    language={result.metadata.language}
                    style={vscDarkPlus}
                    customStyle={{ background: 'transparent', padding: 0, margin: 0 }}
                    wrapLines={true}
                  >
                    {result.content}
                  </SyntaxHighlighter>
                </div>
              ) : (
                <pre className="pl-4 text-sm text-slate-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                  <code>{highlightText(result.content, query)}</code>
                </pre>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Chunk Preview Panel */}
      {previewChunk && (
        <ChunkPreviewPanel
          docId={previewChunk.doc_id}
          startLine={previewChunk.start_line}
          targetChunkId={previewChunk.chunk_id}
          documentPath={previewChunk.document_path}
          onClose={() => setPreviewChunk(null)}
          onOpenFile={handleOpenFile}
        />
      )}
    </div>
  );
}
