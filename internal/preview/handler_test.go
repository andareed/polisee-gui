package preview

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/andareed/polisee-gui/internal/viewer"
)

func TestPreviewUsesTheDesktopService(t *testing.T) {
	handler := Handler(viewer.New())
	for _, test := range []struct{ path, body, contains string }{
		{"/api/demo", `{}`, `"ruleCount":3`},
		{"/api/search", `{"text":"\"Guest access\""}`, `"ruleId":"child"`},
		{"/api/rule", `{"id":"grandchild"}`, `"effectiveEnabled":false`},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body)))
		if response.Code != 200 || !strings.Contains(response.Body.String(), test.contains) {
			t.Fatalf("%s: %d %s", test.path, response.Code, response.Body.String())
		}
		if !json.Valid(response.Body.Bytes()) {
			t.Fatal("invalid JSON response")
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), "Policy tree") {
		t.Fatal("frontend not served")
	}
}

func TestPreviewReportsErrorsAndRejectsCrossOriginRequests(t *testing.T) {
	handler := Handler(viewer.New())
	for _, body := range []string{`{"id":"missing"}`, `{"unknown":true}`, `{} {}`} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/rule", strings.NewReader(body)))
		if response.Code != 400 || !strings.Contains(response.Body.String(), "error") {
			t.Fatal("invalid request succeeded")
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/api/demo", strings.NewReader(`{}`))
	request.Header.Set("Origin", "https://example.test")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatal("cross-origin request accepted")
	}
}

func TestPreviewCannotReadNativePathsOrSaveNativeSettings(t *testing.T) {
	handler := Handler(viewer.New())
	for _, path := range []string{"/api/open", "/api/initialize", "/api/remember", "/api/settings", "/api/update"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"path":"/etc/passwd"}`)))
		if response.Code == http.StatusOK {
			t.Fatal("native capability exposed in preview", path)
		}
	}
	for _, path := range []string{"/app.js", "/bridge.js", "/zoom.js", "/smoke.js", "/workflow-smoke.js", "/tree-model.js", "/segments.js", "/group-picker.js", "/browse-state.js", "/ui.js"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatal("embedded module missing", path)
		}
	}
}

func TestPreviewPagesSegmentsThroughTheSameService(t *testing.T) {
	service := viewer.New()
	document, err := service.LoadXML("segments.xml", `<POLICY_FOLDER ID="f"><RULE ID="r"><SEGMENT ID="s" NAME="Office"><RANGE ID="a" FROM="192.0.2.1" TO="192.0.2.9"/></SEGMENT></RULE></POLICY_FOLDER>`)
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(service)
	for _, test := range []struct{ path, body, want string }{
		{"/api/segments", `{"generation":1,"ruleId":"r"}`, `"name":"Office"`},
		{"/api/ranges", `{"generation":1,"ruleId":"r","segmentKey":"0"}`, `"from":"192.0.2.1"`},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body)))
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), test.want) {
			t.Fatalf("%s: %d %s", test.path, response.Code, response.Body.String())
		}
	}
	if _, err := service.LoadDemo(); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(viewer.BrowseQuery{Generation: document.Generation, RuleID: "r"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/segments", strings.NewReader(string(body))))
	if response.Code != http.StatusBadRequest {
		t.Fatal("preview accepted stale browsing generation")
	}
	request := httptest.NewRequest(http.MethodPost, "/api/ranges", strings.NewReader(`{"ruleId":"office"}`))
	request.Header.Set("Origin", "https://example.test")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatal("browse endpoint accepted cross-origin request")
	}
}
