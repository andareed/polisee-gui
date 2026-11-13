# Polisee GUI v0.2.3

Export an individual main policy from the loaded policy document.

- Select a main policy and choose **Export policy**, or press **Ctrl/Cmd+E**, to open the native save dialog. Browser preview exports download as XML.
- Exports use EyeSight's `RULES` format and include the complete selected policy, subrules, actions, schedules and original XML metadata. Folders and subrules cannot be exported independently.
- The loaded source file is protected from overwriting, and stale export requests are rejected after a document change.
- Reopen single-policy XML exports directly in Polisee using polisee-lib v0.2.0.
- Correct viewport sizing during zoom and window resizing so the toolbar, workspace and footer fit the native window.

## Downloads

Linux x86-64 and Windows x86-64. The policy engine is compiled in; running a download requires no library checkout or GitHub credentials. Source builds require the adjacent private polisee-lib repository.

Linux requires GTK 3, WebKitGTK 4.1 and a graphical desktop. Runtime library versions are recorded in `BUILDINFO.json`; Linux runtime testing was performed on the build workstation. Windows requires Microsoft Edge WebView2 Runtime. Windows executables are unsigned and cross-compiled, without Windows runtime testing.

Each archive includes `BUILDINFO.json` with exact committed source revisions, `VERSION`, and a runtime README. Verify downloads against `SHA256SUMS`. Customer exports and local configuration are excluded.

## Validation

Go and frontend checks, race tests, synthetic export/save regression tests, and the visible native desktop smoke passed. Release binaries were built from clean Git exports without GitHub build runners. The packaged Linux executable passed its smoke check; Windows PE executable headers were verified.
