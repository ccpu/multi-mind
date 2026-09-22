/**
 * Mirror of the `AppInfo` struct returned by the `app_info` command.
 *
 * The Rust side serialises with `#[serde(rename_all = "camelCase")]`, so the
 * field names here are the camelCase ones that arrive over the bridge. Keep
 * this in sync with `apps/desktop/src-tauri/src/commands.rs`.
 */
export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  /** `windows`, `macos`, `linux`, … - `std::env::consts::OS`. */
  platform: string;
  /** `x86_64`, `aarch64`, … - `std::env::consts::ARCH`. */
  arch: string;
}
