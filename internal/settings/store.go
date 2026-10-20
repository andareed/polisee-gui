// Package settings stores preferences only; policy XML never enters this store.
package settings

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Release struct {
	Version string `json:"version"`
	URL     string `json:"url"`
}

type Cache struct {
	CheckedAt  time.Time `json:"checkedAt"`
	Repository string    `json:"repository"`
	Release    *Release  `json:"release"`
}

type Data struct {
	Remember         bool    `json:"remember"`
	Path             string  `json:"path,omitempty"`
	SelectedID       string  `json:"selectedId,omitempty"`
	Zoom             float64 `json:"zoom"`
	UpdateCache      *Cache  `json:"updateCache,omitempty"`
	DismissedVersion string  `json:"dismissedVersion,omitempty"`
}

var ZoomLevels = [...]float64{0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2}

func NormalizeZoom(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value == 0 {
		return 1
	}
	nearest := ZoomLevels[0]
	for _, candidate := range ZoomLevels[1:] {
		if math.Abs(candidate-value) < math.Abs(nearest-value) {
			nearest = candidate
		}
	}
	return nearest
}

type Store struct {
	unavailable error
	mu          sync.Mutex
	path        string
	data        Data
}

// Unavailable preserves safe in-memory defaults while refusing fake durable saves.
func Unavailable(cause error) *Store { return &Store{unavailable: cause, data: Data{Zoom: 1}} }

func DefaultPath() (string, error) {
	directory, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(directory, "polisee-gui", "settings.json"), nil
}

// An empty path is intentionally volatile, for smoke checks and tests.
func Open(path string) (*Store, error) {
	s := &Store{path: path, data: Data{Zoom: 1}}
	if path == "" {
		return s, nil
	}
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return s, fmt.Errorf("read preferences: %w", err)
	}
	defer file.Close()
	var data Data
	decoder := json.NewDecoder(io.LimitReader(file, 1<<20))
	if err := decoder.Decode(&data); err != nil {
		return s, fmt.Errorf("read preferences: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return s, fmt.Errorf("read preferences: expected one JSON object")
	}
	data.Zoom = NormalizeZoom(data.Zoom)
	if !data.Remember {
		data.Path, data.SelectedID = "", ""
	}
	s.data = data
	return s, nil
}

func detached(data Data) Data {
	if data.UpdateCache != nil {
		cache := *data.UpdateCache
		data.UpdateCache = &cache
		if cache.Release != nil {
			release := *cache.Release
			cache.Release = &release
		}
	}
	return data
}

func (s *Store) Snapshot() Data {
	s.mu.Lock()
	defer s.mu.Unlock()
	return detached(s.data)
}

// Change commits to disk before updating memory, so failed writes leave the
// previous preference intact. Writers serialize to avoid lost zoom/path/cache updates.
func (s *Store) Change(change func(*Data) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.unavailable != nil {
		return fmt.Errorf("preferences unavailable: %w", s.unavailable)
	}
	next := detached(s.data)
	if err := change(&next); err != nil {
		return err
	}
	next.Zoom = NormalizeZoom(next.Zoom)
	if !next.Remember {
		next.Path, next.SelectedID = "", ""
	}
	if s.path != "" {
		content, err := json.MarshalIndent(next, "", "  ")
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
			return fmt.Errorf("save preferences: %w", err)
		}
		file, err := os.CreateTemp(filepath.Dir(s.path), ".settings-*")
		if err != nil {
			return fmt.Errorf("save preferences: %w", err)
		}
		defer os.Remove(file.Name())
		if _, err = file.Write(content); err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil {
			err = os.Rename(file.Name(), s.path)
		}
		if err != nil {
			return fmt.Errorf("save preferences: %w", err)
		}
	}
	s.data = next
	return nil
}
