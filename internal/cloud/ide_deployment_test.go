package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// PUBLIC adapter seams only. These are neither real signatures nor real
// authority/deployments. No production source installs these implementations.
type publicIDEAuthority struct {
	principal                       string
	deny, readDeny, charge, expired bool
	rechecks, revokeAt              int
}

func (a *publicIDEAuthority) AssertCurrent(context.Context) error { return nil }
func (a *publicIDEAuthority) Principal(context.Context, *http.Request) (string, error) {
	return a.principal, nil
}
func (a *publicIDEAuthority) Authorize(_ context.Context, r *http.Request, principal string, manifest, approval []byte) (IDEDeploymentPermit, error) {
	if a.deny {
		return IDEDeploymentPermit{}, ErrDenied
	}
	binding, err := decodeIDEArtifactBinding(manifest)
	if err != nil {
		return IDEDeploymentPermit{}, err
	}
	expires := time.Now().Add(time.Hour)
	if a.expired {
		expires = time.Now().Add(-time.Hour)
	}
	return IDEDeploymentPermit{RequestID: r.Header.Get("Idempotency-Key"), Principal: principal, PublisherID: "PUBLIC_TEST_PUBLISHER", ResourceID: "PUBLIC_TEST_EXISTING_RESOURCE", ManifestSHA256: productHash(manifest), Binding: binding, ExpiresAt: expires, RequiresAdditionalCharge: a.charge, RuntimeSeconds: 30, ResourceApprovalRef: "PUBLIC_NOT_REAL_APPROVAL"}, nil
}
func (a *publicIDEAuthority) Recheck(context.Context, *http.Request, IDEDeploymentPermit) error {
	a.rechecks++
	if a.revokeAt > 0 && a.rechecks >= a.revokeAt {
		return ErrDenied
	}
	return nil
}
func (a *publicIDEAuthority) AuthorizeRead(context.Context, *http.Request, IDEDeploymentOperation) error {
	if a.readDeny {
		return ErrDenied
	}
	return nil
}

type publicIDEExecutor struct {
	applies, observes, logs int
	timeout                 bool
	logBytes                []byte
	observed                IDEDeploymentResult
	received                []byte
}

func (e *publicIDEExecutor) ApplyExisting(_ context.Context, p IDEDeploymentPermit, r io.Reader, current func() error) (IDEDeploymentResult, error) {
	if err := current(); err != nil {
		return IDEDeploymentResult{}, err
	}
	e.applies++
	body, err := io.ReadAll(r)
	if err != nil {
		return IDEDeploymentResult{}, err
	}
	e.received = body
	e.observed = IDEDeploymentResult{RequestID: p.RequestID, ResourceID: p.ResourceID, State: "running", DeploymentID: "PUBLIC_TEST_NOT_A_REAL_DEPLOYMENT", RuntimeURL: "https://public-test.invalid/run", Binding: p.Binding}
	if e.timeout {
		return IDEDeploymentResult{}, context.DeadlineExceeded
	}
	return e.observed, nil
}
func (e *publicIDEExecutor) ObserveOriginal(context.Context, IDEDeploymentOperation) (IDEDeploymentResult, error) {
	e.observes++
	return e.observed, nil
}
func (e *publicIDEExecutor) Logs(context.Context, IDEDeploymentOperation, int64) ([]byte, error) {
	e.logs++
	return e.logBytes, nil
}

func publicIDEFixture(t *testing.T) (*Server, *publicIDEAuthority, *publicIDEExecutor, http.Handler) {
	t.Helper()
	s := NewServer(testService(t, nil))
	a := &publicIDEAuthority{principal: "PUBLIC_TEST_ACCOUNT"}
	e := &publicIDEExecutor{}
	if err := s.EnableIDEDeployments(a, e); err != nil {
		t.Fatal(err)
	}
	return s, a, e, s.Handler()
}
func publicIDESubmit(t *testing.T, h http.Handler, body, manifest []byte, key string) *httptest.ResponseRecorder {
	t.Helper()
	var encoded bytes.Buffer
	w := multipart.NewWriter(&encoded)
	for _, part := range []struct {
		name string
		body []byte
	}{{"manifest", manifest}, {"approval", []byte("PUBLIC_TEST_PROOF_NOT_AUTHORITY")}, {"artifact", body}} {
		p, err := w.CreateFormField(part.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = p.Write(part.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/api/v1/ide/deployments", &encoded)
	r.Header.Set("Content-Type", w.FormDataContentType())
	r.Header.Set("Idempotency-Key", key)
	out := httptest.NewRecorder()
	h.ServeHTTP(out, r)
	return out
}
func publicIDERead(h http.Handler, path string) *httptest.ResponseRecorder {
	out := httptest.NewRecorder()
	h.ServeHTTP(out, httptest.NewRequest("GET", path, nil))
	return out
}

func TestIDEDeploymentHTTPMissingProductionAuthority(t *testing.T) {
	s := NewServer(testService(t, nil))
	h := s.Handler()
	for _, method := range []string{"POST", "GET"} {
		path := "/api/v1/ide/deployments"
		if method == "GET" {
			path += "/request_original_123456"
		}
		out := httptest.NewRecorder()
		h.ServeHTTP(out, httptest.NewRequest(method, path, nil))
		if out.Code != 503 || !strings.Contains(out.Body.String(), "IDE_DEPLOYMENT_AUTHORITY_UNAVAILABLE") {
			t.Fatalf("unguarded %s: %d %s", method, out.Code, out.Body.String())
		}
	}
	if s.EnableIDEDeployments(nil, nil) == nil {
		t.Fatal("nil production dependency installed")
	}
}
func TestIDEDeploymentHTTPNormalCallerAndReadOnlyLogs(t *testing.T) {
	_, _, e, h := publicIDEFixture(t)
	body, manifest, _ := ideArtifactData(t)
	e.logBytes = []byte("PUBLIC runtime observation")
	out := publicIDESubmit(t, h, body, manifest, "request_original_123456")
	if out.Code != 201 || e.applies != 1 || !bytes.Equal(e.received, body) {
		t.Fatalf("PUBLIC flow: %d %s", out.Code, out.Body.String())
	}
	out = publicIDESubmit(t, h, body, manifest, "request_original_123456")
	if out.Code != 201 || e.applies != 1 {
		t.Fatalf("duplicate dispatched: %d %d", out.Code, e.applies)
	}
	status := publicIDERead(h, "/api/v1/ide/deployments/request_original_123456")
	logs := publicIDERead(h, "/api/v1/ide/deployments/request_original_123456/logs")
	if status.Code != 200 || logs.Code != 200 || e.observes != 1 || e.logs != 1 || !strings.Contains(logs.Body.String(), "original-resource") {
		t.Fatalf("read path: %d %d", status.Code, logs.Code)
	}
}
func TestIDEDeploymentHTTPTimeoutOnlyQueriesOriginal(t *testing.T) {
	_, _, e, h := publicIDEFixture(t)
	e.timeout = true
	body, manifest, _ := ideArtifactData(t)
	for i := 0; i < 2; i++ {
		out := publicIDESubmit(t, h, body, manifest, "request_original_123456")
		if out.Code != 202 || !strings.Contains(out.Body.String(), `"state":"unknown"`) {
			t.Fatalf("timeout not UNKNOWN: %d %s", out.Code, out.Body.String())
		}
	}
	if e.applies != 1 {
		t.Fatal("UNKNOWN request resubmitted")
	}
	out := publicIDERead(h, "/api/v1/ide/deployments/request_original_123456")
	if out.Code != 200 || e.observes != 1 || e.applies != 1 || !strings.Contains(out.Body.String(), `"state":"running"`) {
		t.Fatalf("original query: %d %s", out.Code, out.Body.String())
	}
}
func TestIDEDeploymentHTTPDenialsNeverApply(t *testing.T) {
	for _, scenario := range []string{"denied", "charge", "expired", "tampered", "revoked"} {
		t.Run(scenario, func(t *testing.T) {
			_, a, e, h := publicIDEFixture(t)
			body, manifest, _ := ideArtifactData(t)
			switch scenario {
			case "denied":
				a.deny = true
			case "charge":
				a.charge = true
			case "expired":
				a.expired = true
			case "tampered":
				body[0] ^= 1
			case "revoked":
				a.revokeAt = 2
			}
			out := publicIDESubmit(t, h, body, manifest, "request_original_123456")
			if e.applies != 0 {
				t.Fatalf("denial applied: %s", scenario)
			}
			if scenario == "revoked" {
				if out.Code != 202 || !strings.Contains(out.Body.String(), `"state":"unknown"`) {
					t.Fatalf("revoked after claim: %d %s", out.Code, out.Body.String())
				}
			} else if out.Code != 403 && out.Code != 400 {
				t.Fatalf("denial response: %d", out.Code)
			}
		})
	}
}
func TestIDEDeploymentHTTPRevokedReadAndOversizeLog(t *testing.T) {
	_, a, e, h := publicIDEFixture(t)
	body, manifest, _ := ideArtifactData(t)
	if out := publicIDESubmit(t, h, body, manifest, "request_original_123456"); out.Code != 201 {
		t.Fatal(out.Body.String())
	}
	a.readDeny = true
	for _, suffix := range []string{"", "/logs"} {
		if out := publicIDERead(h, "/api/v1/ide/deployments/request_original_123456"+suffix); out.Code != 403 {
			t.Fatalf("revoked read: %d", out.Code)
		}
	}
	if e.logs != 0 || e.observes != 0 {
		t.Fatal("revoked read touched executor")
	}
	a.readDeny = false
	a.principal = "OTHER_PUBLIC_TEST_ACCOUNT"
	if out := publicIDERead(h, "/api/v1/ide/deployments/request_original_123456"); out.Code != 404 {
		t.Fatalf("cross-account read: %d", out.Code)
	}
	a.principal = "PUBLIC_TEST_ACCOUNT"
	e.logBytes = bytes.Repeat([]byte("x"), 65537)
	if out := publicIDERead(h, "/api/v1/ide/deployments/request_original_123456/logs"); out.Code != 503 {
		t.Fatalf("unbounded logs: %d", out.Code)
	}
}
func TestIDEDeploymentHTTPConflictAndMismatchedObservation(t *testing.T) {
	_, _, e, h := publicIDEFixture(t)
	e.timeout = true
	body, manifest, binding := ideArtifactData(t)
	if out := publicIDESubmit(t, h, body, manifest, "request_original_123456"); out.Code != 202 {
		t.Fatal(out.Body.String())
	}
	binding.ProjectID = "other-project"
	changed, err := json.Marshal(binding)
	if err != nil {
		t.Fatal(err)
	}
	if out := publicIDESubmit(t, h, body, changed, "request_original_123456"); out.Code != 409 || e.applies != 1 {
		t.Fatalf("key reuse: %d", out.Code)
	}
	e.observed.Binding.TargetEnvironment = "other-target"
	out := publicIDERead(h, "/api/v1/ide/deployments/request_original_123456")
	if out.Code != 200 || !strings.Contains(out.Body.String(), `"state":"unknown"`) {
		t.Fatal("wrong-target result became terminal")
	}
}
func TestIDEDeploymentHTTPRejectedInstallCurrent(t *testing.T) {
	s := NewServer(testService(t, nil))
	a := &unavailableIDEAuthority{}
	if err := s.EnableIDEDeployments(a, &publicIDEExecutor{}); !errors.Is(err, ErrDenied) {
		t.Fatalf("missing source installed: %v", err)
	}
}

type unavailableIDEAuthority struct{ publicIDEAuthority }

func (*unavailableIDEAuthority) AssertCurrent(context.Context) error { return ErrDenied }
