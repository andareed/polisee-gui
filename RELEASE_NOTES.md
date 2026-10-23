# Polisee GUI v0.2.2

First stable release from the standalone Polisee GUI repository.

- Desktop policy inspection with a shared parsing and query engine from polisee-lib v0.1.0.
- Policy and rule navigation, combined search, visual and text expressions, group selection, and paged expression segments.
- Keyboard and mouse navigation, persistent display preferences and zoom, with a synthetic demonstration included.
- Preference tests retain Unix mode checks on Unix and test persistence/clearing on Windows, where Go mode bits do not represent ACLs.
- Layout verification now measures the scope content separately from its panel borders. No policy interpretation or layout styling changed in this release.

## Downloads

Linux x86-64 and Windows x86-64. The private engine is compiled in: running a download needs no library checkout or GitHub credentials. Building from source still requires the adjacent private polisee-lib repository.

Linux requires GTK 3 and WebKitGTK 4.1 (Ubuntu 24.04 or compatible). Windows requires Microsoft Edge WebView2 Runtime. Windows binaries are unsigned.

Each archive includes BUILDINFO.json with exact source revisions. Verify downloads against SHA256SUMS. Customer exports, TODO files and local configuration are excluded.
