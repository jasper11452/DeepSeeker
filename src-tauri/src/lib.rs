pub mod commands;
pub mod db;
pub mod chunker;
pub mod embeddings;
pub mod search;
pub mod models;
pub mod http_server;
pub mod pdf_parser;
pub mod pdf_ocr;
pub mod watcher;
pub mod config;
pub mod progress;

use std::path::PathBuf;
use std::sync::Arc;
use config::ConfigManager;

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
    pub config_manager: Arc<ConfigManager>,
}
