//! Persistent prompt and conversation index. Only local main windows can call
//! these commands; guest pages report metadata through the existing bridge.
//!
//! Each submission is one `prompts` row, and each provider that accepted it is
//! one `conversations` row, so a prompt sent to several providers is saved
//! once, with every conversation it started. Search lists chats: prompts that
//! continued the same conversations are found and listed together, by the
//! first of them.

use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use tauri::State;
use url::Url;

const DATABASE_FILE_NAME: &str = "search.sqlite3";
/// Chats listed while the search box is empty.
const RECENT_LIMIT: usize = 20;
/// Newest matches that are ranked; older ones are left out.
const CANDIDATE_LIMIT: usize = 300;
const RESULT_LIMIT: usize = 50;
/// Words beyond this many are ignored rather than widening the query.
const MAX_TERMS: usize = 8;
/// Rows of the per-provider schema sent this close to the first row with the
/// same prompt are taken to be one submission when they are grouped.
const LEGACY_GROUP_SECONDS: i64 = 60;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConversation {
    id: i64,
    website_id: String,
    title: String,
    url: String,
}

/// One chat, listed by its first prompt, with the latest conversation it has
/// on each provider.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEntry {
    /// The first prompt's row ID.
    id: i64,
    /// A page title captured on one of the chat's conversations, or empty.
    title: String,
    /// The first prompt sent in the chat.
    prompt: String,
    /// A later prompt that matches the search better than the first one.
    #[serde(skip_serializing_if = "Option::is_none")]
    matched_prompt: Option<String>,
    /// When the latest prompt was sent, as a SQLite UTC timestamp,
    /// `YYYY-MM-DD HH:MM:SS`.
    updated_at: String,
    conversations: Vec<SearchConversation>,
}

/// Every saved prompt, oldest first and without its text, grouped into chats.
struct History {
    /// `(id, created_at)` of each prompt.
    prompts: Vec<(i64, String)>,
    /// Each prompt's conversations, by position in `prompts`.
    conversations: Vec<Vec<SearchConversation>>,
    /// Each chat's prompt positions, oldest first; the latest chat comes first.
    chats: Vec<Vec<usize>>,
    /// Each chat's title, by position in `chats`.
    titles: Vec<String>,
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

    /// Every word must appear in one of a chat's prompts or in one of its
    /// conversation titles or URLs. Results are ranked by where the words were
    /// found, latest chat first within a rank; an empty query lists the most
    /// recent chats.
    fn search(&self, query: &str) -> Result<Vec<SearchEntry>, String> {
        let database = self.0.lock().map_err(|error| error.to_string())?;
        let connection = &database.connection;
        let history = load_history(connection)?;
        let terms = search_terms(query);
        if terms.is_empty() {
            return (0..history.chats.len().min(RECENT_LIMIT))
                .map(|index| {
                    let first = history.prompts[history.chats[index][0]].0;
                    Ok(history.entry(index, prompt_text(connection, first)?, None))
                })
                .collect();
        }

        // The prompts holding each word, matched in SQLite so their text
        // is only read for the chats that hold every word.
        let mut statement = connection
            .prepare_cached("SELECT id FROM prompts WHERE prompt LIKE ?1 ESCAPE '\\'")
            .map_err(|error| error.to_string())?;
        let matches = terms
            .iter()
            .map(|term| {
                statement
                    .query_map(params![like_pattern(term)], |row| row.get::<_, i64>(0))?
                    .collect::<Result<HashSet<_>, _>>()
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        let phrase = normalize(query);
        let mut ranked = Vec::new();
        for (index, chat) in history.chats.iter().enumerate() {
            let conversations = chat
                .iter()
                .flat_map(|&position| &history.conversations[position])
                .collect::<Vec<_>>();
            let titles = conversations
                .iter()
                .map(|conversation| conversation.title.to_lowercase())
                .collect::<Vec<_>>();
            let urls = conversations
                .iter()
                .map(|conversation| conversation.url.to_lowercase())
                .collect::<Vec<_>>();
            let found = terms.iter().zip(&matches).all(|(term, ids)| {
                chat.iter()
                    .any(|&position| ids.contains(&history.prompts[position].0))
                    || titles
                        .iter()
                        .chain(&urls)
                        .any(|text| text.contains(term.as_str()))
            });
            if !found {
                continue;
            }

            let mut prompts = chat
                .iter()
                .map(|&position| prompt_text(connection, history.prompts[position].0))
                .collect::<Result<Vec<_>, _>>()?;
            let (order, best) = rank(&prompts, &titles, &phrase, &terms);
            let matched_prompt = best.map(|position| std::mem::take(&mut prompts[position]));
            let first = prompts.swap_remove(0);
            ranked.push((order, history.entry(index, first, matched_prompt)));
            if ranked.len() == CANDIDATE_LIMIT {
                break;
            }
        }
        // Stable, so each rank keeps the latest-first order of the chats.
        ranked.sort_by_key(|(order, _)| Reverse(*order));
        Ok(ranked
            .into_iter()
            .take(RESULT_LIMIT)
            .map(|(_, entry)| entry)
            .collect())
    }
}

impl History {
    fn entry(&self, index: usize, prompt: String, matched_prompt: Option<String>) -> SearchEntry {
        let chat = &self.chats[index];
        let latest = chat[chat.len() - 1];
        SearchEntry {
            id: self.prompts[chat[0]].0,
            title: self.titles[index].clone(),
            prompt,
            matched_prompt,
            updated_at: self.prompts[latest].1.clone(),
            conversations: latest_conversations(chat, &self.conversations),
        }
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

/// Ranks a chat holding every word, given its prompts and lowercased titles.
/// 3: a prompt holds the query as typed. 2: a prompt holds every word.
/// 1: every word is in a prompt or a conversation title. 0: a URL was needed.
///
/// Also returns the earliest prompt that matches best, when that is a later
/// one than the first.
fn rank(
    prompts: &[String],
    titles: &[String],
    phrase: &str,
    terms: &[String],
) -> (u8, Option<usize>) {
    let prompts = prompts
        .iter()
        .map(|prompt| normalize(prompt))
        .collect::<Vec<_>>();
    let scores = prompts
        .iter()
        .map(|prompt| {
            let words = terms
                .iter()
                .filter(|term| prompt.contains(term.as_str()))
                .count();
            (prompt.contains(phrase), words)
        })
        .collect::<Vec<_>>();
    // The last of equal maximums, so the earliest prompt when counting down.
    let best = (0..scores.len())
        .rev()
        .max_by_key(|&position| scores[position]);

    let in_text = |term: &String| {
        prompts
            .iter()
            .chain(titles)
            .any(|text| text.contains(term.as_str()))
    };
    let order = if scores.iter().any(|(phrase, _)| *phrase) {
        3
    } else if scores.iter().any(|(_, words)| *words == terms.len()) {
        2
    } else if terms.iter().all(in_text) {
        1
    } else {
        0
    };
    (order, best.filter(|&position| position > 0))
}

fn prompt_text(connection: &Connection, id: i64) -> Result<String, String> {
    connection
        .prepare_cached("SELECT prompt FROM prompts WHERE id = ?1")
        .map_err(|error| error.to_string())?
        .query_row(params![id], |row| row.get(0))
        .map_err(|error| error.to_string())
}

/// Reads every prompt's age and conversations, without the prompt text, and
/// groups them into chats.
fn load_history(connection: &Connection) -> Result<History, String> {
    let prompts = connection
        .prepare_cached("SELECT id, created_at FROM prompts ORDER BY created_at, id")
        .map_err(|error| error.to_string())?
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let positions = prompts
        .iter()
        .enumerate()
        .map(|(position, (id, _))| (*id, position))
        .collect::<HashMap<_, _>>();

    let mut conversations = vec![Vec::new(); prompts.len()];
    let rows = connection
        .prepare_cached(
            "SELECT id, prompt_id, website_id, title, url FROM conversations ORDER BY id",
        )
        .map_err(|error| error.to_string())?
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(1)?,
                SearchConversation {
                    id: row.get(0)?,
                    website_id: row.get(2)?,
                    title: row.get(3)?,
                    url: row.get(4)?,
                },
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for (prompt_id, conversation) in rows {
        if let Some(&position) = positions.get(&prompt_id) {
            conversations[position].push(conversation);
        }
    }

    let chats = group_chats(&conversations);
    let titles = chat_titles(&chats, &conversations);
    Ok(History {
        prompts,
        conversations,
        chats,
        titles,
    })
}

/// Groups prompts, given oldest first, into chats, latest chat first. A prompt
/// continues an earlier one when one of its conversations has the same address
/// on the same provider — unless the two have different addresses on another
/// provider, as two chats do on a provider that keeps one address for all.
fn group_chats(conversations: &[Vec<SearchConversation>]) -> Vec<Vec<usize>> {
    let mut parent = (0..conversations.len()).collect::<Vec<_>>();
    // Each group's address on each provider, kept on its root.
    let mut addresses = conversations
        .iter()
        .map(|items| {
            items
                .iter()
                .filter(|conversation| !conversation.url.is_empty())
                .map(|conversation| (conversation.website_id.as_str(), conversation.url.as_str()))
                .collect::<HashMap<_, _>>()
        })
        .collect::<Vec<_>>();
    // The latest prompt with each address on each provider.
    let mut owners = HashMap::new();
    for (position, items) in conversations.iter().enumerate() {
        for conversation in items
            .iter()
            .filter(|conversation| !conversation.url.is_empty())
        {
            let key = (conversation.website_id.as_str(), conversation.url.as_str());
            if let Some(owner) = owners.insert(key, position) {
                join(&mut parent, &mut addresses, owner, position);
            }
        }
    }

    let mut chats: Vec<Vec<usize>> = Vec::new();
    let mut indexes = HashMap::new();
    for position in 0..conversations.len() {
        let root = find(&mut parent, position);
        let index = *indexes.entry(root).or_insert_with(|| {
            chats.push(Vec::new());
            chats.len() - 1
        });
        chats[index].push(position);
    }
    chats.sort_by_key(|chat| Reverse(chat.last().copied()));
    chats
}

fn find(parent: &mut [usize], mut position: usize) -> usize {
    while parent[position] != position {
        parent[position] = parent[parent[position]];
        position = parent[position];
    }
    position
}

/// Joins the groups of two prompts unless they have different addresses on
/// one provider.
fn join(parent: &mut [usize], addresses: &mut [HashMap<&str, &str>], a: usize, b: usize) {
    let (mut a, mut b) = (find(parent, a), find(parent, b));
    if a == b {
        return;
    }
    if addresses[a].len() < addresses[b].len() {
        std::mem::swap(&mut a, &mut b);
    }
    let conflict = addresses[b]
        .iter()
        .any(|(website, url)| addresses[a].get(website).is_some_and(|other| other != url));
    if conflict {
        return;
    }
    let moved = std::mem::take(&mut addresses[b]);
    addresses[a].extend(moved);
    parent[b] = a;
}

/// The latest title captured on each chat's conversations. A title that more
/// than one chat carries on a provider, such as the provider's own name, says
/// nothing about the chat and is passed over.
fn chat_titles(chats: &[Vec<usize>], conversations: &[Vec<SearchConversation>]) -> Vec<String> {
    let mut owners = HashMap::new();
    let mut generic = HashSet::new();
    for (index, chat) in chats.iter().enumerate() {
        for conversation in chat.iter().flat_map(|&position| &conversations[position]) {
            if conversation.title.is_empty() {
                continue;
            }
            let key = (
                conversation.website_id.as_str(),
                conversation.title.as_str(),
            );
            if *owners.entry(key).or_insert(index) != index {
                generic.insert(key);
            }
        }
    }
    chats
        .iter()
        .map(|chat| {
            chat.iter()
                .rev()
                .flat_map(|&position| &conversations[position])
                .find(|conversation| {
                    !conversation.title.is_empty()
                        && !generic.contains(&(
                            conversation.website_id.as_str(),
                            conversation.title.as_str(),
                        ))
                })
                .map(|conversation| conversation.title.clone())
                .unwrap_or_default()
        })
        .collect()
}

/// The latest conversation on each provider in a chat, passing over one that
/// never got an address for an earlier one that did.
fn latest_conversations(
    chat: &[usize],
    conversations: &[Vec<SearchConversation>],
) -> Vec<SearchConversation> {
    let mut latest: Vec<SearchConversation> = Vec::new();
    for conversation in chat
        .iter()
        .rev()
        .flat_map(|&position| &conversations[position])
    {
        match latest
            .iter_mut()
            .find(|item| item.website_id == conversation.website_id)
        {
            Some(item) if item.url.is_empty() && !conversation.url.is_empty() => {
                *item = conversation.clone();
            }
            Some(_) => {}
            None => latest.push(conversation.clone()),
        }
    }
    latest
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

    #[test]
    fn lists_follow_up_prompts_as_one_chat_by_its_first_prompt_and_title() {
        let store = memory_store();
        let first = save(
            &store,
            "How do I cache turbo?",
            &[
                ("claude", "Claude", "https://claude.ai/chat/1"),
                ("chatgpt", "ChatGPT", "https://chatgpt.com/c/9"),
            ],
        );
        save(
            &store,
            "Something else",
            &[("claude", "Claude", "https://claude.ai/chat/2")],
        );
        save(
            &store,
            "And in GitHub Actions?",
            &[
                (
                    "claude",
                    "Turbo caching - Claude",
                    "https://claude.ai/chat/1",
                ),
                ("chatgpt", "Turbo cache", "https://chatgpt.com/c/9"),
            ],
        );

        let recent = store.search("").unwrap();
        assert_eq!(
            prompts(&recent),
            ["How do I cache turbo?", "Something else"]
        );
        assert_eq!(recent[0].id, first);
        assert_eq!(recent[0].title, "Turbo caching - Claude");
        let urls = recent[0]
            .conversations
            .iter()
            .map(|conversation| conversation.url.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            urls,
            ["https://claude.ai/chat/1", "https://chatgpt.com/c/9"]
        );
        // "Claude" names more than one chat, so it is no chat's title.
        assert_eq!(recent[1].title, "");

        let found = store.search("github").unwrap();
        assert_eq!(prompts(&found), ["How do I cache turbo?"]);
        assert_eq!(
            found[0].matched_prompt.as_deref(),
            Some("And in GitHub Actions?")
        );
        assert_eq!(store.search("cache").unwrap()[0].matched_prompt, None);
        assert_eq!(store.search("turbo github").unwrap().len(), 1);
    }

    #[test]
    fn keeps_chats_apart_that_share_an_address_on_only_one_provider() {
        let store = memory_store();
        save(
            &store,
            "first chat",
            &[
                ("grok", "", "https://x.com/i/grok"),
                ("claude", "", "https://claude.ai/chat/1"),
            ],
        );
        save(
            &store,
            "second chat",
            &[
                ("grok", "", "https://x.com/i/grok"),
                ("claude", "", "https://claude.ai/chat/2"),
            ],
        );
        save(
            &store,
            "second chat, continued",
            &[
                ("grok", "", "https://x.com/i/grok"),
                ("claude", "", "https://claude.ai/chat/2"),
            ],
        );

        assert_eq!(
            prompts(&store.search("").unwrap()),
            ["second chat", "first chat"]
        );
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
        assert_eq!(results[0].updated_at, "2026-09-25 11:00:00");
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
