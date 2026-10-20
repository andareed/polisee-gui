package session

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/andareed/polisee-gui/internal/settings"
	"github.com/andareed/polisee-gui/internal/viewer"
	"github.com/andareed/polisee-lib"
)

func policyFile(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "policy.xml")
	if err := os.WriteFile(path, []byte(viewer.DemoXML), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
func TestOptInRestoreSelectionAndReadCurrentDisk(t *testing.T) {
	ctx := context.Background()
	settingsPath := filepath.Join(t.TempDir(), "settings.json")
	store, _ := settings.Open(settingsPath)
	session := New(store)
	initial, err := session.Startup(ctx)
	if err != nil || initial.Preferences.Remember {
		t.Fatal(err)
	}
	path := policyFile(t)
	opened, err := session.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if store.Snapshot().Path != "" {
		t.Fatal("remembering is not opt-in")
	}
	if _, err := session.Remember(true); err != nil {
		t.Fatal(err)
	}
	// Pick an ID from the synthetic fixture rather than relying on names.
	id := opened.Document.Nodes[len(opened.Document.Nodes)-1].ID
	if err := session.Select(opened.Document.Generation, id); err != nil {
		t.Fatal(err)
	}
	reloaded, err := settings.Open(settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := New(reloaded).Startup(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Document.InitialID != id || restored.Document.Name != "policy.xml" || !restored.CanRemember {
		t.Fatalf("%+v", restored)
	}
	if err := os.WriteFile(path, []byte(`<POLICY_FOLDER ID="f"><RULE ID="new" NAME="Changed on disk"/></POLICY_FOLDER>`), 0600); err != nil {
		t.Fatal(err)
	}
	changed, err := New(reloaded).Startup(ctx)
	if err != nil || changed.Document.InitialID != "new" {
		t.Fatal("did not reload disk/fallback from missing selected ID", err)
	}
	content, _ := os.ReadFile(settingsPath)
	if strings.Contains(string(content), "POLICY_FOLDER") {
		t.Fatal("XML persisted")
	}
}
func TestFailedRestoreOpenAndPreferenceWritesPreserveDocument(t *testing.T) {
	ctx := context.Background()
	settingsPath := filepath.Join(t.TempDir(), "settings.json")
	store, _ := settings.Open(settingsPath)
	session := New(store)
	initial, _ := session.Startup(ctx)
	if _, err := session.Remember(true); err == nil {
		t.Fatal("demo can be remembered")
	}
	path := policyFile(t)
	opened, err := session.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := session.Remember(true); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`<OTHER/>`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Open(ctx, path); err == nil {
		t.Fatal("invalid policy accepted")
	}
	found, _ := session.Rule(initial.Document.InitialID)
	if found.Generation != opened.Document.Generation {
		t.Fatal("failed parse replaced current document")
	}
	restored, err := New(store).Startup(ctx)
	if err != nil || restored.Warning == "" || restored.Document.Name != "Demonstration policies" {
		t.Fatal("failed startup must fall back visibly", err)
	}
	if err := os.Remove(settingsPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(settingsPath, 0700); err != nil {
		t.Fatal(err)
	}
	other := policyFile(t)
	if _, err := session.Open(ctx, other); err == nil {
		t.Fatal("remembering write failure ignored")
	}
	if _, err := session.Remember(false); err == nil {
		t.Fatal("failed clear accepted")
	}
	found, _ = session.Rule(initial.Document.InitialID)
	if found.Generation != opened.Document.Generation || !store.Snapshot().Remember || store.Snapshot().Path != path {
		t.Fatal("failure changed document or settings")
	}
}
func TestDemoImportCannotOverwriteRememberedPathAndStaleSelectionIgnored(t *testing.T) {
	ctx := context.Background()
	store, _ := settings.Open("")
	session := New(store)
	_, _ = session.Startup(ctx)
	path := policyFile(t)
	opened, err := session.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = session.Remember(true)
	imported, err := session.Import("upload.xml", `<POLICY_FOLDER ID="f"><RULE ID="uploaded"/></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	if imported.CanRemember {
		t.Fatal("browser-like import can reopen a native path")
	}
	if err := session.Select(imported.Document.Generation, "uploaded"); err != nil {
		t.Fatal(err)
	}
	if err := session.Select(opened.Document.Generation, "stale"); err != nil {
		t.Fatal(err)
	}
	saved := store.Snapshot()
	if saved.Path != path || saved.SelectedID != opened.Document.InitialID {
		t.Fatal("import selection overwrote remembered native selection")
	}
	result, _ := session.Search(polisee.Query{})
	if result.Generation != imported.Document.Generation {
		t.Fatal("non-monotonic generation")
	}
	if _, err := session.Remember(false); err != nil {
		t.Fatal(err)
	}
	if store.Snapshot().Path != "" || store.Snapshot().SelectedID != "" {
		t.Fatal("clear retained path")
	}
}
