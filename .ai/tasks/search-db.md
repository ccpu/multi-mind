# Search saved prompts and conversations

Add a search field to the main window's navigation bar. Save each submitted prompt with one record per target provider, including the provider's stable website ID, current conversation URL, page title, and timestamps. Save the composed text actually sent to the provider, including active presets. Store the SQLite index beside the active `settings.json`, including when the user has moved the settings directory.

The embedded sites change their URL and title after a prompt is submitted. Report both from each guest page periodically and update the most recent record submitted to that provider in that window. Keep earlier prompt records intact. Do not expose database commands to remote guest pages; route their metadata reports through the existing guest message bridge.

Search prompt text, page title, and conversation URL with case-insensitive substring matching, including matches inside words and URLs. Show the provider, prompt, title, and URL in a results list. An empty query shows no results. Keep results usable while a URL has not yet been captured, but only enable opening a result once it has a URL.

Selecting a result opens its stored URL in that provider's pane. If the provider is disabled or closed, enable and open it first. Keep saved records across app restarts and make them available from every main window.

Acceptance checks:

- A prompt sent to two providers creates two searchable records.
- Later URL or title changes update the matching record without losing its prompt.
- Searching a substring of prompt, title, or URL finds the record.
- Selecting a record reopens its conversation, including when its provider is disabled.
- Search data is stored beside the active `settings.json`, moves with it when the data folder changes, and survives restart.
