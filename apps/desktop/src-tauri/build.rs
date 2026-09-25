fn main() {
    // Naming the app's own commands here is what puts them under the ACL.
    //
    // Without a manifest, a command is reachable from any local page and from
    // nowhere else. Multi Mind needs one command — `guest_message` — to be
    // callable by a remote page, because that is how an embedded chat site
    // tells the app it was clicked. Declaring the manifest generates an
    // `allow-*` permission per command, and capabilities/guest.json then hands
    // the guests that one and nothing else.
    //
    // The cost is that every other command now needs granting too, which
    // capabilities/default.json does for the app's own windows.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "app_info",
            "new_window",
            "get_settings",
            "save_settings",
            "get_settings_location",
            "set_settings_location",
            "reset_settings_location",
            "get_guest_config",
            "guest_sync",
            "guest_set_visible",
            "guest_navigate",
            "guest_reload",
            "guest_eval",
            "guest_url",
            "guest_cookies",
            "guest_delete_cookies",
            "guest_open_devtools",
            "guest_open_popup",
            "guest_popup_menu",
            "guest_message",
        ]),
    ))
    .expect("failed to run tauri-build");
}
