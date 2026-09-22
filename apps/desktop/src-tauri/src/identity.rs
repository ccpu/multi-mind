//! What an embedded chat site sees when it asks which browser it is in.
//!
//! The Electron port dressed every guest in a Chrome user agent carrying the
//! Chromium version Electron really shipped. It could do that everywhere,
//! because Electron is Chromium everywhere.
//!
//! Tauri is the system webview, which is Chromium on Windows and WebKit
//! elsewhere, so the same rule leads somewhere different: report the engine you
//! actually are. On Windows that means a Chrome user agent naming the real
//! WebView2 version — the sites run Chromium checks and a page can read
//! `navigator.userAgentData` to catch a lie. On macOS and Linux it means
//! leaving WebKit's own user agent alone, because claiming Chrome there would
//! contradict everything else the page can measure, which is a louder signal
//! than not dressing up at all.

/// Chrome freezes the macOS token at 10_15_7, on Apple Silicon included; the
/// Windows one has not moved since Windows 10.
const WINDOWS_PLATFORM_TOKEN: &str = "Windows NT 10.0; Win64; x64";

/// Builds a Chrome user agent that truthfully reports the webview's version.
fn chrome_user_agent(chrome_version: &str) -> String {
    format!(
        "Mozilla/5.0 ({WINDOWS_PLATFORM_TOKEN}) AppleWebKit/537.36 (KHTML, like Gecko) \
         Chrome/{chrome_version} Safari/537.36"
    )
}

/// A version string is only usable if it looks like one Chrome would print.
fn is_chrome_version(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();

    parts.len() == 4
        && parts.iter().all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
}

/// The user agent every guest webview is given, or `None` to keep the
/// platform's own.
pub fn guest_user_agent() -> Option<String> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    let version = tauri::webview_version().ok()?;

    is_chrome_version(&version).then(|| chrome_user_agent(&version))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_chrome_user_agent_around_the_real_version() {
        let agent = chrome_user_agent("131.0.2903.86");

        assert!(agent.contains("Chrome/131.0.2903.86"));
        assert!(agent.starts_with("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"));
        assert!(agent.ends_with("Safari/537.36"));
    }

    #[test]
    fn accepts_only_a_four_part_numeric_version() {
        assert!(is_chrome_version("131.0.2903.86"));
        assert!(!is_chrome_version("131.0.2903"));
        assert!(!is_chrome_version("131.0.2903.86.1"));
        assert!(!is_chrome_version("131.0.2903.x"));
        assert!(!is_chrome_version(""));
    }
}
