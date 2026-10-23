package main

import (
	"testing"

	"github.com/andareed/polisee-gui/internal/settings"
	"github.com/andareed/polisee-gui/internal/updates"
)

func TestDefaultBuildEnablesReleaseNotifications(t *testing.T) {
	store, err := settings.Open("")
	if err != nil {
		t.Fatal(err)
	}
	app := &App{updates: updates.New(store, buildVersion, updateRepository)}
	info := app.BuildInfo()
	if !info.Enabled || info.Repository != updates.Repository || info.Version != buildVersion {
		t.Fatalf("default desktop build cannot check for releases: %+v", info)
	}
}
