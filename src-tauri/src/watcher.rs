use notify::{Config, RecommendedWatcher, Watcher};
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use std::sync::{Arc, Mutex};

pub struct WatcherState {
    pub watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Arc::new(Mutex::new(None)),
        }
    }
}

pub fn init_watcher(app_handle: &AppHandle) -> anyhow::Result<()> {
    let (tx, rx) = channel();
    
    // Debounce events (2 seconds)
    let config = Config::default().with_poll_interval(Duration::from_secs(2));
    let watcher = RecommendedWatcher::new(tx, config)?;

    // We need to store the watcher in the state so it doesn't get dropped
    let watcher_state = app_handle.state::<WatcherState>();
    if let Ok(mut guard) = watcher_state.watcher.lock() {
        *guard = Some(watcher);
    }

    // Spawn a thread to handle events
    let app = app_handle.clone();
    std::thread::spawn(move || {
        for res in rx {
            match res {
                Ok(event) => {
                    log::info!("File event: {:?}", event);
                    
                    // Handle different event types
                    // For now, we just emit a generic event to the frontend
                    // In a real app, you'd want to be more specific (index updated file, etc.)
                    
                    // Extract paths
                    for path in event.paths {
                        let path_str = path.to_string_lossy().to_string();
                        
                        match event.kind {
                            notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {
                                let _ = app.emit("file-changed", &path_str);
                            }
                            notify::EventKind::Remove(_) => {
                                let _ = app.emit("file-removed", &path_str);
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => log::error!("watch error: {:?}", e),
            }
        }
    });

    Ok(())
}
