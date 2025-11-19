import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SearchInterface from "./components/SearchInterface";
import CollectionManager from "./components/CollectionManager";
import CreateCollectionDialog from "./components/CreateCollectionDialog";
import { ValidationTest } from "./components/ValidationTest";

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
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isValidationMode, setIsValidationMode] = useState(false);
  const queryClient = useQueryClient();

  const { data: collections, isLoading } = useQuery<Collection[]>({
    queryKey: ["collections"],
    queryFn: async () => {
      return await invoke("list_collections");
    },
  });

  const createCollectionMutation = useMutation({
    mutationFn: async ({ name, folder_path }: { name: string; folder_path: string | null }) => {
      console.log("Creating collection:", { name, folder_path });
      return await invoke("create_collection", { name, folder_path });
    },
    onSuccess: (data) => {
      console.log("Collection created successfully:", data);
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (error) => {
      console.error("Failed to create collection:", error);
      alert(`Failed to create collection: ${error}`);
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

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCreateCollection = async (name: string, linkFolder: boolean) => {
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

    return new Promise<void>((resolve, reject) => {
      createCollectionMutation.mutate(
        { name, folder_path },
        {
          onSuccess: () => {
            console.log("Collection created, resolving promise");
            resolve();
          },
          onError: (error) => {
            console.error("Collection creation failed, rejecting promise");
            reject(error);
          },
        }
      );
    });
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div>
          <h1>🔍 DeepSeeker</h1>
          <p className="tagline">Local-First Neural Search</p>
        </div>
        <button
          onClick={() => setIsValidationMode(!isValidationMode)}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
          style={{ marginLeft: 'auto' }}
        >
          {isValidationMode ? '← 返回正常模式' : '🧪 Phase 1 验证测试'}
        </button>
      </header>

      {isValidationMode ? (
        <div className="main-content" style={{ gridTemplateColumns: '1fr' }}>
          <ValidationTest />
        </div>
      ) : (
        <div className="main-content">
          <aside className="sidebar">
            <CollectionManager
              collections={collections || []}
              selectedCollection={selectedCollection}
              onSelectCollection={setSelectedCollection}
              onCreateCollection={handleOpenDialog}
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
                <button onClick={handleOpenDialog} className="btn-primary">
                  Create Your First Collection
                </button>
              </div>
            )}
          </main>
        </div>
      )}

      <CreateCollectionDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSubmit={handleCreateCollection}
      />
    </div>
  );
}

export default App;
