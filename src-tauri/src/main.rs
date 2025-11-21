// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use deepseeker::*;
use tauri::Manager;

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::create_collection,
            commands::list_collections,
            commands::delete_collection,
            commands::index_directory,
            commands::search,
            commands::cleanup_ghost_data,
            commands::detect_ghost_files,
            commands::full_reindex,
            commands::open_file_at_line,
            commands::check_model_status,
            commands::start_watching_collections,
            commands::update_file_incremental,
            commands::handle_file_removal,
            commands::log_error,
            commands::get_error_logs,
            commands::clear_error_logs,
            commands::get_performance_stats,
            commands::get_app_settings,
            commands::save_app_settings,
            commands::update_model_path,
            commands::update_indexing_rules,
            commands::update_theme,
            commands::get_chunk_context,
            commands::get_indexing_progress,
        ])
        .setup(|app| {
            // Initialize database on startup
            let app_handle = app.handle();
            let db_path = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir")
                .join("deepseeker.db");

            log::info!("Database path: {:?}", db_path);

            // Create parent directory if it doesn't exist
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            // Initialize database
            db::init_database(&db_path)?;

            // Clean up ghost data (files that no longer exist on disk)
            match db::cleanup_ghost_data(&db_path) {
                Ok(count) => {
                    if count > 0 {
                        log::info!("Cleaned up {} ghost documents on startup", count);
                    }
                }
                Err(e) => {
                    log::warn!("Failed to cleanup ghost data on startup: {}", e);
                }
            }

            // Initialize configuration manager
            let config_manager = std::sync::Arc::new(
                config::ConfigManager::new(db_path.clone())
                    .expect("Failed to initialize config manager")
            );

            // Load configuration
            let config_clone = config_manager.clone();
            tauri::async_runtime::spawn(async move {
                match config_clone.load().await {
                    Ok(cfg) => log::info!("Configuration loaded: theme={}, rules={}", cfg.theme, cfg.indexing_rules.len()),
                    Err(e) => log::warn!("Failed to load configuration: {}", e),
                }
            });

            // Store db path and config in app state
            app.manage(AppState {
                db_path: db_path.clone(),
                config_manager,
            });

            // Start HTTP server for browser extension in background
            let app_handle = app.handle().clone();
            
            // Initialize Watcher State
            app.manage(deepseeker::watcher::WatcherState::new());

            // Initialize Progress Tracker
            app.manage(deepseeker::progress::ProgressTracker::new());

            // Initialize Watcher Service
            if let Err(e) = deepseeker::watcher::init_watcher(&app_handle) {
                eprintln!("Failed to initialize file watcher: {}", e);
            }

            // Start HTTP Server
            tauri::async_runtime::spawn(async move {
                deepseeker::http_server::start_server(app_handle).await;
            });

            log::info!("DeepSeeker initialized successfully");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
