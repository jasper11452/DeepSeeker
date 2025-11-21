use crate::models::IndexProgress;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Global progress tracker for indexing operations
#[derive(Clone)]
pub struct ProgressTracker {
    progress_map: Arc<Mutex<HashMap<i64, IndexProgress>>>,
}

impl ProgressTracker {
    pub fn new() -> Self {
        Self {
            progress_map: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Update progress for a collection
    pub fn update(&self, collection_id: i64, progress: IndexProgress) {
        if let Ok(mut map) = self.progress_map.lock() {
            map.insert(collection_id, progress);
        }
    }

    /// Get progress for a collection
    pub fn get(&self, collection_id: i64) -> Option<IndexProgress> {
        if let Ok(map) = self.progress_map.lock() {
            map.get(&collection_id).cloned()
        } else {
            None
        }
    }

    /// Clear progress for a collection
    pub fn clear(&self, collection_id: i64) {
        if let Ok(mut map) = self.progress_map.lock() {
            map.remove(&collection_id);
        }
    }

    /// Update just the current file being processed
    pub fn update_current_file(&self, collection_id: i64, current_file: Option<String>) {
        if let Ok(mut map) = self.progress_map.lock() {
            if let Some(progress) = map.get_mut(&collection_id) {
                progress.current_file = current_file;
            }
        }
    }

    /// Increment processed files count
    pub fn increment_processed(&self, collection_id: i64) {
        if let Ok(mut map) = self.progress_map.lock() {
            if let Some(progress) = map.get_mut(&collection_id) {
                progress.processed_files += 1;
            }
        }
    }

    /// Add an error message
    pub fn add_error(&self, collection_id: i64, error: String) {
        if let Ok(mut map) = self.progress_map.lock() {
            if let Some(progress) = map.get_mut(&collection_id) {
                progress.errors.push(error);
            }
        }
    }
}

impl Default for ProgressTracker {
    fn default() -> Self {
        Self::new()
    }
}
