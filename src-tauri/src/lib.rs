pub mod commands;
pub mod db;
pub mod chunker;
pub mod embeddings;
pub mod search;
pub mod models;
pub mod http_server;
pub mod pdf_parser;
pub mod watcher;

use std::path::PathBuf;

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
}
