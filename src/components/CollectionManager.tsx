import { useState } from "react";

interface Collection {
  id: number;
  name: string;
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
                <span className="collection-name">{collection.name}</span>
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
