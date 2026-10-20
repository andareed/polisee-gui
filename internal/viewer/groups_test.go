package viewer

import (
	"strings"
	"testing"

	"github.com/andareed/polisee-lib"
)

func TestGroupSuggestionsUseNamesAndRetainTypedIDMatching(t *testing.T) {
	s := New()
	document, err := s.LoadXML("groups.xml", `<POLICY_FOLDER ID="f"><RULE ID="r">
<GROUP_IN_FILTER><GROUP ID="staff-1" NAME="Office"/><GROUP ID="staff-1" NAME="Office"/><GROUP ID="staff-2" NAME="Office"/><GROUP ID="id-only"/></GROUP_IN_FILTER>
<ACTION NAME="ADD_GROUP"><PARAM NAME="group-name" VALUE="id:staff-1;name:Office"/><PARAM NAME="group-name" VALUE="Operations"/><PARAM NAME="group" VALUE="raw-id-only"/></ACTION>
</RULE></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	if len(document.GroupSuggestions) != 3 || len(document.Groups) != 2 {
		t.Fatalf("suggestions: %+v, %+v", document.GroupSuggestions, document.Groups)
	}
	for _, name := range document.Groups {
		if strings.Contains(name, "id:") || strings.Contains(name, "staff-") || strings.Contains(name, "id-only") {
			t.Fatalf("ID or encoded string offered as a name: %q", name)
		}
	}
	if document.GroupSuggestions[0].Name != "Office" || document.GroupSuggestions[0].ID == document.GroupSuggestions[1].ID {
		t.Fatal("same names with different IDs cannot be distinguished")
	}
	for _, term := range []string{"Office", "staff-1", "staff-2", "id-only", "raw-id-only"} {
		result, err := s.Search(polisee.Query{Group: term})
		if err != nil || len(result.Matches) != 1 {
			t.Fatalf("group query %q: %+v, %v", term, result, err)
		}
	}
	document.GroupSuggestions[0].Name = "changed"
	if s.document.GroupSuggestions[0].Name == "changed" {
		t.Fatal("returned suggestions changed shared state")
	}
}
