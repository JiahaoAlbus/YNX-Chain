package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// PUBLIC OCI protocol seams. No Docker engine/image, genuine authority,
// signature, paid resource, or real IDE project is represented by this model.
type publicIDEOCI struct {
	e               *OCIIDEDeploymentExecutor
	p               IDEDeploymentPermit
	row             ideOCIInspection
	body            []byte
	calls           []string
	creates, starts int
	startUnknown    bool
}

func publicIDEOCIFixture(t *testing.T) *publicIDEOCI {
	t.Helper()
	root := filepath.Join(t.TempDir(), "private-runtime")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	model := &publicIDEOCI{body: []byte("console.log('PUBLIC_ADAPTER_TEST_ONLY');\n")}
	binding := IDEArtifactBinding{ProjectID: "PUBLIC_PROJECT", Version: "1", ContentDigest: productHash(model.body), PublishPurpose: "deploy", TargetEnvironment: "PUBLIC_ENV", ByteSize: int64(len(model.body))}
	model.p = IDEDeploymentPermit{RequestID: "request_original_123456", Principal: "PUBLIC_ACTOR", PublisherID: "PUBLIC_PUBLISHER", ResourceID: "PUBLIC_RESOURCE", ManifestSHA256: strings.Repeat("c", 64), ApprovalSHA256: strings.Repeat("d", 64), Binding: binding, ExpiresAt: time.Now().Add(time.Hour), RuntimeSeconds: 30, ResourceApprovalRef: "PUBLIC_NOT_REAL_APPROVAL"}
	model.e = &OCIIDEDeploymentExecutor{cfg: IDEExistingOCIConfig{StorageRoot: root, ResourceID: model.p.ResourceID, TargetEnvironment: binding.TargetEnvironment, ImageDigest: "sha256:" + strings.Repeat("a", 64), ServerOrigin: "https://public-test.invalid", MaxSeconds: 30}, now: time.Now}
	op := IDEDeploymentOperation{RequestID: model.p.RequestID, ResourceID: model.p.ResourceID, Binding: binding, ManifestSHA256: model.p.ManifestSHA256, ApprovalSHA256: model.p.ApprovalSHA256, RuntimeSeconds: model.p.RuntimeSeconds, ResourceApprovalRef: model.p.ResourceApprovalRef}
	model.row.ID = strings.Repeat("b", 64)
	model.row.Config.Image = model.e.cfg.ImageDigest
	model.row.Config.User = "10001:10001"
	model.row.Config.Labels = model.e.labels(op)
	model.row.Config.Entrypoint = []string{"/usr/bin/timeout"}
	model.row.Config.Cmd = []string{"--signal=TERM", "--kill-after=5s", "25s", "/usr/local/bin/node", "/app/artifact.mjs"}
	h := &model.row.HostConfig
	h.NetworkMode = "none"
	h.ReadonlyRootfs = true
	h.Memory = 128 << 20
	h.MemorySwap = 128 << 20
	h.NanoCpus = 500000000
	h.PidsLimit = 64
	h.CapDrop = []string{"ALL"}
	h.SecurityOpt = []string{"no-new-privileges:true"}
	h.Tmpfs = map[string]string{"/tmp": "rw,noexec,nosuid,nodev,size=16m"}
	file := filepath.Join(root, model.e.name(model.p.RequestID, model.p.ApprovalSHA256), "artifact.mjs")
	model.row.Mounts = append(model.row.Mounts, struct {
		Type, Source, Destination string
		RW                        bool
	}{Type: "bind", Source: file, Destination: "/app/artifact.mjs"}, struct {
		Type, Source, Destination string
		RW                        bool
	}{Type: "tmpfs", Destination: "/tmp", RW: true})
	model.e.run = func(_ context.Context, args ...string) ([]byte, error) {
		model.calls = append(model.calls, strings.Join(args, " "))
		switch args[0] {
		case "image":
			return json.Marshal([]map[string]string{{"Id": model.e.cfg.ImageDigest}})
		case "create":
			model.creates++
			return []byte(model.row.ID), nil
		case "inspect":
			return json.Marshal([]ideOCIInspection{model.row})
		case "start":
			model.starts++
			model.row.State.Running = true
			model.row.State.Status = "running"
			if model.startUnknown {
				return nil, context.DeadlineExceeded
			}
			return []byte(model.row.ID), nil
		case "logs":
			return []byte("PUBLIC_ADAPTER_LOG_NOT_REAL_RUNTIME"), nil
		default:
			return nil, ErrInvalid
		}
	}
	return model
}
func (m *publicIDEOCI) operation() IDEDeploymentOperation {
	return IDEDeploymentOperation{RequestID: m.p.RequestID, ResourceID: m.p.ResourceID, Binding: m.p.Binding, ManifestSHA256: m.p.ManifestSHA256, ApprovalSHA256: m.p.ApprovalSHA256, RuntimeSeconds: m.p.RuntimeSeconds, ResourceApprovalRef: m.p.ResourceApprovalRef}
}

func TestIDEDeploymentOCIExistingOfflineSandboxContract(t *testing.T) {
	m := publicIDEOCIFixture(t)
	r, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil })
	if err != nil || r.State != "running" || r.RuntimeKind != "bounded-node-job" || m.creates != 1 || m.starts != 1 {
		t.Fatalf("PUBLIC protocol: %#v %v", r, err)
	}
	file := filepath.Join(m.e.cfg.StorageRoot, m.e.name(m.p.RequestID, m.p.ApprovalSHA256), "artifact.mjs")
	body, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(body, m.body) {
		t.Fatal("staged bytes differ")
	}
	var create string
	for _, call := range m.calls {
		if strings.HasPrefix(call, "create ") {
			create = call
		}
	}
	for _, flag := range []string{"--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--memory=128m", "--pids-limit=64", "--cpus=0.5", "--entrypoint=/usr/bin/timeout", "--kill-after=5s", "readonly"} {
		if !strings.Contains(create, flag) {
			t.Fatalf("missing isolation %s", flag)
		}
	}
	if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err == nil || m.creates != 1 {
		t.Fatal("staged UNKNOWN was reused")
	}
}
func TestIDEDeploymentOCIRevocationBeforeActualStart(t *testing.T) {
	m := publicIDEOCIFixture(t)
	_, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error {
		if m.creates == 1 {
			return ErrDenied
		}
		return nil
	})
	if !errors.Is(err, ErrDenied) || m.creates != 1 || m.starts != 0 {
		t.Fatalf("late revocation: %v %d/%d", err, m.creates, m.starts)
	}
}
func TestIDEDeploymentOCIUnknownOnlyObservesOriginal(t *testing.T) {
	m := publicIDEOCIFixture(t)
	m.startUnknown = true
	if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("lost timeout: %v", err)
	}
	r, err := m.e.ObserveOriginal(context.Background(), m.operation())
	if err != nil || r.State != "running" || m.creates != 1 || m.starts != 1 {
		t.Fatal("status replayed create/start")
	}
	m.row.State.Running = false
	m.row.State.Status = "exited"
	m.row.State.ExitCode = 0
	r, err = m.e.ObserveOriginal(context.Background(), m.operation())
	if err != nil || r.State != "completed" || r.ExitCode == nil || *r.ExitCode != 0 {
		t.Fatalf("real exit mapping: %#v %v", r, err)
	}
	m.row.State.ExitCode = 7
	r, err = m.e.ObserveOriginal(context.Background(), m.operation())
	if err != nil || r.State != "failed" {
		t.Fatal("nonzero exit claimed success")
	}
}
func TestIDEDeploymentOCIInspectionRejectsIsolationAndIdentityDrift(t *testing.T) {
	for _, scenario := range []string{"resource", "environment", "publisher-approval", "root-user", "network", "writable", "privileged", "timeout", "mount"} {
		t.Run(scenario, func(t *testing.T) {
			m := publicIDEOCIFixture(t)
			switch scenario {
			case "resource":
				m.row.Config.Labels["ynx.ide.resource"] = "another"
			case "environment":
				m.row.Config.Labels["ynx.ide.binding"] = "another"
			case "publisher-approval":
				m.row.Config.Labels["ynx.ide.approval"] = "another"
			case "root-user":
				m.row.Config.User = "0"
			case "network":
				m.row.HostConfig.NetworkMode = "host"
			case "writable":
				m.row.HostConfig.ReadonlyRootfs = false
			case "privileged":
				m.row.HostConfig.Privileged = true
			case "timeout":
				m.row.Config.Cmd[2] = "9999s"
			case "mount":
				m.row.Mounts[0].RW = true
			}
			if _, err := m.e.ObserveOriginal(context.Background(), m.operation()); err == nil {
				t.Fatal("untrusted container inspected as original")
			}
		})
	}
}
func TestIDEDeploymentOCINoPaidOrWrongTargetDispatch(t *testing.T) {
	for _, scenario := range []string{"charge", "resource", "environment", "expired", "tamper"} {
		t.Run(scenario, func(t *testing.T) {
			m := publicIDEOCIFixture(t)
			switch scenario {
			case "charge":
				m.p.RequiresAdditionalCharge = true
			case "resource":
				m.p.ResourceID = "other"
			case "environment":
				m.p.Binding.TargetEnvironment = "other"
			case "expired":
				m.p.ExpiresAt = time.Now().Add(-time.Hour)
			case "tamper":
				m.body[0] ^= 1
			}
			if _, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err == nil || m.creates != 0 || m.starts != 0 {
				t.Fatal("denied artifact dispatched")
			}
		})
	}
}
func TestIDEDeploymentOCIRealCommandFailureStaysUnavailable(t *testing.T) {
	binary, err := exec.LookPath("false")
	if err != nil {
		t.Fatal(err)
	}
	binary, err = filepath.Abs(binary)
	if err != nil {
		t.Fatal(err)
	}
	m := publicIDEOCIFixture(t)
	cfg := m.e.cfg
	cfg.Binary = binary
	cfg.Socket = filepath.Join(t.TempDir(), "missing.sock")
	cfg.StorageRoot = filepath.Join(t.TempDir(), "private-runtime")
	e, err := NewOCIIDEDeploymentExecutor(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); !errors.Is(err, ErrIDEExistingRuntimeUnavailable) {
		t.Fatalf("missing actual engine became success: %v", err)
	}
}

func TestIDEDeploymentCompletedJobStatusKeepsOriginalRequest(t *testing.T) {
	_, _, executor, h := publicIDEFixture(t)
	body, manifest, _ := ideArtifactData(t)
	if out := publicIDESubmit(t, h, body, manifest, "request_original_123456"); out.Code != 201 {
		t.Fatal(out.Body.String())
	}
	zero := 0
	executor.observed.State = "completed"
	executor.observed.ExitCode = &zero
	executor.observed.RuntimeKind = "bounded-node-job"
	out := publicIDERead(h, "/api/v1/ide/deployments/request_original_123456/runtime")
	if out.Code != 200 || !strings.Contains(out.Body.String(), `"state":"completed"`) || !strings.Contains(out.Body.String(), `"exitCode":0`) || executor.applies != 1 {
		t.Fatalf("completed job status: %d %s", out.Code, out.Body.String())
	}
	if out = publicIDERead(h, "/api/v1/ide/deployments/request_original_123456"); out.Code != 200 || executor.observes != 1 {
		t.Fatal("completed job was reobserved or redeployed")
	}
}
