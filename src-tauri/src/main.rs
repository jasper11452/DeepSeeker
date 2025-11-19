// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use deepseeker::*;
use tauri::Manager;

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
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

            // Store db path in app state
            app.manage(AppState {
                db_path: db_path.clone(),
            });

            // Start HTTP server for browser extension in background
            let http_db_path = db_path.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http_server::start_server(http_db_path).await {
                    log::error!("HTTP server error: {}", e);
                }
            });

            log::info!("DeepSeeker initialized successfully");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
