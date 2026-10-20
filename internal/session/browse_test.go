package session

import (
	"testing"

	"github.com/andareed/polisee-gui/internal/settings"
	"github.com/andareed/polisee-gui/internal/viewer"
)

func TestBrowseUsesSessionGenerationAndRejectsReplacedDocuments(t *testing.T) {
	// In-memory settings keep this test independent of the user's preferences.
	store, err := settings.Open("")
	if err != nil {
		t.Fatal(err)
	}
	s := New(store)
	fixture := `<POLICY_FOLDER ID="f"><RULE ID="r"><SEGMENT ID="s" NAME="Office"><RANGE FROM="192.0.2.1" TO="192.0.2.9"/></SEGMENT></RULE></POLICY_FOLDER>`
	first, err := s.Import("one.xml", fixture)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Import("two.xml", fixture)
	if err != nil {
		t.Fatal(err)
	}
	query := viewer.BrowseQuery{Generation: second.Document.Generation, RuleID: "r", SegmentKey: "0"}
	segments, err := s.Segments(query)
	if err != nil || segments.Generation != second.Document.Generation || len(segments.Rows) != 1 {
		t.Fatal("session generation was not translated for segments", err)
	}
	ranges, err := s.Ranges(query)
	if err != nil || ranges.Generation != second.Document.Generation || len(ranges.Rows) != 1 {
		t.Fatal("session generation was not translated for ranges", err)
	}
	query.Generation = first.Document.Generation
	if _, err := s.Ranges(query); err == nil {
		t.Fatal("old range request accepted after replacement")
	}
	if _, err := s.Segments(query); err == nil {
		t.Fatal("old segment request accepted after replacement")
	}
}
