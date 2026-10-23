package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"sync/atomic"
	"time"

	"github.com/andareed/polisee-gui/frontend"
	"github.com/andareed/polisee-gui/internal/session"
	"github.com/andareed/polisee-gui/internal/settings"
	"github.com/andareed/polisee-gui/internal/updates"
	"github.com/andareed/polisee-gui/internal/viewer"
	"github.com/andareed/polisee-lib"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Default application version for the Go GUI; the frontend reads it through BuildInfo.
var buildVersion = "0.2.2"
var updateRepository = updates.Repository

type App struct {
	ctx             context.Context
	session         *session.Session
	store           *settings.Store
	updates         *updates.Checker
	settingsWarning string
	smoke           bool
	smokeDone       atomic.Bool
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.smoke {
		time.AfterFunc(45*time.Second, func() {
			if !a.smokeDone.Load() {
				fmt.Fprintln(os.Stderr, "desktop smoke failed: UI did not connect to Go")
				os.Exit(1)
			}
		})
	}
}
func (a *App) Initialize() (session.State, error) {
	result, err := a.session.Startup(a.ctx)
	if a.settingsWarning != "" {
		result.Warning = a.settingsWarning + ". " + result.Warning
	}
	return result, err
}
func (a *App) LoadDemo() (session.State, error) {
	return a.session.Import("Demonstration policies", viewer.DemoXML)
}
func (a *App) ImportXML(name, text string) (session.State, error) {
	return a.session.Import(name, text)
}
func (a *App) Search(query polisee.Query) (viewer.SearchResult, error) {
	return a.session.Search(query)
}
func (a *App) GetRule(id string) (viewer.Detail, error) { return a.session.Rule(id) }
func (a *App) Segments(query viewer.BrowseQuery) (viewer.SegmentPage, error) {
	return a.session.Segments(query)
}
func (a *App) Ranges(query viewer.BrowseQuery) (viewer.RangePage, error) {
	return a.session.Ranges(query)
}
func (a *App) SetRemember(enabled bool) (settings.Data, error) { return a.session.Remember(enabled) }
func (a *App) SelectRule(generation uint64, id string) error   { return a.session.Select(generation, id) }
func (a *App) SetZoom(zoom float64) error {
	return a.store.Change(func(data *settings.Data) error { data.Zoom = zoom; return nil })
}
func (a *App) BuildInfo() updates.Info            { return a.updates.Info() }
func (a *App) CheckUpdate() *settings.Release     { return a.updates.Check(a.ctx) }
func (a *App) DismissUpdate(version string) error { return a.updates.Dismiss(version) }
func (a *App) OpenRelease(url string) error {
	if !updates.ReleaseURL(url) {
		return fmt.Errorf("release link is outside the configured repository")
	}
	runtime.BrowserOpenURL(a.ctx, url)
	return nil
}
func (a *App) SmokeMode() bool  { return a.smoke }
func (a *App) GetZoom() float64 { return a.store.Snapshot().Zoom }
func (a *App) SmokeFailed(message string) {
	if a.smoke {
		fmt.Fprintln(os.Stderr, "desktop smoke failed: "+message)
		os.Exit(1)
	}
}
func (a *App) Ready() {
	if a.smoke && a.smokeDone.CompareAndSwap(false, true) {
		// Keep the window visible through its first frames. A hidden WebView can
		// connect successfully while the native renderer still fails on first paint.
		time.AfterFunc(3*time.Second, func() {
			fmt.Printf("Desktop smoke passed (build %s): visible frontend, paged segments/ranges, named group picker, scoped keyboard navigation, zoom, bounds and Go preferences verified.\n", buildVersion)
			runtime.Quit(a.ctx)
		})
	}
}
func (a *App) CopyText(text string) error { return runtime.ClipboardSetText(a.ctx, text) }
func (a *App) OpenPolicy() (*session.State, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Open policy XML", Filters: []runtime.FileFilter{{DisplayName: "Policy XML", Pattern: "*.xml"}}})
	if err != nil || path == "" {
		return nil, err
	}
	document, err := a.session.Open(a.ctx, path)
	if err != nil {
		return nil, err
	}
	return &document, nil
}

func main() {
	smoke := flag.Bool("smoke", false, "open a visible window, verify frontend startup and rendered zoom, then quit")
	flag.Parse()
	if err := configureWebView(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	path, pathErr := settings.DefaultPath()
	if *smoke {
		path, pathErr = "", nil
	}
	store, settingsErr := settings.Open(path)
	if pathErr != nil {
		store = settings.Unavailable(pathErr)
	}
	app := &App{session: session.New(store), store: store, smoke: *smoke}
	app.updates = updates.New(store, buildVersion, updateRepository)
	if *smoke {
		app.updates = updates.New(store, buildVersion, "")
	}
	if pathErr != nil {
		app.settingsWarning = pathErr.Error()
	}
	if settingsErr != nil {
		app.settingsWarning = settingsErr.Error()
	}
	err := wails.Run(&options.App{Title: "Polisee · EyeSight Policy Viewer", Width: 1380, Height: 900, MinWidth: 800, MinHeight: 600,
		BackgroundColour: options.NewRGBA(19, 20, 22, 255), AssetServer: &assetserver.Options{Assets: frontend.Assets},
		OnStartup: app.startup, Bind: []interface{}{app}, Linux: &linux.Options{ProgramName: "polisee-gui"}})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
