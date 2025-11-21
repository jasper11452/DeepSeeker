interface Collection {
  id: number;
  name: string;
  folder_path: string | null;
  file_count: number;
  last_sync: number | null;
  created_at: number;
  updated_at: number;
}

interface Props {
  collections: Collection[];
  selectedCollection: number | null;
  onSelectCollection: (id: number) => void;
  onDeleteCollection: (id: number) => void;
  isLoading: boolean;
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return "Never";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function CollectionManager({
  collections,
  selectedCollection,
  onSelectCollection,
  onDeleteCollection,
  isLoading,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center px-2">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Collections</h3>
        <span className="text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">{collections.length}</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : collections.length === 0 ? (
        <div className="text-center py-8 px-4 bg-white/5 rounded-lg border border-white/5 border-dashed">
          <p className="text-sm text-slate-400 mb-2">No collections yet</p>
          <p className="text-xs text-slate-500">Create one to get started</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {collections.map((collection) => (
            <li
              key={collection.id}
              className={`group relative rounded-xl transition-all duration-200 border ${selectedCollection === collection.id
                ? "bg-indigo-500/10 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                : "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10"
                }`}
            >
              <button
                onClick={() => onSelectCollection(collection.id)}
                className="w-full text-left p-3 pr-10"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className={`font-medium text-sm ${selectedCollection === collection.id ? "text-indigo-200" : "text-slate-200"
                    }`}>
                    {collection.name}
                  </span>
                  <span className="text-[10px] font-mono bg-black/30 px-1.5 py-0.5 rounded text-slate-400">
                    {collection.file_count}
                  </span>
                </div>

                {collection.folder_path && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2 overflow-hidden">
                    <svg className="w-3 h-3 flex-shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="truncate opacity-70" title={collection.folder_path}>
                      {collection.folder_path.split('/').pop() || collection.folder_path}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span className="italic">
                    {collection.last_sync ? `Synced ${formatTimestamp(collection.last_sync)}` : "Not synced"}
                  </span>
                </div>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete collection "${collection.name}"?`)) {
                    onDeleteCollection(collection.id);
                  }
                }}
                className="absolute top-2 right-2 p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                title="Delete Collection"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
