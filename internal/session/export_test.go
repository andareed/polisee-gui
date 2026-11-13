package session

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/andareed/polisee-gui/internal/settings"
	"github.com/andareed/polisee-lib"
)

func TestPolicyExportSaveAndSourceProtection(t *testing.T) {
	store, _ := settings.Open("")
	s := New(store)
	if _, err := s.Startup(context.Background()); err != nil {
		t.Fatal(err)
	}
	source := policyFile(t)
	state, err := s.Open(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	id := state.Document.InitialID
	export, err := s.ExportPolicy(state.Document.Generation, id)
	if err != nil || export.Filename == "" {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "single.xml")
	if err := s.SavePolicy(state.Document.Generation, id, dest); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(dest)
	if err != nil || string(bytes) != export.XML {
		t.Fatal("saved XML differs", err)
	}
	reopened, err := polisee.Load(context.Background(), dest)
	if err != nil || len(reopened.Policies) != 1 || reopened.Policies[0].ID != id {
		t.Fatal("cannot reopen single policy", err)
	}
	before, _ := os.ReadFile(source)
	for _, path := range []string{source, filepath.Join(filepath.Dir(source), ".", filepath.Base(source))} {
		if err := s.SavePolicy(state.Document.Generation, id, path); err == nil {
			t.Fatal("source overwrite allowed")
		}
	}
	alias := filepath.Join(filepath.Dir(source), "alias.xml")
	if err := os.Link(source, alias); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePolicy(state.Document.Generation, id, alias); err == nil {
		t.Fatal("source alias overwrite allowed")
	}
	after, _ := os.ReadFile(source)
	if string(before) != string(after) {
		t.Fatal("source changed")
	}
	if _, err := s.Import("new", `<POLICY_FOLDER ID="f"><RULE ID="new"/></POLICY_FOLDER>`); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePolicy(state.Document.Generation, id, dest); err == nil {
		t.Fatal("stale save allowed")
	}
	if _, err := s.ExportPolicy(state.Document.Generation, id); err == nil {
		t.Fatal("stale export allowed")
	}
}
