package viewer

import (
	"reflect"
	"strings"
	"testing"
)

func TestSharedExpressionViewsKeepScopeSourcesAndText(t *testing.T) {
	s := New()
	_, err := s.LoadXML("synthetic", `<POLICY_FOLDER ID="f"><RULE ID="r"><EXPRESSION EXPR_TYPE="OR" ID="root-expression">
<EXPRESSION EXPR_TYPE="PARENTHESIS" ID="wrapper"><EXPRESSION EXPR_TYPE="AND">
<CONDITION FIELD_NAME="demo.first" LABEL="First"/><EXPRESSION EXPR_TYPE="NOT"><CONDITION FIELD_NAME="openports" LABEL="Open Ports"><FILTER><VALUE FROM="1234/TCP" TO="1234/TCP"/></FILTER></CONDITION></EXPRESSION>
</EXPRESSION></EXPRESSION><CONDITION FIELD_NAME="demo.last" LABEL="Last"/>
</EXPRESSION><INNER_RULE ID="child"><CONDITION FIELD_NAME="demo.child"/></INNER_RULE></RULE></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := s.GetRule("r")
	if err != nil {
		t.Fatal(err)
	}
	view := detail.View
	if !reflect.DeepEqual(view.Layout, view.Rule.Expression.Layout()) || view.Logic.Text != view.Rule.Expression.Text() {
		t.Fatal("GUI bypassed the shared expression projection")
	}
	if !strings.Contains(view.Logic.Text, `NOT Open Ports IN "1234/TCP"`) || strings.Contains(view.Logic.Text, "PARENTHESIS") {
		t.Fatal(view.Logic.Text)
	}
	for _, line := range view.Layout {
		expression, logic := view.Rule.Expression, view.Logic
		for _, index := range line.SourcePath {
			expression, logic = &expression.Children[index], &logic.Children[index]
		}
		if line.Kind == "condition" && (expression.Condition == nil || logic.Field != expression.Condition.Field) {
			t.Fatal("layout points at another condition's raw fields")
		}
	}
	if len(view.Children[0].Layout) != 1 || view.Children[0].Logic.Text == "" {
		t.Fatal("subrules did not receive both shared views")
	}
	view.Layout[0].SourcePath[0] = 99
	again, _ := s.GetRule("r")
	if again.View.Layout[0].SourcePath[0] != 0 || again.View.Rule.Expression.Children[0].Type != "PARENTHESIS" {
		t.Fatal("view mutation or display normalization changed source data")
	}
}
