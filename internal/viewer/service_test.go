package viewer

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/andareed/polisee-lib"
)

func TestLibraryBackedDocumentAndDetails(t *testing.T) {
	s := New()
	doc, err := s.LoadDemo()
	if err != nil {
		t.Fatal(err)
	}
	if doc.RuleCount != 3 || doc.PolicyCount != 1 || len(doc.Nodes) != 4 || doc.InitialID != "office" {
		t.Fatalf("document: %+v", doc)
	}
	view, err := s.GetRule("office")
	if err != nil {
		t.Fatal(err)
	}
	if view.Generation != doc.Generation || view.View.Logic.Operator != "AND" || view.View.Logic.Children[0].Operator != "OR" {
		t.Fatal("library boolean hierarchy lost")
	}
	if len(view.View.Children) != 1 || len(view.View.Children[0].Children) != 1 {
		t.Fatal("nested policy ownership lost")
	}
	child := view.View.Children[0].Children[0].Rule
	if !child.Enabled || child.EffectiveEnabled {
		t.Fatal("declared and inherited state conflated")
	}
	view.View.Rule.Actions[0].Schedules[0].Children[0].Attributes[0].Value = "changed"
	view.View.Logic.Children[0].Children[0].Label = "changed"
	again, _ := s.GetRule("office")
	if again.View.Rule.Actions[0].Schedules[0].Children[0].Attributes[0].Value == "changed" || again.View.Logic.Children[0].Children[0].Label == "changed" {
		t.Fatal("returned values changed service state")
	}
	if _, err := s.GetRule("missing"); err == nil {
		t.Fatal("unknown rule accepted")
	}
}

func TestSharedQueriesAndFieldLabels(t *testing.T) {
	s := New()
	if _, err := s.LoadDemo(); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		query polisee.Query
		want  int
	}{
		{polisee.Query{Group: "Office devices", Property: "device.os"}, 1},
		{polisee.Query{Text: `"Guest access"`}, 1},
		{polisee.Query{Action: "SET_GROUP", ActionValue: "ops@example.test"}, 0},
		{polisee.Query{Action: "SEND_NOTIFICATION", ActionValue: "ops@example.test"}, 1},
	} {
		result, err := s.Search(test.query)
		if err != nil || len(result.Matches) != test.want {
			t.Fatalf("query %+v: %+v, %v", test.query, result, err)
		}
	}
	_, err := s.LoadXML("labels", `<POLICY_FOLDER ID="f"><RULE ID="r"><CONDITION FIELD_NAME="application" LABEL="Applications Installed (Obsolete)"/></RULE></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.Search(polisee.Query{Property: "Windows Applications Installed"})
	if err != nil || len(result.Matches) != 1 {
		t.Fatal("shared friendly-field search not used")
	}
	view, _ := s.GetRule("r")
	if view.View.Logic.Label != "Windows Applications Installed [application]" {
		t.Fatalf("label: %+v", view.View.Logic)
	}
}

func TestFailedLoadsKeepTheCurrentDocument(t *testing.T) {
	s := New()
	doc, err := s.LoadDemo()
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{`<OTHER/>`, `<POLICY_FOLDER/>`, `<POLICY_FOLDER ID="f"><RULE ID="r"/><RULE ID="r"/></POLICY_FOLDER>`} {
		if _, err := s.LoadXML("invalid", input); err == nil {
			t.Fatal("shared validation bypassed")
		}
	}
	current, err := s.GetRule("office")
	if err != nil || current.Generation != doc.Generation {
		t.Fatal("failed load replaced current policy")
	}
}

func TestLocalFileLoadingAndCancellation(t *testing.T) {
	s := New()
	path := filepath.Join(t.TempDir(), "policy.xml")
	if err := os.WriteFile(path, []byte(DemoXML), 0600); err != nil {
		t.Fatal(err)
	}
	doc, err := s.LoadFile(context.Background(), path)
	if err != nil || doc.Name != "policy.xml" {
		t.Fatalf("file load: %+v, %v", doc, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.LoadFile(ctx, path); err == nil {
		t.Fatal("cancelled load succeeded")
	}
	if _, err := s.LoadFile(context.Background(), filepath.Dir(path)); err == nil {
		t.Fatal("directory accepted")
	}
	if _, err := s.LoadFile(context.Background(), path+".missing"); err == nil {
		t.Fatal("missing file accepted")
	}
}

func TestConcurrentReadQueriesAndReloads(t *testing.T) {
	s := New()
	if _, err := s.LoadDemo(); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				if _, err := s.Search(polisee.Query{Text: "Office"}); err != nil {
					t.Error(err)
				}
				if _, err := s.GetRule("office"); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	for i := 0; i < 3; i++ {
		if _, err := s.LoadDemo(); err != nil {
			t.Fatal(err)
		}
	}
	wg.Wait()
}

func TestRawValuesRemainAvailable(t *testing.T) {
	s := New()
	if _, err := s.LoadXML("multiline", `<POLICY_FOLDER ID="f"><RULE ID="r" DESCRIPTION="First&#10;Second"><ACTION NAME="a"><PARAM NAME="text" VALUE="Line&#10;Break"/></ACTION></RULE></POLICY_FOLDER>`); err != nil {
		t.Fatal(err)
	}
	view, _ := s.GetRule("r")
	if !strings.Contains(view.View.Rule.Description, "\n") || !strings.Contains(view.View.Rule.Actions[0].Parameters[0].Value, "\n") {
		t.Fatal("raw values were sanitized by the UI service")
	}
}

func TestParityTreeTextSuggestionsAndRawMetadata(t *testing.T) {
	s := New()
	doc, err := s.LoadXML("synthetic.xml", `<POLICY_FOLDER ID="f" NAME="Only folder" CUSTOM="raw">
 <RULE ID="root" ENABLED="false"><EXPRESSION EXPR_TYPE="AND">
 <CONDITION FIELD_NAME="application" LABEL="Applications Installed (Obsolete)" LOGIC="OR" LEFT_PARENTHESIS="1"><FILTER TYPE="CUSTOM_COMPARISON" VALUE="&lt;img src=x onerror=bad&gt;"/></CONDITION>
 <EXPRESSION EXPR_TYPE="CUSTOM_OPERATOR"><CONDITION FIELD_NAME="vendor" LABEL="Vendor" RIGHT_PARENTHESIS="1"/></EXPRESSION></EXPRESSION>
 <ACTION NAME="ADD_GROUP"><PARAM NAME="group" VALUE="id:123;name:Trusted Devices"/></ACTION>
 <ACTION NAME="OTHER"><PARAM NAME="message" VALUE="Unrelated"/></ACTION>
 <ACTION NAME="NESTED"><PARAM NAME="group"><GROUP ID="g" NAME="Nested group"/></PARAM></ACTION>
 <INNER_RULE ID="z" ENABLED="true"/><INNER_RULE ID="a" ENABLED="true"/>
 </RULE></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Nodes[2].ID != "z" || doc.Nodes[3].ID != "a" || doc.Nodes[2].Enabled {
		t.Fatal("source order/inherited enabled state lost")
	}
	if len(doc.Nodes[0].Attributes) != 3 {
		t.Fatal("folder metadata lost")
	}
	if doc.FieldLabels["application"] != "Windows Applications Installed [application]" {
		t.Fatal("labels not supplied by library")
	}
	if !contains(doc.ActionSuggestions["ADD_GROUP"], "Trusted Devices") || contains(doc.ActionSuggestions["ADD_GROUP"], "Unrelated") || !contains(doc.ActionSuggestions["NESTED"], "Nested group") {
		t.Fatalf("suggestions %+v", doc.ActionSuggestions)
	}
	detail, err := s.GetRule("root")
	if err != nil {
		t.Fatal(err)
	}
	logic := detail.View.Logic
	for _, text := range []string{"\nAND ", "CUSTOM_OPERATOR (exported expression; not evaluated)", "CUSTOM_COMPARISON", "<img src=x onerror=bad>"} {
		if !strings.Contains(logic.Text, text) {
			t.Fatalf("text missing %q: %s", text, logic.Text)
		}
	}
	for name, want := range map[string]string{"LOGIC": "OR", "LEFT_PARENTHESIS": "1"} {
		if got, ok := polisee.AttributeValue(logic.Children[0].Attributes, name); !ok || got != want {
			t.Fatalf("raw %s metadata lost: %q", name, got)
		}
	}
	if logic.Notice == "" {
		t.Fatal("condition grouping API limitation hidden")
	}
	if logic.Children[1].Children[0].Label != "Vendor [vendor]" {
		t.Fatal("library label alias changed")
	}
	// Snapshot modifications cannot change later reads.
	doc.Nodes[0].Attributes[0].Value = "changed"
	doc.ActionSuggestions["ADD_GROUP"][0] = "changed"
	detail.View.Logic.Children[0].Filters[0].Attributes[0].Value = "changed"
	again, _ := s.GetRule("root")
	if strings.Contains(again.View.Logic.Text, "changed") {
		t.Fatal("returned view mutated engine")
	}
	// Public query semantics: direct rule matches, no folder-only matches.
	matches, _ := s.Search(polisee.Query{Text: "Only folder"})
	if len(matches.Matches) != 0 {
		t.Fatal("adapter invented folder query semantics")
	}
}
func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestReferencePolicyAndRuleChainContainers(t *testing.T) {
	s := New()
	doc, err := s.LoadXML("chain.xml", `<POLICY_FOLDER ID="f"><POLICIES><POLICY ID="container"><RULE ID="main" ENABLED="false">
 <EXPRESSION EXPR_TYPE="SIMPLE"><CONDITION FIELD_NAME="hostname"><FILTER TYPE="EQUALS" VALUE="main-only"/></CONDITION></EXPRESSION>
 <ACTION NAME="MAIN_ACTION"/>
 <RULE_CHAIN><INNER_RULE ID="second" ENABLED="true"><ACTION NAME="CHILD_ACTION"/></INNER_RULE><INNER_RULE ID="first"/></RULE_CHAIN>
 </RULE></POLICY></POLICIES></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.GetRule("main")
	if err != nil {
		t.Fatal(err)
	}
	if doc.PolicyCount != 1 || doc.RuleCount != 3 || len(root.View.Children) != 2 || root.View.Children[0].Rule.ID != "second" || root.View.Children[1].Rule.ID != "first" {
		t.Fatal("source container ownership/order lost")
	}
	if len(root.View.Rule.Actions) != 1 || root.View.Rule.Actions[0].Name != "MAIN_ACTION" || root.View.Children[0].Rule.Actions[0].Name != "CHILD_ACTION" || root.View.Children[0].Rule.EffectiveEnabled {
		t.Fatal("main and subrule content or enabled inheritance conflated")
	}
	if root.View.Children[0].Logic != nil {
		t.Fatal("main expression copied onto subrule")
	}
}
