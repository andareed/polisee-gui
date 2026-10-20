package viewer

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/andareed/polisee-lib"
)

func segmentFixture(segments, ranges int) string {
	var xml strings.Builder
	xml.WriteString(`<POLICY_FOLDER ID="f"><RULE ID="large" NAME="Large policy">`)
	for segment := 0; segment < segments; segment++ {
		fmt.Fprintf(&xml, `<SEGMENT NAME="Segment %02d" ID="segment-%d" CUSTOM="&lt;literal&gt;"><RANGES LABEL="Original wrapper">`, segment, segment)
		for row := 0; row < ranges; row++ {
			fmt.Fprintf(&xml, `<RANGE ID="range-%d-%d" FROM="10.%d.%d.%d" TO="10.%d.%d.%d" CUSTOM="raw-%d"/>`, segment, row, segment, row/254, row%254, segment, row/254, row%254+1, row)
		}
		xml.WriteString(`</RANGES></SEGMENT>`)
	}
	xml.WriteString(`</RULE></POLICY_FOLDER>`)
	return xml.String()
}

func TestLargeSegmentsArePagedBeforeTransport(t *testing.T) {
	s := New()
	document, err := s.LoadXML("large.xml", segmentFixture(20, 2100))
	if err != nil {
		t.Fatal(err)
	}
	detail, err := s.GetRule("large")
	if err != nil {
		t.Fatal(err)
	}
	if detail.View.Segments.Count != 20 || detail.View.Segments.Ranges != 42000 || len(detail.View.Rule.Scope) != 0 {
		t.Fatalf("compact detail: %+v", detail.View.Segments)
	}
	encoded, err := json.Marshal(detail)
	if err != nil || len(encoded) > 5000 {
		t.Fatalf("initial detail includes bulk segment data: %d bytes, %v", len(encoded), err)
	}
	query := BrowseQuery{Generation: document.Generation, RuleID: "large", Page: 1}
	page, err := s.Segments(query)
	if err != nil || len(page.Rows) != SegmentPageSize || page.Total != 20 || page.Rows[0].ID != "segment-8" {
		t.Fatalf("segment page: %+v, %v", page, err)
	}
	query.Page = int(^uint(0) >> 1)
	last, err := s.Segments(query)
	if err != nil || last.Page != 2 || len(last.Rows) != 4 {
		t.Fatalf("clamped page: %+v, %v", last, err)
	}
	query.SegmentKey, query.Page = "0", 1
	ranges, err := s.Ranges(query)
	if err != nil || len(ranges.Rows) != RangePageSize || ranges.Total != 2100 || ranges.Rows[0].Index != 25 {
		t.Fatalf("range page: %+v, %v", ranges, err)
	}
	if ranges.Metadata.Attributes[2].Value != "<literal>" || ranges.Metadata.Children[0].Attributes[0].Value != "Original wrapper" || len(ranges.Metadata.Children[0].Children) != 0 {
		t.Fatal("segment metadata was changed or still contains every range")
	}
	ranges.Rows[0].Raw.Attributes[0].Value = "changed"
	*ranges.Rows[0].From = "changed"
	ranges.Metadata.Attributes[0].Value = "changed"
	again, _ := s.Ranges(query)
	if again.Rows[0].ID != "range-0-25" || again.Rows[0].Raw.Attributes[0].Value == "changed" || *again.Rows[0].From == "changed" || again.Metadata.Attributes[0].Value == "changed" {
		t.Fatal("paged values changed the shared index")
	}
	query.Text, query.Page = "range-0-2099", 0
	filtered, err := s.Ranges(query)
	if err != nil || filtered.Filtered != 1 || filtered.Total != 2100 || filtered.Rows[0].Index != 2099 {
		t.Fatalf("literal range filter: %+v, %v", filtered, err)
	}
	query.Text = "segment-19"
	segments, err := s.Segments(query)
	if err != nil || segments.Filtered != 1 || segments.Rows[0].ID != "segment-19" {
		t.Fatalf("segment ID filter: %+v, %v", segments, err)
	}
	// Policy search must still use the full library catalog, including ranges
	// which were omitted from the presentation engine's compact detail payload.
	matches, err := s.Search(polisee.Query{Text: "range-19-2099"})
	if err != nil || len(matches.Matches) != 1 || matches.Matches[0].RuleID != "large" {
		t.Fatal("paged presentation changed library policy matching")
	}
	if _, err := s.LoadXML("bad.xml", `<OTHER/>`); err == nil {
		t.Fatal("invalid document accepted")
	}
	if _, err := s.Segments(query); err != nil {
		t.Fatal("failed load discarded the current segment index", err)
	}
	if _, err := s.LoadDemo(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Ranges(query); err == nil {
		t.Fatal("stale document generation accepted")
	}
}

func TestSegmentsRetainUnknownAndEmptyValues(t *testing.T) {
	s := New()
	_, err := s.LoadXML("raw.xml", `<POLICY_FOLDER ID="f"><RULE ID="r"><SEGMENT ID="same" NAME="&lt;name&gt;">
<!-- Rule expression element is stored at /unavailable/ranges.xml -->
<RANGE ID="first" FROM="" TO="  raw  "><FUTURE FLAG="&lt;value&gt;"/></RANGE><RANGE CUSTOM="future-only"/>
</SEGMENT><SEGMENT ID="same" NAME="Second"/></RULE></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	segments, _ := s.Segments(BrowseQuery{RuleID: "r"})
	if len(segments.Rows) != 2 || segments.Rows[0].Key == segments.Rows[1].Key {
		t.Fatal("duplicate exported IDs conflated separate segments")
	}
	page, err := s.Ranges(BrowseQuery{RuleID: "r", SegmentKey: segments.Rows[0].Key})
	if err != nil || page.Segment.Name != "<name>" || len(page.Rows) != 2 {
		t.Fatal("raw segment data lost", err)
	}
	if page.Rows[0].From == nil || *page.Rows[0].From != "" || *page.Rows[0].To != "  raw  " || page.Rows[1].From != nil || page.Rows[0].Raw.Children[0].Attributes[0].Value != "<value>" {
		t.Fatal("absent, empty, literal or future values changed")
	}
	if len(page.Metadata.ExternalExpressions) != 1 {
		t.Fatal("unavailable external expression notice lost")
	}
	for _, query := range []BrowseQuery{{RuleID: "r", Page: -1}, {RuleID: "missing"}, {RuleID: "r", SegmentKey: "missing"}} {
		if _, err := s.Ranges(query); err == nil {
			t.Fatalf("invalid range query accepted: %+v", query)
		}
	}
}

func TestConcurrentBrowseAndReload(t *testing.T) {
	s := New()
	fixture := segmentFixture(4, 80)
	if _, err := s.LoadXML("concurrent.xml", fixture); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 20; i++ {
				page, err := s.Ranges(BrowseQuery{RuleID: "large", SegmentKey: "1", Page: 1})
				if err != nil || page.Total != 80 || len(page.Rows) != RangePageSize {
					t.Errorf("concurrent page: %v", err)
					return
				}
				page.Rows[0].Raw.Attributes[0].Value = "caller mutation"
			}
		}()
	}
	for i := 0; i < 3; i++ {
		if _, err := s.LoadXML("concurrent.xml", fixture); err != nil {
			t.Fatal(err)
		}
	}
	wg.Wait()
}
