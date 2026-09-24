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

use tauri::{Listener, Manager};

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
            commands::new_window,
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
         * the webview is idle, so each window says when it is.
         *
         * Only a main window's own state counts: the browsers are its
         * children, and the settings window coming and going says nothing
         * about whether anyone is reading them. Every main window is asked
         * separately, so a second one left behind gives its memory back while
         * the one in front keeps its caches.
         */
        .on_window_event(|window, event| {
            let label = window.label();

            if !guest::is_main_window_label(label) {
                return;
            }

            match event {
                tauri::WindowEvent::Focused(focused) => {
                    guest::on_window_focus(window.app_handle(), label, *focused);
                }
                // Windows reports a minimise as a resize to nothing, and there
                // is no event of its own to listen for.
                tauri::WindowEvent::Resized(_) => {
                    guest::on_window_resized(
                        window.app_handle(),
                        label,
                        window.is_minimized().unwrap_or(false),
                    );
                }
                // A window closing takes its browsers with it, so what the app
                // remembered about its row goes too -- otherwise opening and
                // closing windows all day would leave a row's worth of
                // injected scripts behind for each one.
                tauri::WindowEvent::Destroyed => {
                    guest::on_window_closed(window.app_handle(), label);
                }
                _ => {}
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            let settings_store =
                settings::SettingsStore::load(settings::default_directory(&handle));
            let saved_settings = settings_store.settings();

            app.manage(settings_store);
            app.manage(guest::MemoryTargetPolicy::from_settings(&saved_settings));
            #[cfg(windows)]
            app.manage(guest::BrowserArguments::from_settings(&saved_settings));
            app.manage(guest::GuestHost::new(guest::profile_directory(&handle)));
            app.manage(menu::PendingMenu::default());

            let memory_handle = handle.clone();
            handle.listen(settings::SETTINGS_CHANGED_EVENT, move |event| {
                let Ok(settings) = serde_json::from_str::<serde_json::Value>(event.payload())
                else {
                    return;
                };

                guest::on_memory_settings_changed(&memory_handle, &settings);
            });

            commands::open_main_window(&handle, None)?;

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
         * Every launch of Multi Mind lands in one process, and every launch
         * after the first opens another window in it.
         *
         * The windows have to share a process because they share their data:
         * the signed-in sites live in one browser profile, and the webview
         * locks that profile's cookie and storage databases to whichever
         * process opened them first. A second process comes up signed out of
         * every site, and both of them writing those files is how a profile
         * gets corrupted.
         *
         * So the first process keeps the lock and answers the second launch
         * with a window of its own -- as many as are asked for, each with the
         * logins already in it, and all of them sharing one browser process
         * rather than starting a second set of renderers. It is an instance in
         * the sense the user means.
         */
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Somewhere to cascade the new window from, if a window is up.
            let near = app
                .windows()
                .into_iter()
                .find(|(label, _)| guest::is_main_window_label(label))
                .map(|(_, window)| window);

            if let Err(error) = commands::open_main_window(app, near.as_ref()) {
                eprintln!("Failed to answer a second launch with a window: {error}");

                // Better a raised window than nothing at all.
                if let Some(window) = near {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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
