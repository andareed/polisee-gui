// Package updates provides advisory release checks; it never installs software.
package updates

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/andareed/polisee-gui/internal/settings"
)

const Repository = "andareed/polisee-gui"
const endpoint = "https://api.github.com/repos/" + Repository + "/releases/latest"
const maxResponse = 1 << 20

var stableVersion = regexp.MustCompile(`^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

func version(value string) ([3]uint64, error) {
	var result [3]uint64
	parts := stableVersion.FindStringSubmatch(value)
	if parts == nil {
		return result, fmt.Errorf("unsupported stable version")
	}
	for i := range result {
		parsed, err := strconv.ParseUint(parts[i+1], 10, 64)
		if err != nil {
			return result, err
		}
		result[i] = parsed
	}
	return result, nil
}
func Compare(left, right string) (int, error) {
	a, err := version(left)
	if err != nil {
		return 0, err
	}
	b, err := version(right)
	if err != nil {
		return 0, err
	}
	for i := range a {
		if a[i] > b[i] {
			return 1, nil
		}
		if a[i] < b[i] {
			return -1, nil
		}
	}
	return 0, nil
}

// ReleaseURL permits only a tag page in the configured public repository.
func ReleaseURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "github.com" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.RawPath != "" {
		return false
	}
	prefix := "/" + Repository + "/releases/tag/"
	tag := strings.TrimPrefix(parsed.Path, prefix)
	return strings.HasPrefix(parsed.Path, prefix) && tag != "" && !strings.ContainsAny(tag, "/\\") && tag != "." && tag != ".."
}
func valid(release *settings.Release) bool {
	if release == nil {
		return true
	}
	_, err := version(release.Version)
	return err == nil && ReleaseURL(release.URL)
}

type Info struct {
	Version    string `json:"version"`
	Repository string `json:"repository,omitempty"`
	Enabled    bool   `json:"enabled"`
}
type Checker struct {
	mu     sync.Mutex
	store  *settings.Store
	info   Info
	client *http.Client
	now    func() time.Time
}

func New(store *settings.Store, buildVersion, repository string) *Checker {
	_, err := version(buildVersion)
	return &Checker{store: store, info: Info{Version: buildVersion, Repository: repository, Enabled: err == nil && repository == Repository},
		client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return fmt.Errorf("release redirects are not followed") }}, now: time.Now}
}
func (c *Checker) Info() Info { return c.info }

// Check silently ignores network/API/storage failures. Only successful results
// (including a 404/no release) are cached, for 24 hours. Development is opt-out.
func (c *Checker) Check(ctx context.Context) *settings.Release {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.info.Enabled {
		return nil
	}
	saved := c.store.Snapshot()
	cache := saved.UpdateCache
	now := c.now()
	if cache == nil || cache.Repository != c.info.Repository || now.Before(cache.CheckedAt) || now.Sub(cache.CheckedAt) >= 24*time.Hour || !valid(cache.Release) {
		release, err := c.fetch(ctx)
		if err != nil {
			return nil
		}
		cache = &settings.Cache{CheckedAt: now, Repository: c.info.Repository, Release: release}
		_ = c.store.Change(func(data *settings.Data) error { data.UpdateCache = cache; return nil })
	}
	if cache.Release == nil || saved.DismissedVersion == cache.Release.Version {
		return nil
	}
	comparison, err := Compare(cache.Release.Version, c.info.Version)
	if err != nil || comparison <= 0 {
		return nil
	}
	release := *cache.Release
	return &release
}

func (c *Checker) fetch(ctx context.Context) (*settings.Release, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	request.Header.Set("User-Agent", "polisee-gui")
	response, err := c.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == 404 {
		return nil, nil
	}
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("release HTTP status %d", response.StatusCode)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxResponse+1))
	if err != nil || len(content) > maxResponse {
		return nil, fmt.Errorf("release response unavailable or too large")
	}
	var payload struct {
		Tag        string `json:"tag_name"`
		URL        string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := json.Unmarshal(content, &payload); err != nil {
		return nil, err
	}
	release := &settings.Release{Version: strings.TrimPrefix(payload.Tag, "v"), URL: payload.URL}
	if payload.Draft || payload.Prerelease || !valid(release) {
		return nil, fmt.Errorf("unsupported release response")
	}
	return release, nil
}
func (c *Checker) Dismiss(value string) error {
	if _, err := version(value); err != nil {
		return err
	}
	return c.store.Change(func(data *settings.Data) error { data.DismissedVersion = strings.TrimPrefix(value, "v"); return nil })
}
