//go:build cloud_oci_recovery

package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Explicit PUBLIC approval fixture at the actual production authority port;
// no real signatures, Root, Wallet or publisher admission is represented.
type p04ActualRecoveryAuth struct{ resource, origin string }

func (*p04ActualRecoveryAuth) AssertCurrent(context.Context) error { return nil }
func (a *p04ActualRecoveryAuth) Principal(_ context.Context, r *http.Request) (string, error) {
	if r.Header.Get("X-P04-CI-Identity") != "PUBLIC_OWNER" {
		return "", ErrDenied
	}
	return "PUBLIC_OWNER", nil
}
func (a *p04ActualRecoveryAuth) Authorize(ctx context.Context, r *http.Request, who string, manifest, approval []byte) (IDEDeploymentPermit, error) {
	var b IDEArtifactBinding
	id := r.Header.Get("Idempotency-Key")
	if json.Unmarshal(manifest, &b) != nil || who != "PUBLIC_OWNER" || string(approval) != "PUBLIC_AUTHORED_APPROVAL:"+id {
		return IDEDeploymentPermit{}, ErrDenied
	}
	return IDEDeploymentPermit{RequestID: id, Principal: who, PublisherID: "PUBLIC_NOT_REAL_PUBLISHER", ResourceID: a.resource, Binding: b, ManifestSHA256: productHash(manifest), ExpiresAt: time.Now().Add(150 * time.Second), RuntimeSeconds: 120, ResourceApprovalRef: "PUBLIC_NOT_REAL_RESOURCE_APPROVAL"}, nil
}
func (a *p04ActualRecoveryAuth) Recheck(ctx context.Context, r *http.Request, p IDEDeploymentPermit) error {
	_, err := a.Principal(ctx, r)
	return err
}
func (a *p04ActualRecoveryAuth) AuthorizeRead(ctx context.Context, r *http.Request, _ IDEDeploymentOperation) error {
	_, err := a.Principal(ctx, r)
	return err
}
func (a *p04ActualRecoveryAuth) AssertProjectRuntimeOrigin(_ context.Context, origin string) error {
	if origin != a.origin {
		return ErrDenied
	}
	return nil
}
func (a *p04ActualRecoveryAuth) AuthorizeProjectRuntime(ctx context.Context, r *http.Request, _ IDEDeploymentOperation, origin string) error {
	if origin != a.origin {
		return ErrDenied
	}
	_, err := a.Principal(ctx, r)
	return err
}

type p04DiscardResponse struct{ header http.Header }

func (w *p04DiscardResponse) Header() http.Header       { return w.header }
func (*p04DiscardResponse) WriteHeader(int)             {}
func (*p04DiscardResponse) Write(b []byte) (int, error) { return len(b), nil }

func TestP04ActualOCIRollbackReconcileNormalServiceAndCLI(t *testing.T) {
	ctx := context.Background()
	binary, socket, image := os.Getenv("YNX_ACTUAL_OCI_BINARY"), os.Getenv("YNX_ACTUAL_OCI_SOCKET"), os.Getenv("YNX_ACTUAL_OCI_IMAGE")
	if ready, err := CheckIDEExistingOCI(ctx, binary, socket, image); err != nil || !ready.Available {
		t.Fatal("actual OCI target required", ready, err)
	}
	root := t.TempDir()
	cloudCfg := OriginalPrivateHostConfig{Cloud: Config{StatePath: filepath.Join(root, "state.json"), ObjectDir: filepath.Join(root, "objects")}, Limits: ServerLimits{MaxConcurrent: 32, RequestsPerMinute: 10000}}
	ociCfg := IDEExistingOCIConfig{Binary: binary, Socket: socket, StorageRoot: filepath.Join(root, "runtime"), ResourceID: "PUBLIC_CI_recovery", TargetEnvironment: "PUBLIC_ISOLATED_CI", ImageDigest: image, ServerOrigin: "https://cloud.invalid", RuntimeOrigin: "https://versions.example.test", HTTPPort: 18081, MaxSeconds: 120}
	auth := &p04ActualRecoveryAuth{resource: ociCfg.ResourceID, origin: ociCfg.RuntimeOrigin}
	var host *OriginalPrivateHost
	var executor *OCIIDEDeploymentExecutor
	var handler http.Handler
	var mu sync.RWMutex
	open := func() {
		t.Helper()
		h, err := OpenOriginalPrivateHost(ctx, cloudCfg)
		if err != nil {
			t.Fatal(err)
		}
		server, _ := h.Server()
		e, err := NewOCIIDEDeploymentExecutor(ociCfg)
		if err != nil {
			t.Fatal(err)
		}
		if err = server.EnableIDEDeployments(auth, e); err != nil {
			t.Fatal(err)
		}
		next, _ := h.Handler()
		mu.Lock()
		host, executor, handler = h, e, next
		mu.Unlock()
	}
	closeHost := func() {
		t.Helper()
		host.Retire()
		drain, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := host.Join(drain); err != nil {
			t.Fatal(err)
		}
		if err := host.Close(); err != nil {
			t.Fatal(err)
		}
	}
	open()
	defer closeHost()
	var lost atomic.Bool
	lost.Store(true)
	var posts atomic.Int32
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.RLock()
		defer mu.RUnlock()
		if r.Method == "POST" {
			posts.Add(1)
			if lost.CompareAndSwap(true, false) {
				handler.ServeHTTP(&p04DiscardResponse{header: make(http.Header)}, r)
				conn, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					conn.Close()
				}
				return
			}
		}
		handler.ServeHTTP(w, r)
	}))
	defer service.Close()
	cliRoot := filepath.Join(root, "client")
	os.Mkdir(cliRoot, 0700)
	script, err := filepath.Abs("../../apps/cloud/client/deployment-rollback.fixture.mjs")
	if err != nil {
		t.Fatal(err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	cli := func(stage, revision string) json.RawMessage {
		t.Helper()
		input, _ := json.Marshal(map[string]string{"base": service.URL + "/api/v1", "root": cliRoot, "stage": stage, "expectedRevision": revision})
		c := exec.Command(node, script)
		c.Stdin = bytes.NewReader(input)
		var stderr bytes.Buffer
		c.Stderr = &stderr
		out, err := c.Output()
		if err != nil {
			t.Fatalf("actual CLI %s: %v %s", stage, err, stderr.String())
		}
		if !json.Valid(out) {
			t.Fatal("invalid CLI output")
		}
		return out
	}
	get := func(id string) IDEDeploymentOperation {
		t.Helper()
		r, _ := http.NewRequest("GET", service.URL+"/api/v1/ide/deployments/"+id, nil)
		r.Header.Set("X-P04-CI-Identity", "PUBLIC_OWNER")
		res, err := service.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var op IDEDeploymentOperation
		if res.StatusCode != 200 || json.NewDecoder(res.Body).Decode(&op) != nil {
			t.Fatal("original read refused", res.StatusCode)
		}
		return op
	}
	await := func(id, state string) IDEDeploymentOperation {
		t.Helper()
		var op IDEDeploymentOperation
		for i := 0; i < 50; i++ {
			op = get(id)
			if op.State == state {
				return op
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatalf("original %s did not become %s: %+v", id, state, op)
		return op
	}
	versionBody := func(op IDEDeploymentOperation, path string, want string) int {
		t.Helper()
		u, err := url.Parse(op.RuntimeURL)
		if err != nil {
			t.Fatal(err)
		}
		r, _ := http.NewRequest("GET", service.URL+path, nil)
		r.Host = u.Host
		r.Header.Set("X-P04-CI-Identity", "PUBLIC_OWNER")
		response, err := service.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		if want != "" {
			var d struct{ Version, ArtifactSHA256 string }
			if response.StatusCode != 200 || json.Unmarshal(raw, &d) != nil || d.Version != want || d.ArtifactSHA256 != op.Binding.ContentDigest {
				t.Fatalf("actual version URL/body %d %s", response.StatusCode, raw)
			}
		}
		return response.StatusCode
	}
	var operations []IDEDeploymentOperation
	defer func() {
		for _, op := range operations {
			if _, err := executor.inspect(ctx, op); err == nil {
				executor.run(ctx, "rm", "--force", op.DeploymentID)
			}
		}
	}()
	cli("lost-A", "0")
	if posts.Load() != 1 {
		t.Fatal("lost response auto-reposted")
	}
	closeHost()
	open() // real disk-backed Cloud/executor cold reconstruction; container remains
	cli("reconcile-A", "0")
	a := await("req_recovery_A_000001", "running")
	operations = append(operations, a)
	if a.SlotRevision != "1" || posts.Load() != 1 {
		t.Fatal("cold reconcile allocated new generation", a)
	}
	versionBody(a, "/", "A")
	versionBody(a, "/finish", "A")
	a = await(a.RequestID, "completed")
	if a.ExitCode == nil || *a.ExitCode != 0 {
		t.Fatal("A not successful rollback artifact")
	}
	cli("submit-B", a.SlotRevision)
	b := await("req_recovery_B_000001", "running")
	operations = append(operations, b)
	if b.SlotRevision != "2" || b.DeploymentID == a.DeploymentID {
		t.Fatal("B generation identity")
	}
	versionBody(b, "/", "B")
	versionBody(b, "/finish", "B")
	b = await(b.RequestID, "completed")
	closeHost()
	open()
	cli("rollback-A", b.SlotRevision)
	rollback := await("req_recovery_rollback_000001", "running")
	operations = append(operations, rollback)
	if rollback.SlotRevision != "3" || rollback.RollbackTarget != a.RequestID || rollback.DeploymentID == a.DeploymentID || rollback.DeploymentID == b.DeploymentID {
		t.Fatal("rollback reused original attempt instead of new approved forward generation", rollback)
	}
	versionBody(rollback, "/", "A")
	if versionBody(a, "/", "") != http.StatusGone {
		t.Fatal("old stopped version URL still appeared active")
	}
	closeHost()
	open()
	inspection := cli("inspect-rollback", "2")
	again := get(rollback.RequestID)
	if again.DeploymentID != rollback.DeploymentID || again.SlotRevision != "3" || posts.Load() != 3 {
		t.Fatal("cold receipt replayed/reallocated", again, posts.Load())
	}
	ids, err := executor.run(ctx, "ps", "--all", "--quiet", "--filter", "label=ynx.ide.resource=PUBLIC_CI_recovery")
	if err != nil || len(strings.Fields(string(ids))) != 3 {
		t.Fatal("unexpected instance allocation", string(ids), err)
	}
	if bytes.Contains(inspection, []byte(`"billingState":"PERIOD_BILLS"`)) {
		t.Fatal("unapproved billing occurred")
	}
	t.Logf("ACTUAL_RECOVERY slots=%s,%s,%s containers=%s,%s,%s posts=%d versionURLs=%s,%s,%s coldReopens=3 PUBLIC_APPROVAL_ONLY", a.SlotRevision, b.SlotRevision, rollback.SlotRevision, a.DeploymentID, b.DeploymentID, rollback.DeploymentID, posts.Load(), a.RuntimeURL, b.RuntimeURL, rollback.RuntimeURL)
	t.Log("ACTUAL_CLI_LOGS_USAGE", fmt.Sprint(string(inspection)))
}
