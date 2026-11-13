package session

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/andareed/polisee-gui/internal/viewer"
)

func (s *Session) ExportPolicy(generation uint64, id string) (viewer.PolicyExport, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.generation {
		return viewer.PolicyExport{}, fmt.Errorf("the policy document changed; select the policy again")
	}
	return s.service.ExportPolicy(s.serviceGeneration, id)
}

func (s *Session) SavePolicy(generation uint64, id, path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.generation {
		return fmt.Errorf("the policy document changed; select the policy again")
	}
	export, err := s.service.ExportPolicy(s.serviceGeneration, id)
	if err != nil {
		return err
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if s.path != "" {
		source, _ := os.Stat(s.path)
		target, _ := os.Stat(absolute)
		if absolute == s.path || (source != nil && target != nil && os.SameFile(source, target)) {
			return fmt.Errorf("choose a different file to preserve the loaded policy export")
		}
	}
	f, err := os.CreateTemp(filepath.Dir(absolute), ".polisee-export-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, writeErr := f.WriteString(export.XML)
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), absolute)
}
