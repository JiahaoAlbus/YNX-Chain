package cloud

import (
	"net/http/httptest"
	"testing"
)

// Protect the original normal-repository routes while installing only the
// narrow IDE consumer. No Source, SQL pool, executor or server is activated.
func TestIDEDeploymentNormalLegacyRoutesRemainIndependent(t *testing.T) {
	server := NewServer(testService(t, nil))
	handler := server.WrapIDEProjectRuntime(server.Handler())
	for _, check := range []struct {
		path   string
		status int
	}{{"/health/live", 200}, {"/api/v1/objects", 401}, {"/api/v1/ide/deployments/PUBLIC_original_query_123456", 503}} {
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, httptest.NewRequest("GET", check.path, nil))
		if out.Code != check.status {
			t.Fatalf("original route %s changed: status=%d want=%d", check.path, out.Code, check.status)
		}
	}
}
