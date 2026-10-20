package updates

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/andareed/polisee-gui/internal/settings"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func reply(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

const releaseJSON = `{"tag_name":"v1.10.0","html_url":"https://github.com/andareed/polisee-gui/releases/tag/v1.10.0","draft":false,"prerelease":false}`

func checker(t *testing.T) (*Checker, *settings.Store) {
	t.Helper()
	store, _ := settings.Open("")
	c := New(store, "1.9.0", Repository)
	c.now = func() time.Time { return time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC) }
	return c, store
}
func TestSemanticVersionsAndReleaseRestrictions(t *testing.T) {
	for _, test := range []struct {
		a, b string
		want int
	}{{"v1.10.0", "1.9.9", 1}, {"2.0.0", "10.0.0", -1}, {"0.1.0", "v0.1.0", 0}} {
		got, err := Compare(test.a, test.b)
		if err != nil || got != test.want {
			t.Fatal(test, got, err)
		}
	}
	for _, bad := range []string{"dev", "1.0", "01.0.0", "1.0.0-beta.1", "1.0.0+build", "99999999999999999999999.0.0"} {
		if _, err := Compare(bad, "1.0.0"); err == nil {
			t.Fatal("accepted", bad)
		}
	}
	for _, bad := range []string{"http://github.com/andareed/polisee-gui/releases/tag/v2.0.0", "https://github.com.evil/andareed/polisee-gui/releases/tag/v2.0.0", "https://github.com/other/polisee/releases/tag/v2.0.0", "https://github.com/andareed/polisee-gui/releases/tag/../other", "https://user@github.com/andareed/polisee-gui/releases/tag/v2.0.0", "https://github.com/andareed/polisee-gui/releases/tag/%2e%2e", "https://github.com/andareed/polisee-gui/releases/tag/v2.0.0?q=bad"} {
		if ReleaseURL(bad) {
			t.Fatal("accepted", bad)
		}
	}
	if !ReleaseURL("https://github.com/andareed/polisee-gui/releases/tag/v2.0.0") {
		t.Fatal("valid link rejected")
	}
}
func TestSuccessfulCheckCachingDismissalAndExpiration(t *testing.T) {
	c, store := checker(t)
	calls := 0
	c.client.Transport = transport(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.URL.String() != endpoint || request.Header.Get("Accept") == "" {
			t.Fatal("incorrect API request")
		}
		deadline, ok := request.Context().Deadline()
		if !ok || time.Until(deadline) > 5*time.Second {
			t.Fatal("unbounded request")
		}
		return reply(200, releaseJSON), nil
	})
	found := c.Check(context.Background())
	if found == nil || found.Version != "1.10.0" {
		t.Fatal(found)
	}
	found.URL = "changed"
	if c.Check(context.Background()) == nil || calls != 1 {
		t.Fatal("no cache")
	}
	if err := c.Dismiss("v1.10.0"); err != nil {
		t.Fatal(err)
	}
	if c.Check(context.Background()) != nil || calls != 1 {
		t.Fatal("dismissal not respected")
	}
	_ = store.Change(func(data *settings.Data) error {
		data.UpdateCache.CheckedAt = c.now().Add(-24 * time.Hour)
		data.DismissedVersion = ""
		return nil
	})
	if c.Check(context.Background()) == nil || calls != 2 {
		t.Fatal("expired cache reused")
	}
	_ = store.Change(func(data *settings.Data) error { data.UpdateCache.CheckedAt = c.now().Add(time.Hour); return nil })
	_ = c.Check(context.Background())
	if calls != 3 {
		t.Fatal("future cache reused")
	}
}
func TestNoReleaseCachedAndFailuresSilentUncached(t *testing.T) {
	c, store := checker(t)
	calls := 0
	c.client.Transport = transport(func(*http.Request) (*http.Response, error) { calls++; return reply(404, ""), nil })
	if c.Check(context.Background()) != nil || c.Check(context.Background()) != nil || calls != 1 || store.Snapshot().UpdateCache == nil {
		t.Fatal("404 not cached")
	}
	for _, body := range []string{`{`, strings.Repeat("x", maxResponse+1), strings.ReplaceAll(releaseJSON, `"draft":false`, `"draft":true`), strings.ReplaceAll(releaseJSON, `"prerelease":false`, `"prerelease":true`), strings.ReplaceAll(releaseJSON, "github.com/andareed", "github.com/attacker")} {
		_ = store.Change(func(data *settings.Data) error { data.UpdateCache = nil; return nil })
		c.client.Transport = transport(func(*http.Request) (*http.Response, error) { return reply(200, body), nil })
		if c.Check(context.Background()) != nil || store.Snapshot().UpdateCache != nil {
			t.Fatal("bad response became a cache hit")
		}
	}
	for _, status := range []int{403, 429, 500} {
		c.client.Transport = transport(func(*http.Request) (*http.Response, error) { return reply(status, ""), nil })
		if c.Check(context.Background()) != nil || store.Snapshot().UpdateCache != nil {
			t.Fatal(status)
		}
	}
	c.client.Transport = transport(func(*http.Request) (*http.Response, error) { return nil, errors.New("offline") })
	if c.Check(context.Background()) != nil || store.Snapshot().UpdateCache != nil {
		t.Fatal("offline error cached")
	}
}
func TestDevelopmentAndInvalidBuildsNeverRequest(t *testing.T) {
	store, _ := settings.Open("")
	for _, pair := range [][2]string{{"dev", Repository}, {"1.0.0", ""}, {"1.0.0", "other/repo"}} {
		c := New(store, pair[0], pair[1])
		c.client.Transport = transport(func(*http.Request) (*http.Response, error) {
			t.Fatal("unexpected development request")
			return nil, nil
		})
		if c.Info().Enabled || c.Check(context.Background()) != nil {
			t.Fatal(pair)
		}
	}
}
func TestPoisonedCacheCannotSupplyLink(t *testing.T) {
	c, store := checker(t)
	_ = store.Change(func(data *settings.Data) error {
		data.UpdateCache = &settings.Cache{Repository: Repository, CheckedAt: c.now(), Release: &settings.Release{Version: "99.0.0", URL: "https://evil.test"}}
		return nil
	})
	c.client.Transport = transport(func(*http.Request) (*http.Response, error) { return nil, errors.New("offline") })
	if c.Check(context.Background()) != nil {
		t.Fatal("invalid cached link escaped validation")
	}
	if c.client.CheckRedirect(nil, nil) == nil || c.client.Timeout != 5*time.Second {
		t.Fatal("unbounded HTTP client")
	}
}

func TestCacheAndDismissalSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := settings.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	first := New(store, "1.9.0", Repository)
	first.client.Transport = transport(func(*http.Request) (*http.Response, error) { return reply(200, releaseJSON), nil })
	if first.Check(context.Background()) == nil {
		t.Fatal("expected release")
	}
	again, err := settings.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	second := New(again, "1.9.0", Repository)
	second.client.Transport = transport(func(*http.Request) (*http.Response, error) {
		t.Fatal("fresh persistent cache requested network")
		return nil, nil
	})
	if second.Check(context.Background()) == nil {
		t.Fatal("cache not restored")
	}
	if err := second.Dismiss("1.10.0"); err != nil {
		t.Fatal(err)
	}
	dismissed, err := settings.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	third := New(dismissed, "1.9.0", Repository)
	third.client.Transport = second.client.Transport
	if third.Check(context.Background()) != nil {
		t.Fatal("dismissal not restored")
	}
}
