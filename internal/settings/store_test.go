package settings

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestDurablePreferencesAndClear(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config", "settings.json")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Change(func(data *Data) error {
		data.Remember = true
		data.Path = "/example/policy.xml"
		data.SelectedID = "r"
		data.Zoom = 1.24
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	again, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	saved := again.Snapshot()
	if !saved.Remember || saved.Path != "/example/policy.xml" || saved.SelectedID != "r" || saved.Zoom != 1.25 {
		t.Fatalf("%+v", saved)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	// Windows permissions come from the user-profile ACL; Go mode bits do not
	// represent its access control. Keep testing durability and clearing there.
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		t.Fatal("preferences are not private")
	}
	if err := again.Change(func(data *Data) error { data.Remember = false; return nil }); err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(path)
	if strings.Contains(string(content), "policy.xml") || strings.Contains(string(content), "selectedId") {
		t.Fatal("disabling did not forget native path and selection")
	}
}
func TestFailureDoesNotChangeMemoryOrPreviousFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, _ := Open(path)
	if err := store.Change(func(data *Data) error { data.Zoom = 1.5; return nil }); err != nil {
		t.Fatal(err)
	}
	if err := store.Change(func(data *Data) error { data.Zoom = 2; return errors.New("cancel") }); err == nil {
		t.Fatal("callback error ignored")
	}
	reloaded, _ := Open(path)
	if reloaded.Snapshot().Zoom != 1.5 {
		t.Fatal("failed callback modified disk")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := store.Change(func(data *Data) error { data.Zoom = 2; return nil }); err == nil {
		t.Fatal("write failure accepted")
	}
	if store.Snapshot().Zoom != 1.5 {
		t.Fatal("failed write modified memory")
	}
}
func TestBadPreferencesAndZoom(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	for _, value := range []string{"{", `{} {}`, `{"zoom":"large"}`} {
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
		store, err := Open(path)
		if err == nil || store.Snapshot().Zoom != 1 {
			t.Fatal("bad preferences must report error and use safe defaults")
		}
	}
	for _, value := range []float64{math.NaN(), math.Inf(1), 0} {
		if NormalizeZoom(value) != 1 {
			t.Fatal(value)
		}
	}
	if NormalizeZoom(99) != 2 || NormalizeZoom(-1) != 0.5 {
		t.Fatal("unbounded zoom")
	}
}
func TestConcurrentChangesAndDetachedSnapshots(t *testing.T) {
	store, _ := Open("")
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = store.Change(func(data *Data) error { data.Zoom = 1.5; return nil })
			_ = store.Snapshot()
		}()
	}
	wg.Wait()
	_ = store.Change(func(data *Data) error { data.UpdateCache = &Cache{Release: &Release{Version: "1.0.0"}}; return nil })
	detached := store.Snapshot()
	detached.UpdateCache.Release.Version = "changed"
	if store.Snapshot().UpdateCache.Release.Version != "1.0.0" {
		t.Fatal("snapshot mutated preferences")
	}
}

func TestUnavailableSettingsCannotClaimDurableSave(t *testing.T) {
	store := Unavailable(errors.New("no config directory"))
	if err := store.Change(func(data *Data) error { data.Remember = true; data.Path = "policy.xml"; return nil }); err == nil {
		t.Fatal("unavailable storage claimed save success")
	}
	if store.Snapshot().Remember {
		t.Fatal("failed save changed preferences")
	}
}
