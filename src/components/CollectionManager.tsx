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
  onCreateCollection: () => void;
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
  onCreateCollection,
  onDeleteCollection,
  isLoading,
}: Props) {
  return (
    <div className="collection-manager">
      <div className="section-header">
        <h3>Collections</h3>
        <button onClick={onCreateCollection} className="btn-icon" title="New Collection">
          +
        </button>
      </div>

      {isLoading ? (
        <p className="loading">Loading...</p>
      ) : collections.length === 0 ? (
        <p className="empty">No collections yet</p>
      ) : (
        <ul className="collection-list">
          {collections.map((collection) => (
            <li
              key={collection.id}
              className={selectedCollection === collection.id ? "active" : ""}
            >
              <button
                onClick={() => onSelectCollection(collection.id)}
                className="collection-item"
              >
                <div className="collection-header">
                  <span className="collection-name">{collection.name}</span>
                  <span className="collection-count">{collection.file_count}</span>
                </div>
                {collection.folder_path && (
                  <div className="collection-path" title={collection.folder_path}>
                    📁 {collection.folder_path.split('/').pop() || collection.folder_path}
                  </div>
                )}
                <div className="collection-meta">
                  <span className="sync-time">
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
                className="btn-delete"
                title="Delete"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
