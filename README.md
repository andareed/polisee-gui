# Polisee · EyeSight Policy Viewer

A separate desktop GUI backed by Go and **polisee-lib**, using Wails v2.16.0.
It provides the policy tree, orange/grey palette, condition hierarchy, combined
search filters, pins, and collapsible detail sections in a desktop window.

This desktop application focuses on policy definitions. Activity analysis is
outside its scope.

## Run

Keep this project beside the shared library:

```text
code.sandbox/
    polisee/
        polisee-lib/
        polisee-gui/
```

Requires Go 1.25+ and the platform's Wails native build dependencies. On Linux,
install the GTK3 and WebKitGTK 4.1 development packages. A C compiler and
`pkg-config` are also needed. Node is only required for frontend checks; there
are no npm dependencies and no frontend build step.

```sh
./run.sh
```

The launcher runs an incremental build before opening
`bin/polisee-gui`, so embedded frontend and library changes are included
even when an older binary exists. `./run.sh build` builds without opening it. It
loads an embedded fabricated policy export on startup. Choose **Open policy**
for a local XML export. Exports are read locally and are never modified or
uploaded. Native startup reopening is opt-in
using **Reopen this policy on startup**. The application
accepts UTF-8 exports up to 64 MiB.

The module uses a local `replace` for `github.com/andareed/polisee-lib`; its
`v0.0.0` requirement is a local placeholder, not a published release. A private
GitHub repository is not required for local development. Dependencies are pinned
in go.mod/go.sum; no global Wails CLI is needed to build or run.

Git worktrees can use the same launcher and Makefile targets. If the worktree has
no usable sibling library, the build resolves `polisee-lib` beside the primary
Git checkout and generates a local Go workspace under
`<code-root>/.agent-work/polisee-gui/<worktree-name>/`. No symlink or
manual environment variables are needed. An explicitly selected `GOWORK` (or a
workspace Go already discovers) takes precedence. Generated workspace files stay
outside tracked source; `go.mod` retains its portable sibling replacement.

On Linux with the NVIDIA kernel module loaded, the app automatically sets
`WEBKIT_DISABLE_DMABUF_RENDERER=1` before WebKit starts. This avoids blank windows
and Wayland `Error 71` failures in the WebKitGTK DMA-BUF renderer while keeping
the selected display backend. The setting applies only to this app and its child
processes, including direct binary launches; an explicitly supplied value takes
precedence. See the [Wails Linux troubleshooting guide](https://v3.wails.io/guides/build/linux/#blank-or-white-window-on-nvidia-gpu).

## What is shared

```text
Desktop web UI → Wails bindings → viewer.Service → polisee-lib
Browser preview → local HTTP  → viewer.Service → polisee-lib
```

The library owns XML loading/validation, policy structure, enabled-state
inheritance, field labels, Boolean expression structure, and combined
text/property/group/action/parameter-value searches. JavaScript does not parse
XML, maintain a second label catalog, or implement policy matching.

The Go viewer adapter supplies presentation labels and a typed navigation tree.
Wails supplies the native window, file dialog, and clipboard. HTML/CSS/JavaScript
own layout, focus, expanded sections, pins, and result navigation. Failed loads
leave the currently displayed document intact and show an error.

## Available interactions

- Policy/folder/subpolicy tree, enabled indicators, expand/collapse, and pinned
  shortcuts. Folders and top-level policies are sorted by name with numeric
  ordering (for example, 1.1.01 before 1.1.02 and 1.1.2 before 1.1.10), with
  folders first. Source subrule order is preserved. Search result navigation
  follows the displayed tree order.
- Free text and quoted phrases, plus combined property, group, action, and action
  parameter filters with data-derived suggestions and removable filter chips.
- Group suggestions show one entry per named group, with its ID alongside in
  muted text. Repeated references are deduplicated; different IDs with the same
  name stay distinguishable. Arrow keys browse suggestions and Enter selects.
  Raw IDs remain valid when typed, including groups with no exported name.
- Matching ancestors remain visible; next/previous results select direct matches.
- Policy details put the title and description first, followed by Scope &
  Filters, Conditions, Actions, and configured Timers & Admissions. Sub Rules
  are folded by default. Actions, timers and admissions use compact rows, with
  readable names and values first. IDs stay visible beside their associated
  values; technical settings use smaller, muted text to the side. Schedules use
  a compact supporting line. Units are shown only when exported. All section
  frames, headers and padding match Conditions. Empty scope/action sections and
  default-only timing start folded with a short summary. The condition diagram
  retains its layout, with muted technical fields alongside each condition.
  Attributes appears at the bottom with every exported rule attribute and value,
  including empty values, and stays visible when diagnostics are hidden.
- Large segment collections use an eight-row overview with name/ID search and
  paging. Selecting a segment opens a side inspector containing a 25-row range
  page, literal address/ID/value search, result/total counts and visible IDs.
  Previous/next segment controls retain each segment's filter, page and scroll
  position; overview state is retained per policy and cleared on document
  replacement. Segment metadata and additional range fields remain inspectable.
  The Go transport pages ranges before sending them to the frontend; the full
  library catalog still supplies policy queries. Range search filters exported
  text without inferring address containment or fetching external definitions.
- The top Diagnostics toggle shows or hides contextual exported fields without
  changing row heights or scroll position. PLUGIN_NAME is shown first in previews
  and inspectors. Filter IDs appear only in diagnostics. Condition and filter fields use a
  muted, single-line strip; dotted labels and local field controls open a small
  overlay for the owning element's complete values. Actions, parameters, scope,
  schedules, timers, folders, segments and ranges retain their own context.
  Fields never expand the policy or range table. IDs remain visible with
  diagnostics off; click the small policy ID to copy it, or use Ctrl/Cmd+C.
- Explicit notices for externally stored expressions; unknown operators retain
  their exported names and are not interpreted as another operator.
- Visual and Text condition modes share the library expression projection.
  Visual mode uses inline operators and scope brackets; Text mode uses a readable
  infix expression with logical line breaks and actual operand values. Both
  remain available from the Conditions view switch.
  Exported condition-level grouping metadata remains visible. Normalized-flow
  presentation is limited to the information supplied by the library API.
- Copy policy ID, pin/unpin, and collapsible detail sections.
- Persistent 50–200% application zoom: buttons/reset, Ctrl/Cmd +/-/0, and
  Ctrl/Cmd+wheel. Native preferences are stored by Go; preview zoom uses browser
  local storage. When storage fails, zoom remains usable for the session.
- `Alt+H` / `Alt+L` focus the tree / details. `j/k` and up/down navigate only
  inside the focused pane; in details they scroll without changing policy.
  Letters remain text when editing filters or file paths.
  `[` / `]` jump between detail headings, and `h/l` or left/right collapse/expand the
  focused heading or tree branch. Page Up/Down and Home/End browse details.
- `/` reveals Text, Property, Group, Action and Action value filters. Tab and
  Shift+Tab move between filter fields without accepting a suggestion; Enter
  applies filters. The Filters button stays available in narrow windows.
  Native control activation remains available outside the filter editor.
  Escape closes filters or the inspector,
  otherwise focusing the tree without reloading the policy.
- `n/N` navigate results, `p` pins, Ctrl/Cmd+O opens, Ctrl/Cmd+C copies the selected
  policy ID when no text is selected outside inputs, and `?` shows shortcuts.

## Checks and preview

```sh
make check       # Go formatting, vetting, native compilation/tests, JS checks
make race        # Concurrent service/transport tests
make smoke       # Visible native window: verify Go bridge and zoom, then quit
make preview     # Same UI and Go service at http://127.0.0.1:47831
```

The browser preview uses its file input for **Open policy XML**; the desktop uses
the native file dialog. The preview listens only on loopback. Native smoke checks
require a working display session, show a real window, and intentionally exit
three seconds after the startup and zoom checks complete.
The native workflow also imports a fabricated policy containing 24 segments
with 1,200 ranges each. It verifies bounded DOM pages, search and counts,
segment/range paging, per-segment position restoration, document replacement,
escaped raw fields, the named group picker, typed group IDs and focus-scoped
keyboard navigation, then restores the demo before the zoom checks.
Keeping the window visible exercises the first native paint, which a hidden
window does not. The smoke check clicks zoom in/out/reset, dispatches keyboard
and wheel events, verifies actual rendered scaling at every supported level from
50–200%, checks that the workspace and footer fill the window without gaps or
vertical overflow, keeps controls within the window, and reads the saved zoom
back through Go. These are DOM
events in the native WebView; physical keyboard delivery and the native file
picker still require interactive checks.

Wails' optional CLI can also use wails.json; on Linux pass `-tags webkit2_41`.
The Makefile uses the same desktop/production tags without installing that CLI.

## Remembered native files and preferences

Remembering is disabled by default. Open a native XML file and check **Reopen
this policy on startup** to save its path and selected rule ID. The next launch
reads the current file from disk, restores the rule and reveals its ancestors.
If that rule was removed, the first rule is selected. Missing, moved, invalid or
unreadable files produce a visible notice and leave the demo usable. Open
another file to replace the remembered path, or uncheck the option to clear the
saved path and selection. Failed reads, parses and preference writes preserve
the current document. Imported XML and demo selections never replace a saved
native path.

Settings live at `os.UserConfigDir()/polisee-gui/settings.json`
(`$XDG_CONFIG_HOME` or `~/.config` on Linux). Go writes private settings with a
temporary file and atomic rename. The file contains only preferences: optional
native path/selection, zoom, successful update-check metadata and dismissal.
It never contains policy XML. Corrupt/unreadable settings are reported with safe
defaults. The browser preview cannot reopen arbitrary local paths: choose the
file again each session. Its remembering control is explicitly disabled and the
HTTP transport has no native-path or settings endpoint. Smoke checks use
volatile preferences and never touch the user's saved startup file.

## Build identity and advisory updates

The Go application's default version is maintained only in `main.go` as
`buildVersion`. The desktop frontend reads it through Go's `BuildInfo` binding;
there is no separate frontend version.

Desktop builds check `andareed/polisee-gui` for a newer stable GitHub release on
startup and show a dismissible notification with **View release** when one is
available. The current version remains visible beside the startup preferences.
Checks run in the background and never block policy loading. The browser preview
and native smoke checks do not request releases.

For a release build, a maintainer may inject an actual stable
version. Set
`COMPARABLE_VERSION` to that build's real three-part stable version before:

```sh
make build BUILD_LDFLAGS="-X main.buildVersion=$COMPARABLE_VERSION"
```

An unsupported version (such as `dev`) or an empty repository disables requests.
To opt out explicitly, build with `BUILD_LDFLAGS='-X main.updateRepository='`.
The visible build status states whether checks are enabled. Assigning the Go
version does not create a tag or publish a release. Release versions and tags
are maintained independently for this GUI repository; plain Git tags without
a published release do not trigger notifications.

When configured, Go queries GitHub's latest stable release with a five-second
request deadline and one-MiB response limit, never following redirects.
Successful checks, including no release, are cached for 24 hours. Numeric stable
semantic versions are compared; draft/prerelease/invalid responses are ignored.
Network and API failures stay silent and never prevent offline use. **Not now**
persists dismissal for that version. **View release** opens only HTTPS tag pages
in the configured repository, with validation again at the native opener. It
never downloads or installs an update. Tests use a fake transport, requiring no
network.

Pins, filters, expanded sections and condition mode live in the current window.

## Origins

The policy engine is the sibling polisee-lib extraction from Acuity. The embedded
synthetic XML is copied from its regression fixture. The policy browsing layout,
palette, keyboard conventions, and section organization follow polisee-tui's
working tree at baseline commit `a7c93b2f95cbb205675748ce599a519429d9d735`.
The new desktop frontend and transport adapters are separate implementations;
no TUI XML parser, field catalog, private exports, or binaries were copied.
