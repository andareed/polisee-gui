package viewer

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/andareed/polisee-lib"
)

const SegmentPageSize = 8
const RangePageSize = 25

type SegmentTotals struct {
	Count  int `json:"count"`
	Ranges int `json:"ranges"`
}

type SegmentSummary struct {
	Key        string `json:"key"`
	Name       string `json:"name"`
	ID         string `json:"id"`
	RangeCount int    `json:"rangeCount"`
}

type BrowseQuery struct {
	Generation uint64 `json:"generation"`
	RuleID     string `json:"ruleId"`
	SegmentKey string `json:"segmentKey"`
	Text       string `json:"text"`
	Page       int    `json:"page"`
}

type SegmentPage struct {
	Generation uint64           `json:"generation"`
	Rows       []SegmentSummary `json:"rows"`
	Total      int              `json:"total"`
	Filtered   int              `json:"filtered"`
	Page       int              `json:"page"`
	PageSize   int              `json:"pageSize"`
}

type RangeRow struct {
	Index int             `json:"index"`
	From  *string         `json:"from"`
	To    *string         `json:"to"`
	ID    string          `json:"id"`
	Raw   polisee.Element `json:"raw"`
}

type RangePage struct {
	Generation uint64          `json:"generation"`
	Segment    SegmentSummary  `json:"segment"`
	Metadata   polisee.Element `json:"metadata"`
	Rows       []RangeRow      `json:"rows"`
	Total      int             `json:"total"`
	Filtered   int             `json:"filtered"`
	Page       int             `json:"page"`
	PageSize   int             `json:"pageSize"`
}

type indexedRange struct {
	row  RangeRow
	text string
}
type indexedSegment struct {
	summary  SegmentSummary
	metadata polisee.Element
	ranges   []indexedRange
}

func attributeText(node polisee.Element, name string) string {
	value := attributePointer(node, name)
	if value == nil {
		return ""
	}
	return *value
}

func attributePointer(node polisee.Element, name string) *string {
	for _, attribute := range node.Attributes {
		if attribute.Namespace == "" && strings.EqualFold(attribute.Name, name) {
			value := attribute.Value
			return &value
		}
	}
	return nil
}

// Index the library's preserved element tree for paged inspection. The complete
// engine remains authoritative for policy queries. No IP arithmetic, reference
// resolution or policy interpretation is performed by this presentation index.
func indexSegments(catalog *polisee.Catalog) map[string][]indexedSegment {
	index := map[string][]indexedSegment{}
	for pi := range catalog.Policies {
		for ri := range catalog.Policies[pi].Rules {
			rule := &catalog.Policies[pi].Rules[ri]
			var strip func([]polisee.Element) []polisee.Element
			strip = func(nodes []polisee.Element) []polisee.Element {
				var kept []polisee.Element
				for _, node := range nodes {
					if strings.EqualFold(node.Name, "SEGMENT") {
						entry := indexedSegment{summary: SegmentSummary{Key: strconv.Itoa(len(index[rule.ID])), Name: attributeText(node, "NAME"), ID: attributeText(node, "ID")}}
						var collect func(polisee.Element) polisee.Element
						collect = func(value polisee.Element) polisee.Element {
							copy := value
							copy.Children = nil
							for _, child := range value.Children {
								if strings.EqualFold(child.Name, "RANGE") {
									row := RangeRow{Index: len(entry.ranges), From: attributePointer(child, "FROM"), To: attributePointer(child, "TO"), ID: attributeText(child, "ID"), Raw: child}
									entry.ranges = append(entry.ranges, indexedRange{row: row, text: strings.ToLower(elementText(child))})
								} else {
									copy.Children = append(copy.Children, collect(child))
								}
							}
							return copy
						}
						entry.metadata = collect(node)
						entry.summary.RangeCount = len(entry.ranges)
						index[rule.ID] = append(index[rule.ID], entry)
					} else {
						node.Children = strip(node.Children)
						kept = append(kept, node)
					}
				}
				return kept
			}
			rule.Scope = strip(rule.Scope)
		}
	}
	return index
}

func segmentTotals(segments []indexedSegment) SegmentTotals {
	totals := SegmentTotals{Count: len(segments)}
	for _, segment := range segments {
		totals.Ranges += segment.summary.RangeCount
	}
	return totals
}

func pageBounds(page, count, size int) (int, int, int) {
	last := 0
	if count > 0 {
		last = (count - 1) / size
	}
	if page > last {
		page = last
	}
	start := page * size
	end := min(start+size, count)
	return page, start, end
}

func (s *Service) browseValid(query BrowseQuery) error {
	if s.display == nil {
		return fmt.Errorf("open a policy export first")
	}
	if query.Generation != 0 && query.Generation != s.document.Generation {
		return fmt.Errorf("this policy document has been replaced")
	}
	if query.Page < 0 {
		return fmt.Errorf("page must not be negative")
	}
	if _, ok := s.display.Rule(query.RuleID); !ok {
		return fmt.Errorf("unknown policy ID %q", query.RuleID)
	}
	return nil
}

func (s *Service) Segments(query BrowseQuery) (SegmentPage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if err := s.browseValid(query); err != nil {
		return SegmentPage{}, err
	}
	segments := s.segments[query.RuleID]
	text := strings.ToLower(strings.TrimSpace(query.Text))
	var matches []SegmentSummary
	for _, segment := range segments {
		if text == "" || strings.Contains(strings.ToLower(segment.summary.Name+" "+segment.summary.ID), text) {
			matches = append(matches, segment.summary)
		}
	}
	page, start, end := pageBounds(query.Page, len(matches), SegmentPageSize)
	return SegmentPage{Generation: s.document.Generation, Rows: append([]SegmentSummary{}, matches[start:end]...), Total: len(segments), Filtered: len(matches), Page: page, PageSize: SegmentPageSize}, nil
}

func (s *Service) Ranges(query BrowseQuery) (RangePage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if err := s.browseValid(query); err != nil {
		return RangePage{}, err
	}
	var selected *indexedSegment
	for i := range s.segments[query.RuleID] {
		if s.segments[query.RuleID][i].summary.Key == query.SegmentKey {
			selected = &s.segments[query.RuleID][i]
			break
		}
	}
	if selected == nil {
		return RangePage{}, fmt.Errorf("unknown segment %q", query.SegmentKey)
	}
	// Literal table filtering only; policy matching still goes through polisee-lib.
	text := strings.ToLower(strings.TrimSpace(query.Text))
	var matches []int
	for i, row := range selected.ranges {
		if text == "" || strings.Contains(row.text, text) {
			matches = append(matches, i)
		}
	}
	page, start, end := pageBounds(query.Page, len(matches), RangePageSize)
	rows := make([]RangeRow, 0, end-start)
	for _, i := range matches[start:end] {
		row := selected.ranges[i].row
		row.Raw = cloneElements([]polisee.Element{row.Raw})[0]
		if row.From != nil {
			value := *row.From
			row.From = &value
		}
		if row.To != nil {
			value := *row.To
			row.To = &value
		}
		rows = append(rows, row)
	}
	return RangePage{Generation: s.document.Generation, Segment: selected.summary, Metadata: cloneElements([]polisee.Element{selected.metadata})[0], Rows: rows, Total: len(selected.ranges), Filtered: len(matches), Page: page, PageSize: RangePageSize}, nil
}
