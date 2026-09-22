//! The app itself. `main.rs` only calls [`run`], so the same entry point works
//! for the desktop binary and for the mobile targets.

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Opens links and files with the OS default handler, so an external
        // link never navigates the app's own webview. What the frontend is
        // allowed to open is set in capabilities/default.json.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::app_info
        ])
        .setup(|_app| {
            // One-off startup work goes here: tray icons, single-instance
            // checks, background tasks. Returning an error aborts the launch.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
