package viewer

import (
	"testing"

	"github.com/andareed/polisee-lib"
)

func TestActionPresentationKeepsIdentifiersWithTheirValues(t *testing.T) {
	service := New()
	_, err := service.LoadXML("presentation.xml", `<POLICY_FOLDER ID="f"><RULE ID="r" ENABLED="false">
 <ACTION ID="export-action" NAME="Add-To-Group"><PARAM NAME="temporary" VALUE="true"/>
 <PARAM NAME="group-name" VALUE="id:123456789;name:Trusted &amp; media devices"/>
 <PARAM NAME="item_key" VALUE="mac_or_ip"/><PARAM NAME="comment" VALUE=""/>
 <PARAM NAME="action_id" VALUE="internal"/><SCHEDULE START_CLASS="Immediately"/>
 </ACTION></RULE></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := service.GetRule("r")
	if err != nil {
		t.Fatal(err)
	}
	action := detail.View.Actions[0]
	if action.Label != "Add to group" || len(action.Parameters) != 5 {
		t.Fatalf("action presentation: %+v", action)
	}
	if group := action.Parameters[0]; group.Label != "Group" || group.Value != "Trusted & media devices" || group.ReferenceID != "123456789" || group.Secondary || !group.Primary {
		t.Fatalf("group target: %+v", group)
	}
	if !action.Parameters[2].Secondary || action.Parameters[2].Value != "mac_or_ip" {
		t.Fatal("technical item key should be secondary")
	}
	if comment := action.Parameters[3]; comment.Value != "" || !comment.Secondary {
		t.Fatal("empty comments should remain available as secondary information")
	}
	if id := action.Parameters[4]; id.Label != "Action ID" || id.Value != "internal" || !id.Secondary {
		t.Fatal("identifier parameter should stay visible as secondary information")
	}
	if len(action.Identifiers) != 1 || action.Identifiers[0].Value != "export-action" {
		t.Fatal("action attribute ID was hidden")
	}
	raw := detail.View.Rule.Actions[0]
	for i, want := range []int{1, 0, 2, 3, 4} {
		if action.Parameters[i].SourceIndex != want {
			t.Fatalf("parameter %d points to raw source %d, want %d", i, action.Parameters[i].SourceIndex, want)
		}
	}
	if len(raw.Parameters) != 5 || raw.Parameters[1].Value != "id:123456789;name:Trusted & media devices" || raw.Parameters[3].Value != "" || raw.Parameters[4].Value != "internal" {
		t.Fatal("presentation changed original action values")
	}
	if detail.View.Rule.EffectiveEnabled || raw.Disabled || action.Disabled || len(action.Schedules) != 1 {
		t.Fatal("presentation conflated policy state, action state or schedule")
	}
}

func TestReorderedDuplicateParametersKeepTheirOwnRawFields(t *testing.T) {
	service := New()
	_, err := service.LoadXML("duplicate.xml", `<POLICY_FOLDER ID="f"><RULE ID="r"><ACTION NAME="ADD_TO_GROUP">
<PARAM NAME="group-name" VALUE="" CUSTOM="empty target"/><PARAM NAME="group-name" VALUE="id:42;name:Office" CUSTOM="named target"/>
</ACTION></RULE></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := service.GetRule("r")
	if err != nil {
		t.Fatal(err)
	}
	for _, parameter := range detail.View.Actions[0].Parameters {
		original := detail.View.Rule.Actions[0].Parameters[parameter.SourceIndex]
		custom, _ := polisee.AttributeValue(original.Attributes, "CUSTOM")
		if parameter.Primary && custom != "named target" || parameter.Secondary && custom != "empty target" {
			t.Fatalf("reordered parameter has another parameter's fields: %+v, raw=%+v", parameter, original)
		}
	}
}

func TestActionPresentationPreservesFreeTextAndUnknownReferences(t *testing.T) {
	for _, test := range []struct{ value, want, id string }{
		{"id:1;name:Display name", "Display name", "1"},
		{"name:Display name;id:1", "Display name", "1"},
		{"id:1;name:  Literal name  ", "  Literal name  ", "1"},
		{"id:1;name:<img src=x>", "<img src=x>", "1"},
		{"id:1;name:", "id:1;name:", ""},
		{"id:;name:Name", "id:;name:Name", ""},
		{"id:1;name:Name;future:value", "id:1;name:Name;future:value", ""},
		{"name:Only name", "name:Only name", ""},
		{"ordinary text", "ordinary text", ""},
	} {
		if got, id := displayReference(test.value); got != test.want || id != test.id {
			t.Errorf("displayReference(%q) = (%q, %q), want (%q, %q)", test.value, got, id, test.want, test.id)
		}
	}
	service := New()
	_, err := service.LoadXML("literal.xml", `<POLICY_FOLDER ID="f"><RULE ID="r"><ACTION NAME="SEND_MESSAGE"><PARAM NAME="message" VALUE="id:1;name:literal text"/><PARAM NAME="group"><GROUP ID="g" NAME="Nested target"/></PARAM></ACTION></RULE></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	detail, _ := service.GetRule("r")
	parameters := detail.View.Actions[0].Parameters
	if parameters[1].Value != "id:1;name:literal text" || len(parameters[0].Children) != 1 {
		t.Fatal("free text or structured parameter children were changed")
	}
}
