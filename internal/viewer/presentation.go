package viewer

import (
	"strings"
	"unicode"

	"github.com/andareed/polisee-lib"
)

// ActionView supplies display text without changing the library's raw action.
// Diagnostics and searches continue to use Rule.Actions, including empty values.
type ActionView struct {
	Label       string              `json:"label"`
	Disabled    bool                `json:"disabled"`
	Parameters  []ParameterView     `json:"parameters"`
	Identifiers []polisee.Attribute `json:"identifiers,omitempty"`
	Schedules   []polisee.Element   `json:"schedules"`
}

type ParameterView struct {
	SourceIndex int               `json:"sourceIndex"`
	Label       string            `json:"label"`
	Value       string            `json:"value"`
	ReferenceID string            `json:"referenceId,omitempty"`
	Primary     bool              `json:"primary"`
	Secondary   bool              `json:"secondary"`
	Children    []polisee.Element `json:"children"`
}

func actionView(action polisee.Action) ActionView {
	view := ActionView{Label: displayLabel(action.Name), Disabled: action.Disabled, Schedules: action.Schedules}
	for _, attribute := range action.Attributes {
		if identifierName(attribute.Name) {
			view.Identifiers = append(view.Identifiers, attribute)
		}
	}
	var settings, secondary []ParameterView
	for index, parameter := range action.Parameters {
		key := strings.ToLower(strings.ReplaceAll(parameter.Name, "-", "_"))
		label := displayLabel(parameter.Name)
		if key == "group_name" {
			label = "Group"
		}
		value := parameter.Value
		var referenceID string
		if strings.Contains(key, "group") {
			value, referenceID = displayReference(value)
		}
		isSecondary := identifierName(parameter.Name) || key == "item_key" || (value == "" && len(parameter.Children) == 0)
		field := ParameterView{
			SourceIndex: index,
			Label:       label, Value: value, ReferenceID: referenceID, Children: parameter.Children,
			Primary: (key == "group" || key == "group_name") && !isSecondary, Secondary: isSecondary,
		}
		if field.Primary {
			view.Parameters = append(view.Parameters, field)
		} else if field.Secondary {
			secondary = append(secondary, field)
		} else {
			settings = append(settings, field)
		}
	}
	view.Parameters = append(view.Parameters, settings...)
	view.Parameters = append(view.Parameters, secondary...)
	return view
}

func identifierName(name string) bool {
	key := strings.ToLower(strings.ReplaceAll(name, "-", "_"))
	for _, suffix := range []string{"id", "guid", "uuid"} {
		if key == suffix || strings.HasSuffix(key, "_"+suffix) {
			return true
		}
	}
	return false
}

func displayLabel(value string) string {
	words := strings.FieldsFunc(value, func(r rune) bool { return r == '_' || r == '-' || unicode.IsSpace(r) })
	for i, word := range words {
		words[i] = strings.ToLower(word)
		if strings.EqualFold(word, "id") || strings.EqualFold(word, "guid") || strings.EqualFold(word, "uuid") {
			words[i] = strings.ToUpper(word)
		}
	}
	label := []rune(strings.Join(words, " "))
	if len(label) > 0 {
		label[0] = unicode.ToUpper(label[0])
	}
	return string(label)
}

// A complete exported id/name pair supplies a prominent name and an adjacent,
// secondary ID. Unknown formats retain their complete original value.
func displayReference(value string) (string, string) {
	parts := strings.Split(value, ";")
	if len(parts) != 2 {
		return value, ""
	}
	var name, id string
	for _, part := range parts {
		key, text, ok := strings.Cut(part, ":")
		if !ok {
			return value, ""
		}
		switch strings.ToLower(key) {
		case "id":
			id = text
		case "name":
			name = text
		default:
			return value, ""
		}
	}
	if strings.TrimSpace(id) == "" || strings.TrimSpace(name) == "" {
		return value, ""
	}
	return name, id
}
