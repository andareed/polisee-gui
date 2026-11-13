package viewer

import (
	"fmt"

	"github.com/andareed/polisee-lib"
)

type PolicyExport struct {
	Filename string `json:"filename"`
	XML      string `json:"xml"`
}

func (s *Service) ExportPolicy(generation uint64, id string) (PolicyExport, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.engine == nil || generation != s.document.Generation {
		return PolicyExport{}, fmt.Errorf("the policy document changed; select the policy again")
	}
	text, err := s.engine.ExportPolicy(id)
	if err != nil {
		return PolicyExport{}, err
	}
	p, _ := s.engine.Policy(id)
	return PolicyExport{Filename: polisee.PolicyFilename(p.Rules[0].Name), XML: text}, nil
}
