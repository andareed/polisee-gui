// Package session coordinates native documents and opt-in startup preferences.
package session

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/andareed/polisee-gui/internal/settings"
	"github.com/andareed/polisee-gui/internal/viewer"
	"github.com/andareed/polisee-lib"
)

type State struct {
	Document    viewer.Document `json:"document"`
	Preferences settings.Data   `json:"preferences"`
	CanRemember bool            `json:"canRemember"`
	Warning     string          `json:"warning,omitempty"`
}

type Session struct {
	mu         sync.Mutex
	store      *settings.Store
	service    *viewer.Service
	document   viewer.Document
	path       string
	selectedID string
	generation uint64
}

func New(store *settings.Store) *Session { return &Session{store: store, service: viewer.New()} }

func (s *Session) state(warning string) State {
	document := s.document
	document.InitialID = s.selectedID
	return State{Document: document, Preferences: s.store.Snapshot(), CanRemember: s.path != "", Warning: warning}
}

func (s *Session) install(candidate *viewer.Service, document viewer.Document, path, selected string) {
	s.generation++
	document.Generation = s.generation
	s.service, s.document, s.path = candidate, document, path
	s.selectedID = document.InitialID
	for _, node := range document.Nodes {
		if node.Kind != "folder" && node.ID == selected {
			s.selectedID = selected
			break
		}
	}
}

// Startup always leaves a usable demo when a remembered file cannot be read or parsed.
func (s *Session) Startup(ctx context.Context) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	demo := viewer.New()
	document, err := demo.LoadDemo()
	if err != nil {
		return State{}, err
	}
	s.install(demo, document, "", "")
	saved := s.store.Snapshot()
	if saved.Remember {
		candidate := viewer.New()
		document, err := candidate.LoadFile(ctx, saved.Path)
		if err != nil {
			return s.state("Could not reopen the remembered policy: " + err.Error() + ". Open another file or disable remembering to forget it."), nil
		}
		s.install(candidate, document, saved.Path, saved.SelectedID)
	}
	return s.state(""), nil
}

func (s *Session) Open(ctx context.Context, path string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !strings.EqualFold(filepath.Ext(path), ".xml") {
		return State{}, fmt.Errorf("the selected file must have an .xml extension")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return State{}, err
	}
	candidate := viewer.New()
	document, err := candidate.LoadFile(ctx, absolute)
	if err != nil {
		return State{}, err
	}
	if s.store.Snapshot().Remember {
		if err := s.store.Change(func(data *settings.Data) error { data.Path, data.SelectedID = absolute, document.InitialID; return nil }); err != nil {
			return State{}, err
		}
	}
	s.install(candidate, document, absolute, "")
	return s.state(""), nil
}

func (s *Session) Import(name, text string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	candidate := viewer.New()
	document, err := candidate.LoadXML(name, text)
	if err != nil {
		return State{}, err
	}
	// Imports/demo never replace the saved native path or selection.
	s.install(candidate, document, "", "")
	return s.state(""), nil
}

func (s *Session) Remember(enabled bool) (settings.Data, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if enabled && s.path == "" {
		return s.store.Snapshot(), fmt.Errorf("open a native policy file before enabling startup reopening")
	}
	err := s.store.Change(func(data *settings.Data) error {
		data.Remember = enabled
		if enabled {
			data.Path, data.SelectedID = s.path, s.selectedID
		}
		return nil
	})
	return s.store.Snapshot(), err
}

func (s *Session) Select(generation uint64, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.generation {
		return nil
	} // Ignore a delayed selection from an older document.
	if _, err := s.service.GetRule(id); err != nil {
		return err
	}
	saved := s.store.Snapshot()
	if saved.Remember && s.path != "" && saved.SelectedID != id {
		if err := s.store.Change(func(data *settings.Data) error { data.SelectedID = id; return nil }); err != nil {
			return err
		}
	}
	s.selectedID = id
	return nil
}

func (s *Session) Search(query polisee.Query) (viewer.SearchResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result, err := s.service.Search(query)
	result.Generation = s.generation
	return result, err
}
func (s *Session) Rule(id string) (viewer.Detail, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result, err := s.service.GetRule(id)
	result.Generation = s.generation
	return result, err
}

func (s *Session) Segments(query viewer.BrowseQuery) (viewer.SegmentPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if query.Generation != s.generation {
		return viewer.SegmentPage{}, fmt.Errorf("this policy document has been replaced")
	}
	query.Generation = 0 // The session generation was checked above.
	result, err := s.service.Segments(query)
	result.Generation = s.generation
	return result, err
}

func (s *Session) Ranges(query viewer.BrowseQuery) (viewer.RangePage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if query.Generation != s.generation {
		return viewer.RangePage{}, fmt.Errorf("this policy document has been replaced")
	}
	query.Generation = 0
	result, err := s.service.Ranges(query)
	result.Generation = s.generation
	return result, err
}
