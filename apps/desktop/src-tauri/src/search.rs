//! Persistent prompt and conversation index. Only local main windows can call
//! these commands; guest pages report metadata through the existing bridge.
//!
//! Each submission is one `prompts` row, and each provider that accepted it is
//! one `conversations` row, so a prompt sent to several providers is found and
//! listed once, with every conversation it started.

use std::cmp::Reverse;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, params_from_iter, Connection, OpenFlags};
use serde::Serialize;
use tauri::State;
use url::Url;

const DATABASE_FILE_NAME: &str = "search.sqlite3";
/// Prompts listed while the search box is empty.
const RECENT_LIMIT: usize = 20;
/// Newest matches that are ranked; older ones are left out.
const CANDIDATE_LIMIT: usize = 300;
const RESULT_LIMIT: usize = 50;
/// Words beyond this many are ignored rather than widening the query.
const MAX_TERMS: usize = 8;
/// Rows of the per-provider schema sent this close to the first row with the
/// same prompt are taken to be one submission when they are grouped.
const LEGACY_GROUP_SECONDS: i64 = 60;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConversation {
    id: i64,
    website_id: String,
    title: String,
    url: String,
}

/// One submitted prompt with the conversation it started on each provider.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEntry {
    id: i64,
    prompt: String,
    /// SQLite UTC timestamp, `YYYY-MM-DD HH:MM:SS`.
    created_at: String,
    conversations: Vec<SearchConversation>,
}

/// A prompt as copied between databases, without its row IDs.
struct StoredPrompt {
    prompt: String,
    created_at: String,
    conversations: Vec<StoredConversation>,
}

struct StoredConversation {
    website_id: String,
    title: String,
    url: String,
    created_at: String,
    updated_at: String,
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
        let connection = connect(&path)?;
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

        let next = connect(&target)?;
        let previous_path = std::mem::replace(&mut database.path, target);
        let previous = std::mem::replace(&mut database.connection, next);
        drop(previous);
        if let Err(error) = fs::remove_file(&previous_path) {
            eprintln!("Failed to remove the old search database: {error}");
        }
        Ok(())
    }

    fn add_prompt(&self, prompt: &str) -> Result<i64, String> {
        let database = self.0.lock().map_err(|error| error.to_string())?;
        database
            .connection
            .execute("INSERT INTO prompts (prompt) VALUES (?1)", params![prompt])
            .map_err(|error| error.to_string())?;
        Ok(database.connection.last_insert_rowid())
    }

    /// Links a provider to a prompt, once per provider.
    fn add_conversation(&self, prompt_id: i64, website_id: &str) -> Result<i64, String> {
        self.0
            .lock()
            .map_err(|error| error.to_string())?
            .connection
            .query_row(
                "INSERT INTO conversations (prompt_id, website_id) VALUES (?1, ?2)
                 ON CONFLICT (prompt_id, website_id)
                 DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                 RETURNING id",
                params![prompt_id, website_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())
    }

    fn update_conversation(&self, id: i64, title: &str, url: &str) -> Result<(), String> {
        let parsed = Url::parse(url).map_err(|error| error.to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("Only HTTP or HTTPS conversation URLs can be saved.".into());
        }
        self.0
            .lock()
            .map_err(|error| error.to_string())?
            .connection
            .execute(
                "UPDATE conversations SET title = ?2, url = ?3,
                 updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![id, title, url],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Every word must appear in the prompt or in one of its conversation
    /// titles or URLs. Results are ranked by where the words were found, newest
    /// first within a rank; an empty query lists the most recent prompts.
    fn search(&self, query: &str) -> Result<Vec<SearchEntry>, String> {
        let database = self.0.lock().map_err(|error| error.to_string())?;
        let connection = &database.connection;
        let terms = search_terms(query);
        if terms.is_empty() {
            return load_entries(
                connection,
                &format!(
                    "SELECT id, prompt, created_at FROM prompts
                     ORDER BY created_at DESC, id DESC LIMIT {RECENT_LIMIT}"
                ),
                Vec::new(),
            );
        }

        let conditions = (1..=terms.len())
            .map(|index| {
                format!(
                    "(p.prompt LIKE ?{index} ESCAPE '\\' OR EXISTS (
                        SELECT 1 FROM conversations c WHERE c.prompt_id = p.id
                        AND (c.title LIKE ?{index} ESCAPE '\\' OR c.url LIKE ?{index} ESCAPE '\\')))"
                )
            })
            .collect::<Vec<_>>()
            .join(" AND ");
        let patterns = terms.iter().map(|term| like_pattern(term)).collect();
        let entries = load_entries(
            connection,
            &format!(
                "SELECT p.id, p.prompt, p.created_at FROM prompts p WHERE {conditions}
                 ORDER BY p.created_at DESC, p.id DESC LIMIT {CANDIDATE_LIMIT}"
            ),
            patterns,
        )?;

        let phrase = normalize(query);
        let mut ranked = entries
            .into_iter()
            .map(|entry| (rank(&entry, &phrase, &terms), entry))
            .collect::<Vec<_>>();
        // Stable, so each rank keeps the newest-first order of the query.
        ranked.sort_by_key(|(order, _)| Reverse(*order));
        Ok(ranked
            .into_iter()
            .take(RESULT_LIMIT)
            .map(|(_, entry)| entry)
            .collect())
    }
}

fn connect(path: &Path) -> Result<Connection, String> {
    let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
    initialize(&mut connection)?;
    Ok(connection)
}

fn initialize(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS prompts (
                id INTEGER PRIMARY KEY,
                prompt TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS prompts_by_age ON prompts (created_at DESC, id DESC);
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY,
                prompt_id INTEGER NOT NULL REFERENCES prompts (id) ON DELETE CASCADE,
                website_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (prompt_id, website_id)
            );",
        )
        .map_err(|error| error.to_string())?;

    // Builds before prompts were grouped kept one row per provider.
    if !has_table(connection, "prompt_entries")? {
        return Ok(());
    }
    let legacy = read_legacy(connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    insert_history(&transaction, &legacy)?;
    transaction
        .execute_batch("DROP TABLE prompt_entries")
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

fn has_table(connection: &Connection, name: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            params![name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

/// Lowercased, deduplicated words of a query.
fn search_terms(query: &str) -> Vec<String> {
    let mut terms: Vec<String> = Vec::new();
    for term in query.split_whitespace().map(str::to_lowercase) {
        if !terms.contains(&term) {
            terms.push(term);
        }
    }
    terms.truncate(MAX_TERMS);
    terms
}

fn like_pattern(term: &str) -> String {
    let escaped = term
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn normalize(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// 3: the prompt holds the query as typed. 2: the prompt holds every word.
/// 1: every word is in the prompt or a conversation title. 0: a URL was needed.
fn rank(entry: &SearchEntry, phrase: &str, terms: &[String]) -> u8 {
    let prompt = normalize(&entry.prompt);
    if prompt.contains(phrase) {
        return 3;
    }
    if terms.iter().all(|term| prompt.contains(term.as_str())) {
        return 2;
    }
    let titles = entry
        .conversations
        .iter()
        .map(|conversation| conversation.title.to_lowercase())
        .collect::<Vec<_>>();
    let in_text = |term: &String| {
        prompt.contains(term.as_str()) || titles.iter().any(|title| title.contains(term.as_str()))
    };
    if terms.iter().all(in_text) {
        1
    } else {
        0
    }
}

/// Runs a query selecting `id, prompt, created_at` from `prompts` and attaches
/// each prompt's conversations.
fn load_entries(
    connection: &Connection,
    sql: &str,
    parameters: Vec<String>,
) -> Result<Vec<SearchEntry>, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let mut entries = statement
        .query_map(params_from_iter(parameters), |row| {
            Ok(SearchEntry {
                id: row.get(0)?,
                prompt: row.get(1)?,
                created_at: row.get(2)?,
                conversations: Vec::new(),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut conversations = connection
        .prepare_cached(
            "SELECT id, website_id, title, url FROM conversations
             WHERE prompt_id = ?1 ORDER BY id",
        )
        .map_err(|error| error.to_string())?;
    for entry in &mut entries {
        entry.conversations = conversations
            .query_map(params![entry.id], |row| {
                Ok(SearchConversation {
                    id: row.get(0)?,
                    website_id: row.get(1)?,
                    title: row.get(2)?,
                    url: row.get(3)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
    }
    Ok(entries)
}

/// Reads grouped prompts plus any rows still in the per-provider table.
fn read_history(connection: &Connection) -> Result<Vec<StoredPrompt>, String> {
    let mut history = Vec::new();
    if has_table(connection, "prompts")? {
        let mut statement = connection
            .prepare("SELECT id, prompt, created_at FROM prompts ORDER BY id")
            .map_err(|error| error.to_string())?;
        let prompts = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    StoredPrompt {
                        prompt: row.get(1)?,
                        created_at: row.get(2)?,
                        conversations: Vec::new(),
                    },
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let positions = prompts
            .iter()
            .enumerate()
            .map(|(position, (id, _))| (*id, position))
            .collect::<HashMap<_, _>>();
        history = prompts.into_iter().map(|(_, prompt)| prompt).collect();

        let mut statement = connection
            .prepare(
                "SELECT prompt_id, website_id, title, url, created_at, updated_at
                 FROM conversations ORDER BY id",
            )
            .map_err(|error| error.to_string())?;
        let conversations = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    StoredConversation {
                        website_id: row.get(1)?,
                        title: row.get(2)?,
                        url: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                    },
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        for (prompt_id, conversation) in conversations {
            if let Some(&position) = positions.get(&prompt_id) {
                history[position].conversations.push(conversation);
            }
        }
    }
    if has_table(connection, "prompt_entries")? {
        history.extend(read_legacy(connection)?);
    }
    Ok(history)
}

/// Groups per-provider rows back into submissions: consecutive rows with the
/// same prompt, sent shortly after each other, to different providers.
fn read_legacy(connection: &Connection) -> Result<Vec<StoredPrompt>, String> {
    let mut statement = connection
        .prepare(
            "SELECT website_id, prompt, title, url, created_at, updated_at,
                    CAST(strftime('%s', created_at) AS INTEGER)
             FROM prompt_entries ORDER BY id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(6)?.unwrap_or_default(),
                StoredConversation {
                    website_id: row.get(0)?,
                    title: row.get(2)?,
                    url: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                },
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut history: Vec<StoredPrompt> = Vec::new();
    let mut group_seconds = 0;
    for (prompt, seconds, conversation) in rows {
        match history.last_mut() {
            Some(last)
                if last.prompt == prompt
                    && seconds - group_seconds <= LEGACY_GROUP_SECONDS
                    && last
                        .conversations
                        .iter()
                        .all(|existing| existing.website_id != conversation.website_id) =>
            {
                last.conversations.push(conversation);
            }
            _ => {
                group_seconds = seconds;
                history.push(StoredPrompt {
                    prompt,
                    created_at: conversation.created_at.clone(),
                    conversations: vec![conversation],
                });
            }
        }
    }
    Ok(history)
}

fn insert_history(connection: &Connection, history: &[StoredPrompt]) -> Result<(), String> {
    let mut add_prompt = connection
        .prepare("INSERT INTO prompts (prompt, created_at) VALUES (?1, ?2)")
        .map_err(|error| error.to_string())?;
    let mut add_conversation = connection
        .prepare(
            "INSERT OR IGNORE INTO conversations
             (prompt_id, website_id, title, url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|error| error.to_string())?;
    for stored in history {
        let prompt_id = add_prompt
            .insert(params![stored.prompt, stored.created_at])
            .map_err(|error| error.to_string())?;
        for conversation in &stored.conversations {
            add_conversation
                .execute(params![
                    prompt_id,
                    conversation.website_id,
                    conversation.title,
                    conversation.url,
                    conversation.created_at,
                    conversation.updated_at,
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn move_staged(staged: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        let mut staged_connection = Connection::open(staged).map_err(|error| error.to_string())?;
        import_history(&mut staged_connection, target)?;
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

fn import_history(destination: &mut Connection, source_path: &Path) -> Result<(), String> {
    let source = Connection::open_with_flags(source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let history = read_history(&source)?;
    let transaction = destination
        .transaction()
        .map_err(|error| error.to_string())?;
    insert_history(&transaction, &history)?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn search_add_prompt(store: State<'_, SearchStore>, prompt: String) -> Result<i64, String> {
    store.add_prompt(&prompt)
}

#[tauri::command]
pub fn search_add_conversation(
    store: State<'_, SearchStore>,
    prompt_id: i64,
    website_id: String,
) -> Result<i64, String> {
    store.add_conversation(prompt_id, &website_id)
}

#[tauri::command]
pub fn search_update_conversation(
    store: State<'_, SearchStore>,
    id: i64,
    title: String,
    url: String,
) -> Result<(), String> {
    store.update_conversation(id, &title, &url)
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

    fn memory_store() -> SearchStore {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize(&mut connection).unwrap();
        SearchStore(Mutex::new(SearchDatabase {
            path: PathBuf::new(),
            connection,
        }))
    }

    /// Saves a prompt with one conversation per `(website, title, url)`.
    fn save(store: &SearchStore, prompt: &str, conversations: &[(&str, &str, &str)]) -> i64 {
        let id = store.add_prompt(prompt).unwrap();
        for (website_id, title, url) in conversations {
            let conversation = store.add_conversation(id, website_id).unwrap();
            store.update_conversation(conversation, title, url).unwrap();
        }
        id
    }

    fn prompts(entries: &[SearchEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.prompt.as_str()).collect()
    }

    #[test]
    fn finds_substrings_and_treats_like_metacharacters_as_text() {
        let store = memory_store();
        save(
            &store,
            "Explain SQLite_% queries",
            &[("chatgpt", "SQLite guide", "https://chatgpt.com/c/abc123")],
        );
        save(&store, "Explain SQLite queries", &[]);

        assert_eq!(store.search("lite_%").unwrap().len(), 1);
        assert_eq!(store.search("abc12").unwrap().len(), 1);
        assert_eq!(store.search("GUIDE").unwrap().len(), 1);
        assert!(store.search("nothing").unwrap().is_empty());
    }

    #[test]
    fn lists_a_prompt_once_with_every_provider_it_was_sent_to() {
        let store = memory_store();
        let id = store.add_prompt("Cache turbo in CI").unwrap();
        let claude = store.add_conversation(id, "claude").unwrap();
        let gemini = store.add_conversation(id, "gemini").unwrap();
        assert_eq!(store.add_conversation(id, "claude").unwrap(), claude);
        store
            .update_conversation(gemini, "Turbo caching", "https://gemini.google.com/app/1")
            .unwrap();

        let results = store.search("turbo").unwrap();
        assert_eq!(results.len(), 1);
        let websites = results[0]
            .conversations
            .iter()
            .map(|conversation| conversation.website_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(websites, ["claude", "gemini"]);
        assert_eq!(
            results[0].conversations[1].url,
            "https://gemini.google.com/app/1"
        );
        assert!(store.add_conversation(id + 100, "claude").is_err());
    }

    #[test]
    fn matches_every_word_across_prompt_titles_and_urls() {
        let store = memory_store();
        save(
            &store,
            "can I use the current cache",
            &[(
                "gemini",
                "Caching Turborepo in GitHub Actions",
                "https://gemini.google.com/app/49",
            )],
        );
        save(&store, "github actions matrix", &[]);

        assert_eq!(
            prompts(&store.search("cache github").unwrap()),
            ["can I use the current cache"]
        );
        assert_eq!(prompts(&store.search("gemini   CACHE").unwrap()).len(), 1);
        assert_eq!(store.search("github").unwrap().len(), 2);
        assert!(store.search("cache matrix").unwrap().is_empty());
    }

    #[test]
    fn ranks_prompt_matches_above_title_and_url_matches() {
        let store = memory_store();
        save(&store, "rust errors in detail", &[]);
        save(&store, "how do I handle rust errors", &[]);
        save(&store, "errors, but in rust", &[]);
        save(
            &store,
            "unrelated question",
            &[("claude", "Rust errors", "https://claude.ai/chat/1")],
        );
        save(
            &store,
            "newest question",
            &[("claude", "", "https://claude.ai/rust/errors")],
        );

        assert_eq!(
            prompts(&store.search("rust errors").unwrap()),
            [
                "how do I handle rust errors",
                "rust errors in detail",
                "errors, but in rust",
                "unrelated question",
                "newest question",
            ]
        );
    }

    #[test]
    fn an_empty_query_lists_recent_prompts_newest_first() {
        let store = memory_store();
        save(&store, "first", &[]);
        save(&store, "second", &[]);

        assert_eq!(prompts(&store.search("  ").unwrap()), ["second", "first"]);
    }

    fn create_legacy_table(connection: &Connection) {
        connection
            .execute_batch(
                "CREATE TABLE prompt_entries (
                    id INTEGER PRIMARY KEY,
                    website_id TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    url TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO prompt_entries (website_id, prompt, url, created_at) VALUES
                    ('gemini', 'Same prompt', 'https://gemini.google.com/app/1', '2026-09-25 10:00:00'),
                    ('chatgpt', 'Same prompt', 'https://chatgpt.com/c/1', '2026-09-25 10:00:02'),
                    ('chatgpt', 'Other prompt', '', '2026-09-25 10:01:00'),
                    ('gemini', 'Same prompt', '', '2026-09-25 11:00:00');",
            )
            .unwrap();
    }

    #[test]
    fn groups_rows_saved_per_provider_by_older_builds() {
        let mut connection = Connection::open_in_memory().unwrap();
        create_legacy_table(&connection);
        initialize(&mut connection).unwrap();
        assert!(!has_table(&connection, "prompt_entries").unwrap());
        let store = SearchStore(Mutex::new(SearchDatabase {
            path: PathBuf::new(),
            connection,
        }));

        let results = store.search("same").unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].created_at, "2026-09-25 11:00:00");
        assert_eq!(results[1].conversations.len(), 2);
        assert_eq!(results[1].conversations[1].url, "https://chatgpt.com/c/1");
        assert_eq!(store.search("other").unwrap().len(), 1);
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
        let id = save(
            &legacy,
            "Older prompt",
            &[("claude", "Older title", "https://claude.ai/chat/123")],
        );
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
        let live_id = save(
            &store,
            "Live prompt",
            &[("chatgpt", "", "https://chatgpt.com/c/1")],
        );
        let other = SearchStore::open(target.clone()).unwrap();
        save(
            &other,
            "Target prompt",
            &[("claude", "", "https://claude.ai/chat/1")],
        );
        drop(other);

        store.move_to(&target).unwrap();
        assert!(!source.join(DATABASE_FILE_NAME).exists());
        assert_eq!(store.search("Live prompt").unwrap()[0].id, live_id);
        let merged = store.search("Target prompt").unwrap();
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].conversations[0].url, "https://claude.ai/chat/1");
        store.add_prompt("After move").unwrap();
        drop(store);
        let reopened = SearchStore::open(target).unwrap();
        assert_eq!(reopened.search("After move").unwrap().len(), 1);
        drop(reopened);
        clean(&root);
    }

    #[test]
    fn moving_onto_a_database_from_an_older_build_groups_its_rows() {
        let root = temp_root();
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        create_legacy_table(&Connection::open(target.join(DATABASE_FILE_NAME)).unwrap());
        let store = SearchStore::open(root.join("source")).unwrap();
        save(&store, "Live prompt", &[]);

        store.move_to(&target).unwrap();
        assert_eq!(store.search("same").unwrap().len(), 2);
        assert_eq!(store.search("Live").unwrap().len(), 1);
        drop(store);
        clean(&root);
    }
}
