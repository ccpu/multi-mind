//! The app itself. `main.rs` only calls [`run`], so the same entry point works
//! for the desktop binary and for the mobile targets.
//!
//! Multi Mind is a row of embedded AI chat sites with the app's own prompt box
//! under them. Almost everything it knows is in `@internal/multi-mind`, which
//! is framework-free and tested; what is left here is the four things only the
//! backend can do — keep the settings file, own the embedded browsers, draw a
//! native menu over one, and look for a new release.

mod commands;
mod guest;
mod identity;
mod menu;
mod settings;
#[cfg(desktop)]
mod updater;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Opens links and files with the OS default handler, so a citation in a
        // chat answer opens in the browser the user actually chose rather than
        // in a bare app window with no address bar. What may be opened is set
        // in capabilities/default.json.
        .plugin(tauri_plugin_opener::init())
        // The folder picker behind Settings → Settings file, and the question
        // the updater puts on a first run.
        .plugin(tauri_plugin_dialog::init())
        // `Copy Link Address` and `Paste` in the right-click menu over a site.
        .plugin(tauri_plugin_clipboard_manager::init())
        // The WinForms build remembered where its window was, and so did the
        // Electron port through `electron-window-toolkit`.
        .plugin(tauri_plugin_window_state::Builder::default().build());

    let builder = configure_desktop(builder);

    builder
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::open_window,
            settings::get_settings,
            settings::save_settings,
            settings::get_settings_location,
            settings::set_settings_location,
            settings::reset_settings_location,
            guest::get_guest_config,
            guest::guest_sync,
            guest::guest_set_visible,
            guest::guest_navigate,
            guest::guest_reload,
            guest::guest_eval,
            guest::guest_url,
            guest::guest_cookies,
            guest::guest_delete_cookies,
            guest::guest_open_devtools,
            guest::guest_open_popup,
            menu::guest_popup_menu,
            guest::guest_message,
        ])
        // A popup menu's selection arrives through the app rather than through
        // the menu that was shown, so the one place it can be answered is here.
        .on_menu_event(|app, event| {
            app.state::<menu::PendingMenu>().resolve(&event);
        })
        /*
         * Three embedded chat sites is three renderers holding decoded images,
         * rasterised tiles and compiled scripts against the next time they are
         * drawn -- which, for a window that has been in the background since
         * lunchtime, is not soon. WebView2 will give that back when it is told
         * the webview is idle, so the window says when it is.
         *
         * Only the main window's own state counts: the browsers are its
         * children, and the settings window coming and going says nothing
         * about whether anyone is reading them.
         */
        .on_window_event(|window, event| {
            if window.label() != guest::MAIN_WINDOW_LABEL {
                return;
            }

            match event {
                tauri::WindowEvent::Focused(focused) => {
                    guest::on_window_focus(window.app_handle(), *focused);
                }
                // Windows reports a minimise as a resize to nothing, and there
                // is no event of its own to listen for.
                tauri::WindowEvent::Resized(_) => {
                    guest::on_window_resized(
                        window.app_handle(),
                        window.is_minimized().unwrap_or(false),
                    );
                }
                _ => {}
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            app.manage(settings::SettingsStore::load(settings::default_directory(
                &handle,
            )));
            app.manage(guest::GuestHost::new(guest::profile_directory(&handle)));
            app.manage(menu::PendingMenu::default());

            #[cfg(desktop)]
            if updater::is_configured(app.config()) {
                updater::check_on_startup(&handle);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Desktop-only wiring, which is most of what makes this a desktop app.
#[cfg(desktop)]
fn configure_desktop<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    let builder = builder
        .plugin(tauri_plugin_process::init())
        /*
         * Every launch of Multi Mind lands in one process.
         *
         * The windows have to share a process because they share their data:
         * the signed-in sites live in one browser profile, and the webview
         * locks that profile's cookie and storage databases to whichever
         * process opened them first. A second process comes up signed out of
         * every site, and both of them writing those files is how a profile
         * gets corrupted.
         *
         * So the first process keeps the lock, and a second launch is answered
         * by raising the window that is already up — an instance in the sense
         * the user means, with the logins still in it.
         */
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window(guest::MAIN_WINDOW_LABEL) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

    // The updater is only registered when there is a key to check signatures
    // against; without one it could not verify what it downloaded, and an
    // unverified installer is worse than no updater. See src/updater.rs.
    builder.plugin(tauri_plugin_updater::Builder::new().build())
}

#[cfg(not(desktop))]
fn configure_desktop<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
}
