//go:build cloud_oci_actual

package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Real OCI only. Synthetic PUBLIC permit is explicitly NOT Auth/Root admission.
// No run seam is replaced; all CLI/UnixHTTP calls use the production executor.
func TestP04ActualOCIIsolatedLifecycle(t *testing.T) {
	binary, socket, image := os.Getenv("YNX_ACTUAL_OCI_BINARY"), os.Getenv("YNX_ACTUAL_OCI_SOCKET"), os.Getenv("YNX_ACTUAL_OCI_IMAGE")
	if binary == "" || socket == "" || image == "" {
		t.Fatal("actual immutable OCI target required; no skip or fake success")
	}
	ctx := context.Background()
	ready, err := CheckIDEExistingOCI(ctx, binary, socket, image)
	if err != nil || !ready.Available {
		t.Fatalf("actual OCI preflight: %+v %v", ready, err)
	}
	root := t.TempDir()
	if err = os.Chmod(root, 0755); err != nil {
		t.Fatal(err)
	}
	// Docker bind input is a single read-only file. No engine socket, secrets,
	// host port, privileged mount or egress route enters the container.
	newCase := func(name string, body []byte, seconds int, httpProject bool) (*OCIIDEDeploymentExecutor, IDEDeploymentPermit) {
		t.Helper()
		cfg := IDEExistingOCIConfig{Binary: binary, Socket: socket, StorageRoot: filepath.Join(root, name), ResourceID: "PUBLIC_CI_" + name, TargetEnvironment: "PUBLIC_ISOLATED_CI", ImageDigest: image, ServerOrigin: "https://cloud.invalid", MaxSeconds: seconds}
		if httpProject {
			cfg.RuntimeOrigin = "https://runtime.example.test"
			cfg.HTTPPort = 18080
		}
		e, err := NewOCIIDEDeploymentExecutor(cfg)
		if err != nil {
			t.Fatal(err)
		}
		p := IDEDeploymentPermit{RequestID: "req_actual_oci_" + name + "_000001", Principal: "PUBLIC_CI_SYNTHETIC", PublisherID: "PUBLIC_NOT_ROOT", ResourceID: cfg.ResourceID, ManifestSHA256: productHash([]byte(name)), ApprovalSHA256: productHash([]byte("PUBLIC_APPROVAL_" + name)), Binding: IDEArtifactBinding{ProjectID: "PUBLIC_PROJECT", Version: "1", ContentDigest: productHash(body), PublishPurpose: "deploy", TargetEnvironment: cfg.TargetEnvironment, ByteSize: int64(len(body))}, ExpiresAt: time.Now().Add(time.Duration(seconds+30) * time.Second), RuntimeSeconds: seconds, ResourceApprovalRef: "PUBLIC_CI_ONLY"}
		return e, p
	}
	opFor := func(e *OCIIDEDeploymentExecutor, p IDEDeploymentPermit) IDEDeploymentOperation {
		t.Helper()
		r, err := readIDECreatedRecord(filepath.Join(e.cfg.StorageRoot, "resource-"+productHash([]byte(p.ResourceID))+".json"))
		if err != nil {
			t.Fatal(err)
		}
		return r.Operation
	}
	cleanup := func(e *OCIIDEDeploymentExecutor, op IDEDeploymentOperation) {
		t.Helper()
		if _, err := e.inspect(ctx, op); err != nil {
			t.Fatal("refuse cleanup of changed original", err)
		}
		if _, err := e.run(ctx, "rm", "--force", op.DeploymentID); err != nil {
			t.Fatal("cleanup original ID", err)
		}
	}
	t.Run("http-body-isolation-usage-cold-cancel", func(t *testing.T) {
		body := []byte(`import http from 'node:http';import fs from 'node:fs';import net from 'node:net';let readonly=false;try{fs.writeFileSync('/app/artifact.mjs','overwrite')}catch{readonly=true}const s=net.connect({host:'1.1.1.1',port:443});s.setTimeout(500,()=>s.destroy());s.on('error',()=>{});const result=JSON.stringify({business:'P04_ACTUAL_BODY',uid:process.getuid(),readonly,interfaces:Object.keys((await import('node:os')).networkInterfaces()),socketVisible:fs.existsSync('/var/run/docker.sock')});console.log('P04_ACTUAL_STARTED');http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(result)}).listen(18080,'127.0.0.1');`)
		e, p := newCase("http", body, 60, true)
		_, applyErr := e.ApplyExisting(ctx, p, bytes.NewReader(body), func() error { return nil })
		op := opFor(e, p)
		defer cleanup(e, op)
		if op.DeploymentID == "" {
			t.Fatal("no actual created ID", applyErr)
		}
		var result IDEDeploymentResult
		for i := 0; i < 30; i++ {
			result, err = e.ObserveOriginal(ctx, op)
			if err == nil && result.State == "running" {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		if err != nil || result.State != "running" {
			t.Fatal("actual application readiness", result, err, applyErr)
		}
		request := &http.Request{Method: "GET", URL: &url.URL{Path: "/business"}, Header: make(http.Header)}
		response, err := e.RoundTripProject(ctx, op, request)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 {
			t.Fatal("actual business response", err)
		}
		var business struct {
			Business      string
			UID           int
			Readonly      bool
			Interfaces    []string
			SocketVisible bool
		}
		if json.Unmarshal(raw, &business) != nil || business.Business != "P04_ACTUAL_BODY" || business.UID != 10001 || !business.Readonly || business.SocketVisible || len(business.Interfaces) != 1 || business.Interfaces[0] != "lo" {
			t.Fatalf("sandbox boundary/business mismatch: %s", raw)
		}
		logs, err := e.Logs(ctx, op, 4096)
		if err != nil || !bytes.Contains(logs, []byte("P04_ACTUAL_STARTED")) {
			t.Fatal("actual bounded logs", err)
		}
		usage, err := e.ObserveUsage(ctx, op)
		if err != nil || usage.InstanceID != op.DeploymentID || usage.StoredBytes == "0" {
			transport := &http.Transport{DialContext: func(c context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(c, "unix", socket)
			}}
			client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
			for _, prefix := range []string{"", "/v1.41"} {
				r, diagnosticErr := client.Get("http://docker" + prefix + "/containers/" + op.DeploymentID + "/stats?stream=false&one-shot=true")
				if diagnosticErr != nil {
					t.Log("ACTUAL_STATS_DIAGNOSTIC", prefix, diagnosticErr)
					continue
				}
				b, _ := io.ReadAll(io.LimitReader(r.Body, 16384))
				r.Body.Close()
				t.Logf("ACTUAL_STATS_DIAGNOSTIC prefix=%s status=%d body=%s", prefix, r.StatusCode, b)
			}
			transport.CloseIdleConnections()
			t.Fatal("actual engine usage", usage, err)
		}
		cold, err := NewOCIIDEDeploymentExecutor(e.cfg)
		if err != nil {
			t.Fatal(err)
		}
		observed, err := cold.ObserveOriginal(ctx, op)
		if err != nil || observed.DeploymentID != op.DeploymentID {
			t.Fatal("cold original instance", err)
		}
		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		if _, err = cold.RoundTripProject(cancelled, op, request); err == nil {
			t.Fatal("cancelled client read accepted")
		}
		// Explicit synthetic CI operator stop of its exact already-inspected ID.
		// It is cleanup/cancel evidence, NOT a new Cloud business stop permission.
		if _, err = cold.run(ctx, "stop", "--time=2", op.DeploymentID); err != nil {
			t.Fatal(err)
		}
		stopped, err := cold.ObserveOriginal(ctx, op)
		if err != nil || stopped.State != "failed" {
			t.Fatal("actual cancelled instance not terminal", stopped, err)
		}
		t.Logf("ACTUAL_HTTP instance=%s body=%s usage=%+v cancellation=operator-stop-not-business-grant", op.DeploymentID, raw, usage)
	})
	t.Run("bounded-runtime-forced-exit", func(t *testing.T) {
		body := []byte("console.log('P04_ACTUAL_TIMEOUT');setInterval(()=>{},10);")
		e, p := newCase("timeout", body, 7, false)
		if _, err = e.ApplyExisting(ctx, p, bytes.NewReader(body), func() error { return nil }); err != nil {
			t.Fatal(err)
		}
		op := opFor(e, p)
		defer cleanup(e, op)
		var r IDEDeploymentResult
		for i := 0; i < 80; i++ {
			r, err = e.ObserveOriginal(ctx, op)
			if err == nil && r.State == "failed" {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		if err != nil || r.State != "failed" || r.ExitCode == nil || *r.ExitCode != 124 {
			t.Fatal("real timeout did not enforce cap", r, err)
		}
		t.Logf("ACTUAL_TIMEOUT instance=%s exit=%d", op.DeploymentID, *r.ExitCode)
	})
	t.Run("cancel-before-effect", func(t *testing.T) {
		e, p := newCase("beforecancel", []byte("console.log('must not run')"), 10, false)
		c, cancel := context.WithCancel(ctx)
		cancel()
		if _, err = e.ApplyExisting(c, p, strings.NewReader("console.log('must not run')"), func() error { return c.Err() }); !errors.Is(err, context.Canceled) {
			t.Fatal("cancel did not stop pre-dispatch", err)
		}
		cmd := exec.Command(binary, "--host", "unix://"+socket, "ps", "--all", "--quiet", "--filter", "label=ynx.ide.request="+p.RequestID)
		out, err := cmd.Output()
		if err != nil || len(bytes.TrimSpace(out)) != 0 {
			t.Fatal("cancelled request created container", err)
		}
	})
}
