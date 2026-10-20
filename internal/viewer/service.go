// Package viewer adapts polisee-lib for a desktop policy explorer.
package viewer

import (
	"context"
	_ "embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/andareed/polisee-lib"
	"github.com/andareed/polisee-lib/fieldnames"
)

const MaxPolicyBytes = 64 << 20

//go:embed demo.xml
var DemoXML string

type Node struct {
	Key        string              `json:"key"`
	ID         string              `json:"id"`
	Parent     string              `json:"parent"`
	Name       string              `json:"name"`
	Kind       string              `json:"kind"`
	Enabled    bool                `json:"enabled"`
	Attributes []polisee.Attribute `json:"attributes,omitempty"`
	Extensions []polisee.Element   `json:"extensions,omitempty"`
}

type Document struct {
	Generation        uint64               `json:"generation"`
	Name              string               `json:"name"`
	Source            string               `json:"source"`
	FolderCount       int                  `json:"folderCount"`
	PolicyCount       int                  `json:"policyCount"`
	RuleCount         int                  `json:"ruleCount"`
	Nodes             []Node               `json:"nodes"`
	Properties        []string             `json:"properties"`
	Groups            []string             `json:"groups"`
	GroupSuggestions  []GroupOption        `json:"groupSuggestions"`
	Actions           []string             `json:"actions"`
	ActionValues      []string             `json:"actionValues"`
	Diagnostics       []polisee.Diagnostic `json:"diagnostics"`
	ActionSuggestions map[string][]string  `json:"actionSuggestions"`
	FieldLabels       map[string]string    `json:"fieldLabels"`
	InitialID         string               `json:"initialId"`
}

type Logic struct {
	Notice     string              `json:"notice,omitempty"`
	Text       string              `json:"text"`
	Attributes []polisee.Attribute `json:"attributes,omitempty"`
	Extensions []polisee.Element   `json:"extensions,omitempty"`
	Operator   string              `json:"operator"`
	Label      string              `json:"label,omitempty"`
	Field      string              `json:"field,omitempty"`
	Unknown    string              `json:"unknown,omitempty"`
	Filters    []polisee.Filter    `json:"filters,omitempty"`
	External   []string            `json:"external,omitempty"`
	Children   []Logic             `json:"children,omitempty"`
}

type RuleView struct {
	Rule     polisee.Rule  `json:"rule"`
	Logic    *Logic        `json:"logic"`
	Children []RuleView    `json:"children"`
	Actions  []ActionView  `json:"actions"`
	Segments SegmentTotals `json:"segments"`
}

type Detail struct {
	Generation uint64            `json:"generation"`
	View       RuleView          `json:"view"`
	Breadcrumb []polisee.NodeRef `json:"breadcrumb"`
}

type SearchResult struct {
	Generation uint64          `json:"generation"`
	Matches    []polisee.Match `json:"matches"`
}

// Service owns the current document. A failed load keeps the previous document;
// callers receive an error rather than a partially loaded policy tree.
type Service struct {
	mu           sync.RWMutex
	engine       *polisee.Engine
	display      *polisee.Engine
	segments     map[string][]indexedSegment
	document     Document
	loadSequence uint64
}

func New() *Service { return &Service{} }

func (s *Service) LoadDemo() (Document, error) {
	return s.LoadXML("Demonstration policies", DemoXML)
}

func (s *Service) LoadXML(name, text string) (Document, error) {
	if len(text) > MaxPolicyBytes {
		return Document{}, fmt.Errorf("policy export exceeds 64 MiB")
	}
	return s.load(context.Background(), strings.NewReader(text), name, name)
}

func (s *Service) LoadFile(ctx context.Context, path string) (Document, error) {
	f, err := os.Open(path)
	if err != nil {
		return Document{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return Document{}, err
	}
	if !info.Mode().IsRegular() {
		return Document{}, fmt.Errorf("choose a regular policy XML file")
	}
	if info.Size() > MaxPolicyBytes {
		return Document{}, fmt.Errorf("policy export exceeds 64 MiB")
	}
	return s.load(ctx, io.LimitReader(f, MaxPolicyBytes+1), filepath.Base(path), path)
}

func (s *Service) load(ctx context.Context, reader io.Reader, name, source string) (Document, error) {
	s.mu.Lock()
	s.loadSequence++
	sequence := s.loadSequence
	s.mu.Unlock()
	catalog, err := polisee.Parse(ctx, reader, source)
	if err != nil {
		return Document{}, err
	}
	engine, err := polisee.NewEngine(catalog)
	if err != nil {
		return Document{}, err
	}
	snapshot := engine.Snapshot()
	document := describe(snapshot, name)
	segments := indexSegments(&snapshot)
	display, err := polisee.NewEngine(&snapshot)
	if err != nil {
		return Document{}, err
	}
	document.Generation = sequence
	s.mu.Lock()
	defer s.mu.Unlock()
	if sequence != s.loadSequence {
		return Document{}, fmt.Errorf("a newer policy load replaced this request")
	}
	s.engine, s.display, s.segments, s.document = engine, display, segments, document
	return cloneDocument(document), nil
}

func (s *Service) Search(query polisee.Query) (SearchResult, error) {
	s.mu.RLock()
	engine, generation := s.engine, s.document.Generation
	s.mu.RUnlock()
	if engine == nil {
		return SearchResult{}, fmt.Errorf("open a policy export first")
	}
	return SearchResult{Generation: generation, Matches: engine.Search(query)}, nil
}

func (s *Service) GetRule(id string) (Detail, error) {
	s.mu.RLock()
	engine, segments, generation := s.display, s.segments, s.document.Generation
	s.mu.RUnlock()
	if engine == nil {
		return Detail{}, fmt.Errorf("open a policy export first")
	}
	rule, ok := engine.Rule(id)
	if !ok {
		return Detail{}, fmt.Errorf("unknown policy ID %q", id)
	}
	return Detail{Generation: generation, View: ruleView(engine, rule, segments), Breadcrumb: engine.Breadcrumb(id)}, nil
}

func ruleView(engine *polisee.Engine, rule polisee.Rule, segments map[string][]indexedSegment) RuleView {
	view := RuleView{Rule: rule, Logic: logicView(rule.Expression), Segments: segmentTotals(segments[rule.ID])}
	for _, action := range rule.Actions {
		view.Actions = append(view.Actions, actionView(action))
	}
	for _, child := range engine.Children(rule.ID) {
		view.Children = append(view.Children, ruleView(engine, child, segments))
	}
	return view
}

func logicView(expression *polisee.Expression) *Logic {
	if expression == nil {
		return nil
	}
	result := &Logic{Operator: expression.Type, External: expression.ExternalExpressions, Attributes: expression.Attributes, Extensions: expression.Extensions}
	if c := expression.Condition; c != nil {
		result.Label = fieldnames.Display(c.Field, c.Label)
		if result.Label == "" {
			result.Label = "Condition"
		}
		result.Attributes = append(append([]polisee.Attribute(nil), result.Attributes...), c.Attributes...)
		result.Extensions = append(append([]polisee.Element(nil), result.Extensions...), c.Extensions...)
		result.Field = c.Field
		if c.Logic != "" || c.LeftParentheses != 0 || c.RightParentheses != 0 {
			result.Notice = "Exported LOGIC/parenthesis attributes are preserved as metadata. This view shows the library expression tree; it does not normalize condition-level grouping or evaluate criteria."
		}
		result.Filters = c.Filters
		switch c.UnknownBehavior() {
		case polisee.UnknownTrue:
			result.Unknown = "Irresolvable criteria evaluate as true"
		case polisee.UnknownFalse:
			result.Unknown = "Irresolvable criteria evaluate as false"
		case polisee.UnknownNoOverride:
			result.Unknown = "Irresolvable criteria: no override"
		case polisee.UnknownUnsupported:
			result.Unknown = "Irresolvable criteria: " + c.UnknownResult
		}
	}
	for _, child := range expression.Children {
		childView := logicView(&child)
		if childView.Notice != "" {
			result.Notice = childView.Notice
		}
		result.Children = append(result.Children, *childView)
	}
	result.Text = logicText(result)
	return result
}

// logicText formats the library tree without normalizing operators or evaluating criteria.
func logicText(logic *Logic) string {
	parts := []string{}
	if logic.Label != "" {
		parts = append(parts, logic.Label)
		metadata := []string{}
		for _, attr := range logic.Attributes {
			metadata = append(metadata, attr.Name+"="+strconv.Quote(attr.Value))
		}
		if len(metadata) > 0 {
			parts = append(parts, "{"+strings.Join(metadata, ", ")+"}")
		}
		for _, filter := range logic.Filters {
			values := []string{}
			for _, attr := range filter.Attributes {
				values = append(values, attr.Name+"="+strconv.Quote(attr.Value))
			}
			if filter.Text != "" {
				values = append(values, strconv.Quote(filter.Text))
			}
			for _, operand := range filter.Operands {
				values = append(values, elementText(operand))
			}
			parts = append(parts, "FILTER("+strings.Join(values, ", ")+")")
		}
		if logic.Unknown != "" {
			parts = append(parts, logic.Unknown)
		}
	}
	for _, child := range logic.Children {
		parts = append(parts, child.Text)
	}
	for _, external := range logic.External {
		parts = append(parts, "External expression unavailable: "+strconv.Quote(external))
	}
	for _, extension := range logic.Extensions {
		parts = append(parts, elementText(extension))
	}
	if logic.Label != "" {
		return strings.Join(parts, " ")
	}
	return logic.Operator + "(\n  " + strings.ReplaceAll(strings.Join(parts, ",\n"), "\n", "\n  ") + "\n)"
}

func elementText(element polisee.Element) string {
	values := []string{element.Name}
	for _, attr := range element.Attributes {
		values = append(values, attr.Name+"="+strconv.Quote(attr.Value))
	}
	if element.Text != "" {
		values = append(values, strconv.Quote(element.Text))
	}
	for _, child := range element.Children {
		values = append(values, elementText(child))
	}
	return "[" + strings.Join(values, " ") + "]"
}

func describe(catalog polisee.Catalog, name string) Document {
	document := Document{Name: name, Source: catalog.Source, FolderCount: len(catalog.Folders), PolicyCount: len(catalog.Policies), Diagnostics: catalog.Diagnostics, ActionSuggestions: map[string][]string{}, FieldLabels: map[string]string{}}
	properties, actions, values := map[string]bool{}, map[string]bool{}, map[string]bool{}
	groups := newGroupOptions()
	for _, folder := range catalog.Folders {
		parent := ""
		if folder.ParentID != "" {
			parent = "folder:" + folder.ParentID
		}
		name := folder.Name
		if name == "" {
			name = "Unnamed folder"
		}
		document.Nodes = append(document.Nodes, Node{Key: "folder:" + folder.ID, ID: folder.ID, Parent: parent, Name: name, Kind: "folder", Enabled: true, Attributes: folder.Attributes, Extensions: folder.Extensions})
	}
	var elementOptions func(polisee.Element)
	elementOptions = func(element polisee.Element) {
		if element.Name == "GROUP" {
			groups.add(attributeText(element, "NAME"), attributeText(element, "ID"))
		}
		for _, a := range element.Attributes {
			if a.Name == "FIELD_NAME" || a.Name == "FILED_NAME" || a.Name == "COMP_FIELD_NAME" {
				properties[a.Value] = true
				properties[fieldnames.Label(a.Value, "")] = true
				document.FieldLabels[a.Value] = fieldnames.Display(a.Value, "")
			}
		}
		for _, child := range element.Children {
			elementOptions(child)
		}
	}
	for _, p := range catalog.Policies {
		for _, r := range p.Rules {
			parent, kind := "rule:"+r.ParentID, "subpolicy"
			if r.ParentID == "" {
				parent, kind = "folder:"+p.FolderID, "policy"
			}
			name := r.Name
			if name == "" {
				name = "Unnamed policy"
			}
			document.Nodes = append(document.Nodes, Node{Key: "rule:" + r.ID, ID: r.ID, Parent: parent, Name: name, Kind: kind, Enabled: r.EffectiveEnabled})
			document.RuleCount++
			if document.InitialID == "" {
				document.InitialID = r.ID
			}
			for _, c := range r.Expression.Conditions() {
				if c.Field != "" {
					properties[c.Field] = true
					document.FieldLabels[c.Field] = fieldnames.Display(c.Field, "")
					properties[fieldnames.Label(c.Field, c.Label)] = true
				}
				for _, f := range c.Filters {
					elementOptions(polisee.Element{Attributes: f.Attributes, Children: f.Operands})
				}
			}
			for _, scope := range r.Scope {
				elementOptions(scope)
			}
			for _, a := range r.Actions {
				actions[a.Name] = true
				for _, param := range a.Parameters {
					if param.Value != "" {
						values[param.Value] = true
						document.ActionSuggestions[a.Name] = append(document.ActionSuggestions[a.Name], param.Value)
						for _, part := range strings.Split(param.Value, ";") {
							if key, value, ok := strings.Cut(part, ":"); ok && strings.EqualFold(key, "name") && strings.TrimSpace(value) != "" {
								values[strings.TrimSpace(value)] = true
								document.ActionSuggestions[a.Name] = append(document.ActionSuggestions[a.Name], strings.TrimSpace(value))
							}
						}
						if strings.Contains(strings.ToLower(param.Name), "group") {
							groupName, groupID := displayReference(param.Value)
							if groupID != "" {
								groups.add(groupName, groupID)
							} else if strings.EqualFold(strings.ReplaceAll(param.Name, "_", "-"), "group-name") && !strings.Contains(param.Value, ":") {
								groups.add(param.Value, "")
							}
						}
					}
					for _, child := range param.Children {
						elementOptions(child)
						var suggest func(polisee.Element)
						suggest = func(node polisee.Element) {
							for _, attr := range node.Attributes {
								if attr.Value != "" && (attr.Name == "NAME" || attr.Name == "VALUE" || attr.Name == "VALUE2") {
									values[attr.Value] = true
									document.ActionSuggestions[a.Name] = append(document.ActionSuggestions[a.Name], attr.Value)
								}
							}
							if strings.TrimSpace(node.Text) != "" {
								values[node.Text] = true
								document.ActionSuggestions[a.Name] = append(document.ActionSuggestions[a.Name], node.Text)
							}
							for _, nested := range node.Children {
								suggest(nested)
							}
						}
						suggest(child)
					}
				}
			}
		}
	}
	document.GroupSuggestions = groups.sorted()
	groupNames := map[string]bool{}
	for _, group := range document.GroupSuggestions {
		groupNames[group.Name] = true
	}
	document.Properties, document.Groups, document.Actions, document.ActionValues = sortedKeys(properties), sortedKeys(groupNames), sortedKeys(actions), sortedKeys(values)
	return document
}

func sortedKeys(values map[string]bool) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		if value != "" {
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}

func cloneDocument(d Document) Document {
	d.Nodes = append([]Node(nil), d.Nodes...)
	for i := range d.Nodes {
		d.Nodes[i].Attributes = append([]polisee.Attribute(nil), d.Nodes[i].Attributes...)
		d.Nodes[i].Extensions = cloneElements(d.Nodes[i].Extensions)
	}
	labels := map[string]string{}
	for key, value := range d.FieldLabels {
		labels[key] = value
	}
	d.FieldLabels = labels
	suggestions := map[string][]string{}
	for key, value := range d.ActionSuggestions {
		suggestions[key] = append([]string(nil), value...)
	}
	d.ActionSuggestions = suggestions
	d.Properties = append([]string(nil), d.Properties...)
	d.Groups = append([]string(nil), d.Groups...)
	d.GroupSuggestions = append([]GroupOption(nil), d.GroupSuggestions...)
	d.Actions = append([]string(nil), d.Actions...)
	d.ActionValues = append([]string(nil), d.ActionValues...)
	d.Diagnostics = append([]polisee.Diagnostic(nil), d.Diagnostics...)
	return d
}

// Element data is detached because UI callers may mutate returned snapshots.
func cloneElements(elements []polisee.Element) []polisee.Element {
	if elements == nil {
		return nil
	}
	result := append([]polisee.Element(nil), elements...)
	for i := range result {
		result[i].Attributes = append([]polisee.Attribute(nil), result[i].Attributes...)
		result[i].ExternalExpressions = append([]string(nil), result[i].ExternalExpressions...)
		result[i].Children = cloneElements(result[i].Children)
	}
	return result
}
