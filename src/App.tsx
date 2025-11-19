import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SearchInterface from "./components/SearchInterface";
import CollectionManager from "./components/CollectionManager";

interface Collection {
  id: number;
  name: string;
  folder_path: string | null;
  file_count: number;
  last_sync: number | null;
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
    mutationFn: async ({ name, folder_path }: { name: string; folder_path: string | null }) => {
      return await invoke("create_collection", { name, folder_path });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: async (collectionId: number) => {
      return await invoke("delete_collection", { collection_id: collectionId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      if (selectedCollection) {
        setSelectedCollection(null);
      }
    },
  });

  const handleCreateCollection = async () => {
    const name = prompt("Enter collection name:");
    if (!name) return;

    // Ask if user wants to link a folder
    const linkFolder = confirm("Do you want to link this collection to a specific folder?");
    let folder_path: string | null = null;

    if (linkFolder) {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select folder to index",
      });

      if (selected) {
        folder_path = selected.path;
      }
    }

    createCollectionMutation.mutate({ name, folder_path });
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
