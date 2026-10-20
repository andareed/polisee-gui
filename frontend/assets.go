package frontend

import "embed"

//go:embed index.html styles.css app.js bridge.js tree-model.js zoom.js smoke.js workflow-smoke.js ui.js browse-state.js segments.js group-picker.js diagnostics.js
var Assets embed.FS
