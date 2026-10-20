# Repository guidance

- This is Polisee GUI using Wails and the sibling polisee-lib Go
  module. Keep policy parsing, domain interpretation, and query matching in the
  library. The frontend renders values and owns navigation/display state.
- Keep application code independent of the original polisee and polisee-tui
  repositories. Do not copy private XML exports or duplicate the field catalog.
- Preserve raw policy values. Escape them through DOM textContent when rendering.
  Never interpret unavailable expressions as a match or fetch external references.
- Keep the preview transport bound to loopback and backed by the same Go service
  as the desktop app. It exists for development, not remote hosting.
- Run make check, make race, and a native make smoke when changing integration.
  Report clearly when a display is unavailable for the native check.
- Do not create releases, tags, GitHub repositories, or change existing application
  versions without an explicit request.

- Keep real policy exports, customer data, credentials, generated state, and
  local agent configuration outside source control. The embedded demo XML
  is synthetic; additional XML fixtures require an explicit ignore exception
  and review. Shared local datasets belong in the parent workspace data folder.
- Keep TODO files and internal parity checklists out of this repository.
