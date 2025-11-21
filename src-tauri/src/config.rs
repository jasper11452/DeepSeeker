use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Custom model path (if None, use default ~/.deepseeker/models/bge-m3)
    pub model_path: Option<String>,

    /// Indexing rules - patterns to ignore (e.g., ["node_modules", "*.log", ".git"])
    pub indexing_rules: Vec<String>,

    /// Theme preference (e.g., "light", "dark", "system")
    pub theme: String,

    /// Additional settings can be added here
    #[serde(default)]
    pub auto_reindex: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            model_path: None,
            indexing_rules: vec![
                "node_modules".to_string(),
                ".git".to_string(),
                "target".to_string(),
                "dist".to_string(),
                "build".to_string(),
                "*.log".to_string(),
            ],
            theme: "dark".to_string(),
            auto_reindex: true,
        }
    }
}

pub struct ConfigManager {
    db_path: PathBuf,
    config: Arc<Mutex<AppConfig>>,
}

impl ConfigManager {
    pub fn new(db_path: PathBuf) -> SqliteResult<Self> {
        let config = Arc::new(Mutex::new(AppConfig::default()));
        let manager = Self { db_path, config };

        // Initialize database table if needed
        manager.init_table()?;

        Ok(manager)
    }

    fn get_connection(&self) -> SqliteResult<Connection> {
        Connection::open(&self.db_path)
    }

    fn init_table(&self) -> SqliteResult<()> {
        let conn = self.get_connection()?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                model_path TEXT,
                indexing_rules TEXT NOT NULL,
                theme TEXT NOT NULL DEFAULT 'dark',
                auto_reindex INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;

        Ok(())
    }

    /// Load settings from database
    pub async fn load(&self) -> SqliteResult<AppConfig> {
        let conn = self.get_connection()?;

        let result: Result<(Option<String>, String, String, i32), rusqlite::Error> = conn.query_row(
            "SELECT model_path, indexing_rules, theme, auto_reindex FROM settings WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                ))
            },
        );

        match result {
            Ok((model_path, indexing_rules_json, theme, auto_reindex)) => {
                let indexing_rules: Vec<String> = serde_json::from_str(&indexing_rules_json)
                    .unwrap_or_else(|_| AppConfig::default().indexing_rules);

                let config = AppConfig {
                    model_path,
                    indexing_rules,
                    theme,
                    auto_reindex: auto_reindex != 0,
                };

                *self.config.lock().await = config.clone();
                Ok(config)
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // First time - insert default settings
                let default_config = AppConfig::default();
                self.save(&default_config).await?;
                Ok(default_config)
            }
            Err(e) => Err(e),
        }
    }

    /// Save settings to database
    pub async fn save(&self, config: &AppConfig) -> SqliteResult<()> {
        let conn = self.get_connection()?;

        let indexing_rules_json = serde_json::to_string(&config.indexing_rules)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // Try to update first
        let updated = conn.execute(
            "UPDATE settings SET
                model_path = ?1,
                indexing_rules = ?2,
                theme = ?3,
                auto_reindex = ?4,
                updated_at = ?5
            WHERE id = 1",
            params![
                &config.model_path,
                &indexing_rules_json,
                &config.theme,
                config.auto_reindex as i32,
                now,
            ],
        )?;

        // If no rows updated, insert new record
        if updated == 0 {
            conn.execute(
                "INSERT INTO settings (id, model_path, indexing_rules, theme, auto_reindex, created_at, updated_at)
                VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    &config.model_path,
                    &indexing_rules_json,
                    &config.theme,
                    config.auto_reindex as i32,
                    now,
                    now,
                ],
            )?;
        }

        // Update in-memory config
        *self.config.lock().await = config.clone();

        Ok(())
    }

    /// Get current config (from memory)
    pub async fn get(&self) -> AppConfig {
        self.config.lock().await.clone()
    }

    /// Update specific field
    pub async fn update_model_path(&self, path: Option<String>) -> SqliteResult<()> {
        let mut config = self.get().await;
        config.model_path = path;
        self.save(&config).await
    }

    pub async fn update_indexing_rules(&self, rules: Vec<String>) -> SqliteResult<()> {
        let mut config = self.get().await;
        config.indexing_rules = rules;
        self.save(&config).await
    }

    pub async fn update_theme(&self, theme: String) -> SqliteResult<()> {
        let mut config = self.get().await;
        config.theme = theme;
        self.save(&config).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_config_default() {
        let temp_file = NamedTempFile::new().unwrap();
        let manager = ConfigManager::new(temp_file.path().to_path_buf()).unwrap();

        let config = manager.load().await.unwrap();
        assert_eq!(config.theme, "dark");
        assert!(config.indexing_rules.contains(&"node_modules".to_string()));
    }

    #[tokio::test]
    async fn test_config_save_load() {
        let temp_file = NamedTempFile::new().unwrap();
        let manager = ConfigManager::new(temp_file.path().to_path_buf()).unwrap();

        let mut config = AppConfig::default();
        config.model_path = Some("/custom/path".to_string());
        config.theme = "light".to_string();

        manager.save(&config).await.unwrap();

        let loaded = manager.load().await.unwrap();
        assert_eq!(loaded.model_path, Some("/custom/path".to_string()));
        assert_eq!(loaded.theme, "light");
    }

    #[tokio::test]
    async fn test_config_update_fields() {
        let temp_file = NamedTempFile::new().unwrap();
        let manager = ConfigManager::new(temp_file.path().to_path_buf()).unwrap();

        manager.load().await.unwrap();

        manager.update_model_path(Some("/new/path".to_string())).await.unwrap();
        let config = manager.get().await;
        assert_eq!(config.model_path, Some("/new/path".to_string()));

        manager.update_theme("light".to_string()).await.unwrap();
        let config = manager.get().await;
        assert_eq!(config.theme, "light");
    }
}
