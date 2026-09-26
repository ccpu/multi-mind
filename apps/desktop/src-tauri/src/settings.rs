//! Where the settings live, and how they get there.
//!
//! Port of `Multi Mind/Settings.cs` by way of the Electron port's
//! `SettingsStore` module. The WinForms build serialised itself to
//! `settings.xml` beside the executable; writing next to the binary is not an
//! option for a packaged app, so the same values live as JSON under the app's
//! data folder — or wherever the settings window has since pointed them, with a
//! pointer file left behind in the data folder to say where.
//!
//! What this file deliberately does **not** know is what a setting means. The
//! shape of `AppSettings`, its defaults and every rule about it are in
//! `@internal/multi-mind`, where they are tested; here the settings are a JSON
//! object to be merged, written and announced. That is why a patch is applied
//! with a shallow merge and nothing else: the window that sent it has already
//! decided what the result should be.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::search::SearchStore;

/// Name of the settings file itself, matching `SETTINGS_FILE_NAME`.
const SETTINGS_FILE_NAME: &str = "settings.json";

/// Name of the pointer file that outlives a move, matching
/// `SETTINGS_LOCATION_FILE_NAME`.
const SETTINGS_LOCATION_FILE_NAME: &str = "settings-location.json";

/// Broadcast after the settings change, whoever changed them.
pub const SETTINGS_CHANGED_EVENT: &str = "multi-mind://settings-changed";

/// Mirror of `SettingsLocation`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLocation {
    pub directory: String,
    pub file_path: String,
    pub default_directory: String,
    pub is_default: bool,
}

/// Mirror of `SettingsLocationRequest`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLocationRequest {
    /// Create the folder, having asked, rather than answering `missing`.
    #[serde(default)]
    pub create: bool,
    /// `adopt` keeps the settings file already there, `replace` overwrites it.
    #[serde(default)]
    pub conflict: Option<String>,
}

/// Mirror of `SettingsLocationResult`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLocationResult {
    /// One of `ok`, `missing`, `occupied`, `invalid`.
    pub status: String,
    pub directory: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<SettingsLocation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl SettingsLocationResult {
    fn ok(directory: &Path, location: SettingsLocation) -> Self {
        Self {
            status: "ok".into(),
            directory: directory.display().to_string(),
            location: Some(location),
            message: None,
        }
    }

    fn status(status: &str, directory: &Path) -> Self {
        Self {
            status: status.into(),
            directory: directory.display().to_string(),
            location: None,
            message: None,
        }
    }

    fn invalid(directory: &Path, message: impl Into<String>) -> Self {
        Self {
            status: "invalid".into(),
            directory: directory.display().to_string(),
            location: None,
            message: Some(message.into()),
        }
    }
}

pub struct SettingsStore {
    default_directory: PathBuf,
    directory: Mutex<PathBuf>,
    settings: Mutex<Value>,
}

impl SettingsStore {
    /// Reads the settings off disk, following the pointer file if there is one.
    pub fn load(default_directory: PathBuf) -> Self {
        let directory = resolve_directory(&default_directory);
        let settings = read_json(&directory.join(SETTINGS_FILE_NAME))
            .unwrap_or_else(|| Value::Object(Map::new()));

        Self {
            default_directory,
            directory: Mutex::new(directory),
            settings: Mutex::new(settings),
        }
    }

    /// The settings as the windows see them.
    pub fn settings(&self) -> Value {
        self.settings.lock().expect("settings poisoned").clone()
    }

    pub(crate) fn directory(&self) -> PathBuf {
        self.directory.lock().expect("directory poisoned").clone()
    }

    fn file_path(&self) -> PathBuf {
        self.directory().join(SETTINGS_FILE_NAME)
    }

    fn pointer_path(&self) -> PathBuf {
        self.default_directory.join(SETTINGS_LOCATION_FILE_NAME)
    }

    fn location(&self) -> SettingsLocation {
        let directory = self.directory();

        SettingsLocation {
            is_default: directory == self.default_directory,
            file_path: directory.join(SETTINGS_FILE_NAME).display().to_string(),
            default_directory: self.default_directory.display().to_string(),
            directory: directory.display().to_string(),
        }
    }

    /// Merges a patch in, writes the file and tells every window about it.
    ///
    /// Settings are edited in one window and acted on in another, so every
    /// change is saved and then announced to all of them.
    fn commit<R: Runtime>(&self, app: &AppHandle<R>, next: Value) -> Value {
        {
            let mut settings = self.settings.lock().expect("settings poisoned");
            *settings = next;
        }

        let settings = self.settings();
        write_json(&self.file_path(), &settings);

        if let Err(error) = app.emit(SETTINGS_CHANGED_EVENT, &settings) {
            eprintln!("Failed to announce the settings change: {error}");
        }

        settings
    }

    /// Applies a patch from a window, or from the updater asking its question.
    pub fn apply<R: Runtime>(&self, app: &AppHandle<R>, patch: Map<String, Value>) -> Value {
        let mut next = self.settings();

        // A shallow merge on purpose: the window that sent the patch worked out
        // the whole of every field it names — a half-merged site list or a
        // half-merged preset would be a shape nothing could read back.
        if let Some(object) = next.as_object_mut() {
            for (key, value) in patch {
                object.insert(key, value);
            }
        } else {
            next = Value::Object(patch);
        }

        self.commit(app, next)
    }

    /// Port of the Electron store's `#moveTo`.
    ///
    /// Adopting swaps the settings under every window, so the file work is done
    /// first and whatever it adopted is announced the same way an edit would be.
    fn move_to<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        directory: &str,
        request: &SettingsLocationRequest,
    ) -> SettingsLocationResult {
        let search = app.state::<SearchStore>();
        let (result, adopted) = self.relocate(directory, request, Some(&search));

        if let Some(value) = adopted {
            self.commit(app, value);
        }

        result
    }

    /// The whole of a move that touches the disk, split out from the one branch
    /// that needs an app handle so the outcomes can be tested for real.
    ///
    /// Returns the settings to announce when the file already in the folder was
    /// the one kept, and nothing otherwise.
    fn relocate(
        &self,
        directory: &str,
        request: &SettingsLocationRequest,
        search: Option<&SearchStore>,
    ) -> (SettingsLocationResult, Option<Value>) {
        let resolved = PathBuf::from(directory.trim());
        let target = resolved.join(SETTINGS_FILE_NAME);

        match fs::metadata(&resolved) {
            Ok(metadata) if !metadata.is_dir() => {
                return (
                    SettingsLocationResult::invalid(
                        &resolved,
                        "That path is a file, not a folder.",
                    ),
                    None,
                );
            }
            Ok(_) => {}
            Err(_) => {
                if !request.create {
                    return (SettingsLocationResult::status("missing", &resolved), None);
                }

                if let Err(error) = fs::create_dir_all(&resolved) {
                    return (
                        SettingsLocationResult::invalid(
                            &resolved,
                            format!("The folder could not be created: {error}"),
                        ),
                        None,
                    );
                }
            }
        }

        if !is_writable(&resolved) {
            return (
                SettingsLocationResult::invalid(&resolved, "That folder cannot be written to."),
                None,
            );
        }

        // Already there: nothing to move, and nothing to ask about.
        if resolved == self.directory() {
            return (SettingsLocationResult::ok(&resolved, self.location()), None);
        }

        // Which of the two settings files wins is the user's call, never a
        // quiet one.
        let occupied = target.exists();
        if occupied && request.conflict.is_none() {
            return (SettingsLocationResult::status("occupied", &resolved), None);
        }

        let previous_path = self.file_path();
        let adopt = occupied && request.conflict.as_deref() == Some("adopt");
        let replaced_settings = if occupied && !adopt {
            match fs::read(&target) {
                Ok(bytes) => Some(bytes),
                Err(error) => {
                    return (
                        SettingsLocationResult::invalid(
                            &resolved,
                            format!(
                                "The settings file already there could not be backed up: {error}"
                            ),
                        ),
                        None,
                    );
                }
            }
        } else {
            None
        };

        let adopted = if adopt {
            match read_json(&target) {
                Some(value) => Some(value),
                None => {
                    return (
                        SettingsLocationResult::invalid(
                            &resolved,
                            "The settings file already there could not be read.",
                        ),
                        None,
                    );
                }
            }
        } else {
            if let Err(error) = fs::write(&target, serialize(&self.settings())) {
                return (
                    SettingsLocationResult::invalid(
                        &resolved,
                        format!("The settings file could not be written there: {error}"),
                    ),
                    None,
                );
            }

            None
        };

        if let Some(search) = search {
            if let Err(error) = search.move_to(&resolved) {
                let rollback = if adopt {
                    Ok(())
                } else {
                    if let Some(bytes) = replaced_settings {
                        fs::write(&target, bytes)
                    } else {
                        fs::remove_file(&target)
                    }
                };
                let message = match rollback {
                    Ok(()) => format!("The search database could not be moved: {error}"),
                    Err(rollback_error) => format!(
                        "The search database could not be moved: {error}; the target settings file could not be restored: {rollback_error}"
                    ),
                };
                return (SettingsLocationResult::invalid(&resolved, message), None);
            }
        }

        {
            let mut current = self.directory.lock().expect("directory poisoned");
            *current = resolved.clone();
        }
        self.remember_directory();

        // The copy is what matters; failing to tidy the old one is not worth
        // undoing the move over.
        if let Err(error) = fs::remove_file(&previous_path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!("Failed to remove the old settings file: {error}");
            }
        }

        (
            SettingsLocationResult::ok(&resolved, self.location()),
            adopted,
        )
    }

    /// Writes, or clears, the pointer file that outlives a move.
    fn remember_directory(&self) {
        let pointer = self.pointer_path();
        let directory = self.directory();

        if directory == self.default_directory {
            if let Err(error) = fs::remove_file(&pointer) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("Failed to clear the settings location: {error}");
                }
            }

            return;
        }

        let value = serde_json::json!({ "directory": directory.display().to_string() });

        if let Err(error) = fs::write(&pointer, serialize(&value)) {
            eprintln!("Failed to record the settings location: {error}");
        }
    }
}

/// Reads the pointer file left in the data folder. A folder that has since gone
/// away — an unplugged drive, a deleted sync folder — falls back to the default
/// rather than leaving the app unable to save.
fn resolve_directory(default_directory: &Path) -> PathBuf {
    let pointer = default_directory.join(SETTINGS_LOCATION_FILE_NAME);

    let Some(stored) = read_json(&pointer) else {
        return default_directory.to_path_buf();
    };

    let Some(directory) = stored.get("directory").and_then(Value::as_str) else {
        return default_directory.to_path_buf();
    };

    let directory = PathBuf::from(directory);

    if is_writable(&directory) {
        directory
    } else {
        eprintln!(
            "The settings folder \"{}\" is not available; falling back to the default.",
            directory.display()
        );
        default_directory.to_path_buf()
    }
}

/// Whether a folder is there and can be written to.
///
/// There is no portable permission bit to read, so this asks the only question
/// that matters by trying it: a file created and removed again.
fn is_writable(directory: &Path) -> bool {
    if !directory.is_dir() {
        return false;
    }

    let probe = directory.join(".multi-mind-write-test");

    match fs::write(&probe, b"") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn read_json(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;

    match serde_json::from_str(&text) {
        Ok(value) => Some(value),
        Err(error) => {
            eprintln!("Failed to read \"{}\": {error}", path.display());
            None
        }
    }
}

fn write_json(path: &Path, value: &Value) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Err(error) = fs::write(path, serialize(value)) {
        eprintln!("Failed to save settings: {error}");
    }
}

fn serialize(value: &Value) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into())
    )
}

/// The app's own data folder, which is where the settings file lives by default.
pub fn default_directory<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> Value {
    store.settings()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    patch: HashMap<String, Value>,
) -> Value {
    store.apply(&app, patch.into_iter().collect())
}

#[tauri::command]
pub fn get_settings_location(store: State<'_, SettingsStore>) -> SettingsLocation {
    store.location()
}

#[tauri::command]
pub fn set_settings_location(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    directory: String,
    request: Option<SettingsLocationRequest>,
) -> SettingsLocationResult {
    store.move_to(&app, &directory, &request.unwrap_or_default())
}

#[tauri::command]
pub fn reset_settings_location(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    request: Option<SettingsLocationRequest>,
) -> SettingsLocationResult {
    // Going home always creates the folder: it is the app's own, and refusing
    // to go back because it has been deleted would leave nowhere to save.
    let mut request = request.unwrap_or_default();
    request.create = true;

    let directory = store.default_directory.display().to_string();

    store.move_to(&app, &directory, &request)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("multi-mind-{name}"));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("temp dir");
        directory
    }

    #[test]
    fn starts_empty_when_there_is_no_settings_file() {
        let store = SettingsStore::load(temp_dir("empty"));

        assert_eq!(store.settings(), Value::Object(Map::new()));
    }

    #[test]
    fn reads_back_what_was_written() {
        let directory = temp_dir("read-back");
        fs::write(
            directory.join(SETTINGS_FILE_NAME),
            r#"{ "panelButtonSize": 40 }"#,
        )
        .expect("write settings");

        let store = SettingsStore::load(directory);

        assert_eq!(store.settings()["panelButtonSize"], 40);
    }

    #[test]
    fn follows_the_pointer_file_to_another_folder() {
        let home = temp_dir("pointer-home");
        let elsewhere = temp_dir("pointer-elsewhere");

        fs::write(
            home.join(SETTINGS_LOCATION_FILE_NAME),
            serde_json::json!({ "directory": elsewhere.display().to_string() }).to_string(),
        )
        .expect("write pointer");
        fs::write(
            elsewhere.join(SETTINGS_FILE_NAME),
            r#"{ "autoShrink": false }"#,
        )
        .expect("write settings");

        let store = SettingsStore::load(home);

        assert_eq!(store.settings()["autoShrink"], false);
    }

    /*
     * An unplugged drive or a deleted sync folder must not leave the app unable
     * to save; it falls back to the folder that cannot go away.
     */
    #[test]
    fn falls_back_when_the_pointed_at_folder_is_gone() {
        let home = temp_dir("pointer-missing");
        let gone = std::env::temp_dir().join("multi-mind-does-not-exist");

        fs::write(
            home.join(SETTINGS_LOCATION_FILE_NAME),
            serde_json::json!({ "directory": gone.display().to_string() }).to_string(),
        )
        .expect("write pointer");

        let store = SettingsStore::load(home.clone());

        assert_eq!(store.directory(), home);
    }

    /// A store holding one telltale setting, so a move can be told apart from
    /// the settings that were already in the folder it moved to.
    fn store_holding(name: &str, marker: &str) -> SettingsStore {
        let directory = temp_dir(name);
        fs::write(
            directory.join(SETTINGS_FILE_NAME),
            format!(r#"{{ "marker": "{marker}" }}"#),
        )
        .expect("write settings");

        SettingsStore::load(directory)
    }

    fn marker_of(value: &Value) -> Option<String> {
        Some(value.get("marker")?.as_str()?.to_owned())
    }

    fn conflict(choice: &str) -> SettingsLocationRequest {
        SettingsLocationRequest {
            create: false,
            conflict: Some(choice.into()),
        }
    }

    #[test]
    fn a_missing_folder_is_reported_rather_than_created_behind_the_users_back() {
        let store = SettingsStore::load(temp_dir("move-missing"));
        let target = std::env::temp_dir().join("multi-mind-not-there-yet");
        let _ = fs::remove_dir_all(&target);

        let (result, adopted) =
            store.relocate(&target.display().to_string(), &Default::default(), None);

        assert_eq!(result.status, "missing");
        assert!(adopted.is_none());
        assert!(!target.exists());
    }

    #[test]
    fn a_folder_that_already_holds_settings_is_reported_rather_than_overwritten() {
        let store = store_holding("move-occupied", "mine");
        let target = temp_dir("move-occupied-target");
        let target_file = target.join(SETTINGS_FILE_NAME);
        fs::write(&target_file, r#"{ "marker": "theirs" }"#).expect("write settings");

        let (result, adopted) =
            store.relocate(&target.display().to_string(), &Default::default(), None);

        assert_eq!(result.status, "occupied");
        assert!(adopted.is_none());
        // Neither side has been touched while the question is still open.
        assert_eq!(marker_of(&store.settings()).as_deref(), Some("mine"));
        assert_eq!(
            marker_of(&read_json(&target_file).expect("settings")).as_deref(),
            Some("theirs")
        );
    }

    #[test]
    fn adopting_keeps_the_settings_file_already_in_the_folder() {
        let store = store_holding("move-adopt", "mine");
        let previous_file = store.file_path();
        let target = temp_dir("move-adopt-target");
        let target_file = target.join(SETTINGS_FILE_NAME);
        fs::write(&target_file, r#"{ "marker": "theirs" }"#).expect("write settings");

        let (result, adopted) =
            store.relocate(&target.display().to_string(), &conflict("adopt"), None);

        assert_eq!(result.status, "ok");
        // The settings that were there are what every window is told about.
        assert_eq!(
            marker_of(&adopted.expect("adopted settings")).as_deref(),
            Some("theirs")
        );
        assert_eq!(
            marker_of(&read_json(&target_file).expect("settings")).as_deref(),
            Some("theirs")
        );
        assert_eq!(store.directory(), target);
        assert!(!previous_file.exists());
    }

    #[test]
    fn replacing_writes_the_settings_in_use_over_the_one_already_there() {
        let store = store_holding("move-replace", "mine");
        let previous_file = store.file_path();
        let target = temp_dir("move-replace-target");
        let target_file = target.join(SETTINGS_FILE_NAME);
        fs::write(&target_file, r#"{ "marker": "theirs" }"#).expect("write settings");

        let (result, adopted) =
            store.relocate(&target.display().to_string(), &conflict("replace"), None);

        assert_eq!(result.status, "ok");
        // Nothing to announce: the settings in use are the ones that survived.
        assert!(adopted.is_none());
        assert_eq!(
            marker_of(&read_json(&target_file).expect("settings")).as_deref(),
            Some("mine")
        );
        assert_eq!(marker_of(&store.settings()).as_deref(), Some("mine"));
        assert_eq!(store.directory(), target);
        assert!(!previous_file.exists());
    }

    #[test]
    fn a_move_leaves_a_pointer_file_behind_and_clears_it_on_the_way_back() {
        let store = store_holding("move-pointer", "mine");
        let default_directory = store.default_directory.clone();
        let target = temp_dir("move-pointer-target");

        let (result, _) = store.relocate(&target.display().to_string(), &Default::default(), None);
        assert_eq!(result.status, "ok");

        let pointer = default_directory.join(SETTINGS_LOCATION_FILE_NAME);
        assert_eq!(
            read_json(&pointer)
                .and_then(|value| Some(value.get("directory")?.as_str()?.to_owned())),
            Some(target.display().to_string())
        );

        let (back, _) = store.relocate(
            &default_directory.display().to_string(),
            &Default::default(),
            None,
        );
        assert_eq!(back.status, "ok");
        assert!(!pointer.exists());
    }

    #[test]
    fn moving_settings_moves_the_search_database_with_them() {
        let store = store_holding("move-search", "mine");
        let source = store.directory().join("search.sqlite3");
        let search = SearchStore::open(store.directory()).unwrap();
        let connection = rusqlite::Connection::open(&source).unwrap();
        connection
            .execute(
                "INSERT INTO prompts (prompt) VALUES (?1)",
                rusqlite::params!["Keep this prompt"],
            )
            .unwrap();
        drop(connection);
        let target = temp_dir("move-search-target");

        let (result, _) = store.relocate(
            &target.display().to_string(),
            &Default::default(),
            Some(&search),
        );

        assert_eq!(result.status, "ok");
        assert!(!source.exists());
        let moved = rusqlite::Connection::open(target.join("search.sqlite3")).unwrap();
        let count: i64 = moved
            .query_row(
                "SELECT COUNT(*) FROM prompts WHERE prompt = 'Keep this prompt'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn a_failed_database_move_keeps_the_current_settings_location() {
        let store = store_holding("move-search-failure", "mine");
        let current = store.directory();
        let search = SearchStore::open(current.clone()).unwrap();
        let target = temp_dir("move-search-failure-target");
        fs::write(target.join("search.sqlite3"), b"not a database").unwrap();

        let (result, adopted) = store.relocate(
            &target.display().to_string(),
            &Default::default(),
            Some(&search),
        );

        assert_eq!(result.status, "invalid");
        assert!(adopted.is_none());
        assert_eq!(store.directory(), current);
        assert!(current.join("search.sqlite3").exists());
        assert!(!target.join(SETTINGS_FILE_NAME).exists());
    }
}
