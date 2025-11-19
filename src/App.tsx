import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SearchInterface from "./components/SearchInterface";
import CollectionManager from "./components/CollectionManager";

interface Collection {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

function App() {
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: collections, isLoading } = useQuery<Collection[]>({
    queryKey: ["collections"],
    queryFn: async () => {
      return await invoke("list_collections");
    },
  });

  const createCollectionMutation = useMutation({
    mutationFn: async (name: string) => {
      return await invoke("create_collection", { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: async (collectionId: number) => {
      return await invoke("delete_collection", { collectionId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      if (selectedCollection) {
        setSelectedCollection(null);
      }
    },
  });

  const handleCreateCollection = () => {
    const name = prompt("Enter collection name:");
    if (name) {
      createCollectionMutation.mutate(name);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🔍 DeepSeeker</h1>
        <p className="tagline">Local-First Neural Search</p>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <CollectionManager
            collections={collections || []}
            selectedCollection={selectedCollection}
            onSelectCollection={setSelectedCollection}
            onCreateCollection={handleCreateCollection}
            onDeleteCollection={(id) => deleteCollectionMutation.mutate(id)}
            isLoading={isLoading}
          />
        </aside>

        <main className="content">
          {selectedCollection ? (
            <SearchInterface
              collectionId={selectedCollection}
              collectionName={
                collections?.find((c) => c.id === selectedCollection)?.name || ""
              }
            />
          ) : (
            <div className="empty-state">
              <h2>Welcome to DeepSeeker</h2>
              <p>Select or create a collection to get started</p>
              <button onClick={handleCreateCollection} className="btn-primary">
                Create Your First Collection
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
