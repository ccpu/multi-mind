//! Persistent prompt and conversation index. Only local main windows can call
//! these commands; guest pages report metadata through the existing bridge.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use tauri::State;
use url::Url;

const DATABASE_FILE_NAME: &str = "search.sqlite3";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEntry {
    id: i64,
    website_id: String,
    prompt: String,
    title: String,
    url: String,
}

struct SearchDatabase {
    path: PathBuf,
    connection: Connection,
}

pub struct SearchStore(Mutex<SearchDatabase>);

impl SearchStore {
    pub fn open(directory: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let path = directory.join(DATABASE_FILE_NAME);
        let connection = Connection::open(&path).map_err(|error| error.to_string())?;
        initialize(&connection)?;
        Ok(Self(Mutex::new(SearchDatabase { path, connection })))
    }

    /// Opens beside the active settings file, moving a database created by an
    /// older build in the default folder if one exists.
    pub fn open_for_settings(default: &Path, active: &Path) -> Result<Self, String> {
        let legacy = default.join(DATABASE_FILE_NAME);
        if default != active && legacy.exists() {
            let store = Self::open(default.to_path_buf())?;
            store.move_to(active)?;
            Ok(store)
        } else {
            Self::open(active.to_path_buf())
        }
    }

    /// Moves the live index with settings while preserving its row IDs. Entries
    /// already in the destination are appended to a staged copy before swap.
    pub fn move_to(&self, directory: &Path) -> Result<(), String> {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let target = directory.join(DATABASE_FILE_NAME);
        let mut database = self.0.lock().map_err(|error| error.to_string())?;
        if target == database.path {
            return Ok(());
        }
        if let (Ok(current), Ok(next)) =
            (fs::canonicalize(&database.path), fs::canonicalize(&target))
        {
            if current == next {
                return Ok(());
            }
        }

        let staged = directory.join(format!(".search-{}.sqlite3", rand::random::<u64>()));
        if let Err(error) = database
            .connection
            .execute("VACUUM INTO ?1", params![staged.to_string_lossy().as_ref()])
        {
            let _ = fs::remove_file(&staged);
            return Err(error.to_string());
        }

        let result = move_staged(&staged, &target);
        if result.is_err() {
            let _ = fs::remove_file(&staged);
        }
        result?;

        let next = Connection::open(&target).map_err(|error| error.to_string())?;
        let previous_path = std::mem::replace(&mut database.path, target);
        let previous = std::mem::replace(&mut database.connection, next);
        drop(previous);
        if let Err(error) = fs::remove_file(&previous_path) {
            eprintln!("Failed to remove the old search database: {error}");
        }
        Ok(())
    }

    fn add(&self, website_id: &str, prompt: &str) -> Result<i64, String> {
        let database = self.0.lock().map_err(|error| error.to_string())?;
        database
            .connection
            .execute(
                "INSERT INTO prompt_entries (website_id, prompt) VALUES (?1, ?2)",
                params![website_id, prompt],
            )
            .map_err(|error| error.to_string())?;
        Ok(database.connection.last_insert_rowid())
    }

    fn update(&self, id: i64, title: &str, url: &str) -> Result<(), String> {
        let parsed = Url::parse(url).map_err(|error| error.to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("Only HTTP or HTTPS conversation URLs can be saved.".into());
        }
        self.0
            .lock()
            .map_err(|error| error.to_string())?
            .connection
            .execute(
                "UPDATE prompt_entries SET title = ?2, url = ?3,
                 updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![id, title, url],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn search(&self, query: &str) -> Result<Vec<SearchEntry>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let escaped = query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{escaped}%");
        let database = self.0.lock().map_err(|error| error.to_string())?;
        let mut statement = database
            .connection
            .prepare(
                "SELECT id, website_id, prompt, title, url FROM prompt_entries
                 WHERE prompt LIKE ?1 ESCAPE '\\' OR title LIKE ?1 ESCAPE '\\'
                    OR url LIKE ?1 ESCAPE '\\'
                 ORDER BY updated_at DESC, id DESC LIMIT 100",
            )
            .map_err(|error| error.to_string())?;
        let entries = statement
            .query_map(params![pattern], |row| {
                Ok(SearchEntry {
                    id: row.get(0)?,
                    website_id: row.get(1)?,
                    prompt: row.get(2)?,
                    title: row.get(3)?,
                    url: row.get(4)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(entries)
    }
}

fn initialize(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS prompt_entries (
                id INTEGER PRIMARY KEY,
                website_id TEXT NOT NULL,
                prompt TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .map_err(|error| error.to_string())
}

fn move_staged(staged: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        let mut staged_connection = Connection::open(staged).map_err(|error| error.to_string())?;
        import_entries(&mut staged_connection, target)?;
    }

    let backup = target.with_file_name(format!(".search-backup-{}.sqlite3", rand::random::<u64>()));
    if target.exists() {
        fs::rename(target, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(staged, target) {
        if backup.exists() {
            if let Err(restore_error) = fs::rename(&backup, target) {
                return Err(format!(
                    "{error}; destination database backup at {} could not be restored: {restore_error}",
                    backup.display()
                ));
            }
        }
        return Err(error.to_string());
    }
    if backup.exists() {
        if let Err(error) = fs::remove_file(&backup) {
            eprintln!("Failed to remove the old destination search database: {error}");
        }
    }
    Ok(())
}

fn import_entries(destination: &mut Connection, source_path: &Path) -> Result<(), String> {
    let source = Connection::open_with_flags(source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let exists: bool = source
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'prompt_entries')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Ok(());
    }

    let mut statement = source
        .prepare(
            "SELECT website_id, prompt, title, url, created_at, updated_at FROM prompt_entries",
        )
        .map_err(|error| error.to_string())?;
    let entries = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let transaction = destination
        .transaction()
        .map_err(|error| error.to_string())?;
    for (website_id, prompt, title, url, created_at, updated_at) in entries {
        transaction
            .execute(
                "INSERT INTO prompt_entries
                 (website_id, prompt, title, url, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![website_id, prompt, title, url, created_at, updated_at],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn search_add_prompt(
    store: State<'_, SearchStore>,
    website_id: String,
    prompt: String,
) -> Result<i64, String> {
    store.add(&website_id, &prompt)
}

#[tauri::command]
pub fn search_update_prompt(
    store: State<'_, SearchStore>,
    id: i64,
    title: String,
    url: String,
) -> Result<(), String> {
    store.update(id, &title, &url)
}

#[tauri::command]
pub fn search_prompts(
    store: State<'_, SearchStore>,
    query: String,
) -> Result<Vec<SearchEntry>, String> {
    store.search(&query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_substrings_and_treats_like_metacharacters_as_text() {
        let connection = Connection::open_in_memory().unwrap();
        initialize(&connection).unwrap();
        let store = SearchStore(Mutex::new(SearchDatabase {
            path: PathBuf::new(),
            connection,
        }));
        let id = store.add("chatgpt", "Explain SQLite_% queries").unwrap();
        store
            .update(id, "SQLite guide", "https://chatgpt.com/c/abc123")
            .unwrap();

        assert_eq!(store.search("lite_%").unwrap().len(), 1);
        assert_eq!(store.search("abc12").unwrap().len(), 1);
        assert_eq!(store.search("GUIDE").unwrap().len(), 1);
        assert!(store.search("nothing").unwrap().is_empty());
        assert!(store.search("  ").unwrap().is_empty());
    }

    fn temp_root() -> PathBuf {
        let base = std::env::temp_dir().join("multi-mind-search-tests");
        fs::create_dir_all(&base).unwrap();
        let root = base.join(rand::random::<u64>().to_string());
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn clean(root: &Path) {
        let base = std::env::temp_dir()
            .join("multi-mind-search-tests")
            .canonicalize()
            .unwrap();
        let root = root.canonicalize().unwrap();
        assert!(root.starts_with(&base) && root != base);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn starts_beside_moved_settings_and_migrates_the_default_database() {
        let root = temp_root();
        let default = root.join("default");
        let active = root.join("My Drive").join("app-data").join("multi-mind");
        let legacy = SearchStore::open(default.clone()).unwrap();
        let id = legacy.add("claude", "Older prompt").unwrap();
        legacy
            .update(id, "Older title", "https://claude.ai/chat/123")
            .unwrap();
        drop(legacy);

        fs::create_dir_all(&active).unwrap();
        fs::write(
            default.join("settings-location.json"),
            serde_json::json!({ "directory": active.display().to_string() }).to_string(),
        )
        .unwrap();
        let settings = crate::settings::SettingsStore::load(default.clone());
        assert_eq!(settings.directory(), active);

        let store = SearchStore::open_for_settings(&default, &settings.directory()).unwrap();
        assert!(active.join(DATABASE_FILE_NAME).exists());
        assert!(!default.join(DATABASE_FILE_NAME).exists());
        assert_eq!(store.search("Older prompt").unwrap()[0].id, id);
        drop(store);
        clean(&root);
    }

    #[test]
    fn moving_the_data_folder_merges_existing_history_and_preserves_live_ids() {
        let root = temp_root();
        let source = root.join("source");
        let target = root.join("target");
        let store = SearchStore::open(source.clone()).unwrap();
        let live_id = store.add("chatgpt", "Live prompt").unwrap();
        let other = SearchStore::open(target.clone()).unwrap();
        other.add("claude", "Target prompt").unwrap();
        drop(other);

        store.move_to(&target).unwrap();
        assert!(!source.join(DATABASE_FILE_NAME).exists());
        assert_eq!(store.search("Live prompt").unwrap()[0].id, live_id);
        assert_eq!(store.search("Target prompt").unwrap().len(), 1);
        store.add("chatgpt", "After move").unwrap();
        drop(store);
        let reopened = SearchStore::open(target).unwrap();
        assert_eq!(reopened.search("After move").unwrap().len(), 1);
        drop(reopened);
        clean(&root);
    }
}
