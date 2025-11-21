import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SearchInterface from "./components/SearchInterface";
import CollectionManager from "./components/CollectionManager";
import CreateCollectionDialog from "./components/CreateCollectionDialog";
import ModelManager from "./components/ModelManager";
import { ValidationTest } from "./components/ValidationTest";
import Settings from "./components/Settings";

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
    onError: (error) => {
      alert(`Failed to create collection: ${error} `);
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

  // Initial data fetch and setup
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["collections"] });

    // Start watching collections
    invoke("start_watching_collections").catch(console.error);
  }, [queryClient]);

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
        folder_path = selected as string;
      }
    }

    return new Promise<void>((resolve, reject) => {
      createCollectionMutation.mutate(
        { name, folder_path },
        {
          onSuccess: () => resolve(),
          onError: (error) => reject(error),
        }
      );
    });
  };

  return (
    <div className="app-container text-slate-200 selection:bg-indigo-500/30">
      <header className="app-header">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-white">DeepSeeker</h1>
            <p className="text-[10px] font-medium text-indigo-300/80 uppercase tracking-wider">Local Neural Search</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <ModelManager />
          <button
            onClick={() => setIsValidationMode(!isValidationMode)}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-xs font-medium rounded-lg border border-white/10 transition-all"
          >
            {isValidationMode ? 'Exit Test Mode' : 'Dev Tools'}
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {isValidationMode ? (
        <div className="main-content">
          <div className="flex-1 overflow-auto p-6">
            <ValidationTest />
          </div>
        </div>
      ) : (
        <div className="main-content">
          <aside className="sidebar backdrop-blur-xl bg-black/20">
            <div className="p-4">
              <button
                onClick={handleOpenDialog}
                className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-medium rounded-lg shadow-lg shadow-indigo-900/20 transition-all duration-200 flex items-center justify-center gap-2 group"
              >
                <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Collection
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2">
              <CollectionManager
                collections={collections || []}
                selectedCollection={selectedCollection}
                onSelectCollection={setSelectedCollection}
                onDeleteCollection={(id) => deleteCollectionMutation.mutate(id)}
                isLoading={isLoading}
              />
            </div>
          </aside>

          <main className="content bg-gradient-to-br from-transparent to-black/20">
            {selectedCollection ? (
              <SearchInterface
                collectionId={selectedCollection}
                collectionName={
                  collections?.find((c) => c.id === selectedCollection)?.name || ""
                }
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-24 h-24 bg-gradient-to-tr from-indigo-500/10 to-purple-500/10 rounded-2xl flex items-center justify-center mb-6 border border-white/5">
                  <svg className="w-12 h-12 text-indigo-400/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Select a Collection</h2>
                <p className="text-slate-400 max-w-md mx-auto mb-8">
                  Choose a collection from the sidebar to start searching, or create a new one to index your documents.
                </p>
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
