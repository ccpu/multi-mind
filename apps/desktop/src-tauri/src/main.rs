// Keeps a second console window from opening alongside the app on Windows.
// Debug builds keep the console so `println!` and panics stay visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    desktop_lib::run();
}
