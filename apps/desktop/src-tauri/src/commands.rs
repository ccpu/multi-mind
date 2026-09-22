//! Commands the frontend may call through `invoke`.
//!
//! Each one is registered in `generate_handler!` in `lib.rs` and wrapped, with
//! its return type, in the `@internal/tauri-api` package. Keep the two in sync:
//! the bridge is a string-keyed call, so nothing else will catch a rename.

use serde::Serialize;
// `package_info` comes from the Manager trait, which has to be in scope.
use tauri::Manager;

/// Returned by [`app_info`]. Serialised as camelCase to match the TypeScript
/// interface in `packages/tauri-api/src/types.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub platform: String,
    pub arch: String,
}

/// Build a greeting for `name`.
#[tauri::command]
pub fn greet(name: &str) -> String {
    let name = name.trim();

    if name.is_empty() {
        "Hello there! This greeting came from Rust.".to_string()
    } else {
        format!("Hello, {name}! This greeting came from Rust.")
    }
}

/// Report what the app is and where it is running.
#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    let package_info = app.package_info();

    AppInfo {
        name: package_info.name.clone(),
        version: package_info.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greets_by_name() {
        assert_eq!(greet("Ada"), "Hello, Ada! This greeting came from Rust.");
    }

    #[test]
    fn trims_the_name() {
        assert_eq!(
            greet("  Ada  "),
            "Hello, Ada! This greeting came from Rust."
        );
    }

    #[test]
    fn falls_back_when_the_name_is_blank() {
        assert_eq!(greet("   "), "Hello there! This greeting came from Rust.");
    }

    #[test]
    fn app_info_serialises_as_camel_case() {
        let info = AppInfo {
            name: "Tauri Template".to_string(),
            version: "0.1.0".to_string(),
            tauri_version: "2.0.0".to_string(),
            platform: "linux".to_string(),
            arch: "x86_64".to_string(),
        };

        let json = serde_json::to_value(&info).expect("AppInfo should serialise");

        assert!(json.get("tauriVersion").is_some());
        assert!(json.get("tauri_version").is_none());
    }
}
