import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useMutation } from "@tanstack/react-query";

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

  const searchMutation = useMutation({
    mutationFn: async (searchQuery: string) => {
      setIsSearching(true);
      try {
        const results = await invoke<SearchResult[]>("search", {
          query: searchQuery,
          collectionId,
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
        collectionId,
        directoryPath,
      });
    },
  });

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim()) {
        searchMutation.mutate(query);
      }
    },
    [query, searchMutation]
  );

  const handleIndexDirectory = async () => {
    const path = prompt("Enter directory path to index:");
    if (path) {
      indexMutation.mutate(path);
    }
  };

  return (
    <div className="search-interface">
      <div className="search-header">
        <h2>{collectionName}</h2>
        <button onClick={handleIndexDirectory} className="btn-secondary">
          Index Directory
        </button>
      </div>

      {indexMutation.isPending && (
        <div className="indexing-progress">
          <p>Indexing files...</p>
        </div>
      )}

      {indexMutation.isSuccess && (
        <div className="indexing-success">
          <p>
            ✓ Indexed {indexMutation.data.processed_files} of{" "}
            {indexMutation.data.total_files} files
          </p>
        </div>
      )}

      <form onSubmit={handleSearch} className="search-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your knowledge base..."
          className="search-input"
          autoFocus
        />
        <button type="submit" disabled={isSearching} className="btn-primary">
          {isSearching ? "Searching..." : "Search"}
        </button>
      </form>

      <div className="results-container">
        {results.length === 0 && !isSearching && query && (
          <p className="no-results">No results found for "{query}"</p>
        )}

        {results.map((result) => (
          <div key={result.chunk_id} className="result-card">
            <div className="result-header">
              <span className="result-path">{result.document_path}</span>
              <span className="result-location">
                Lines {result.start_line}-{result.end_line}
              </span>
            </div>

            {result.metadata?.headers && result.metadata.headers.length > 0 && (
              <div className="result-breadcrumb">
                {result.metadata.headers.join(" > ")}
              </div>
            )}

            <pre className={`result-content ${result.metadata?.chunk_type || ""}`}>
              {result.metadata?.language && (
                <span className="language-tag">{result.metadata.language}</span>
              )}
              {result.content}
            </pre>

            <div className="result-footer">
              <span className="result-type">
                {result.metadata?.chunk_type || "text"}
              </span>
              <span className="result-score">Score: {result.score.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
