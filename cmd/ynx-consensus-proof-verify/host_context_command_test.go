//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func assertHostFailure(t *testing.T, raw []byte, code string) {
	t.Helper()
	var r hostCommandResult
	if err := strictJSON(raw, &r); err != nil || r.Version != hostResultVersion || r.Code != code || r.Context != nil || r.Error == "" {
		t.Fatal("host failure released a context or wrong code", err, string(raw))
	}
}

func TestProofHostCommandRequiresExactIndependentFlagsAndNoAuthorityFromInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.json")
	pin := strings.Repeat("ab", 32)
	args := []string{"--host-trust-source", path, "--host-trust-source-sha256", pin}
	if _, err := parseHostOptions(args); err != nil {
		t.Fatal(err)
	}
	for _, bad := range [][]string{
		args[:2], append(append([]string{}, args...), "--host-trust-source", path),
		append(append([]string{}, args...), "--trust-context", path), append(append([]string{}, args...), "--rpc", "https://peer.invalid"),
		append(append([]string{}, args...), "--now", "2026-10-18T00:00:00Z"),
	} {
		var out bytes.Buffer
		input := &observedInput{}
		if run(bad, input, &out, time.Now) != 1 || input.reads != 0 {
			t.Fatal("invalid host flags consumed input or succeeded")
		}
		assertHostFailure(t, out.Bytes(), "INVALID_ARGUMENTS")
	}
	base := hostContextRequest{Version: hostRequestVersion, Operation: "acquire", SourceID: "source", Epoch: "9007199254740993", SourceFingerprint: ""}
	raw := transactionJSON(t, base)
	for _, bad := range [][]byte{
		append([]byte(`{"trustContext":{},`), raw[1:]...), append([]byte(`{"expectedTransaction":{},`), raw[1:]...),
		bytes.Replace(raw, []byte(`"epoch":"9007199254740993"`), []byte(`"epoch":9007199254740993`), 1),
		bytes.Replace(raw, []byte(`"epoch":`), []byte(`"epoch":"1","epoch":`), 1),
		bytes.Replace(raw, []byte(`"sourceFingerprint":""`), []byte(`"sourceFingerprint":null`), 1),
		bytes.Replace(raw, []byte(`"operation":"acquire"`), []byte(`"operation":"revoke"`), 1),
		append(bytes.Clone(raw), []byte(`{}`)...),
	} {
		var out bytes.Buffer
		clockUsed := false
		if run(args, bytes.NewReader(bad), &out, func() time.Time { clockUsed = true; return time.Now() }) != 1 || clockUsed {
			t.Fatal("untrusted request supplied source or clock")
		}
		assertHostFailure(t, out.Bytes(), "INVALID_REQUEST")
	}
	var out bytes.Buffer
	if run(args, bytes.NewReader(raw), &out, time.Now) != 1 {
		t.Fatal("missing original source exported a context")
	}
	assertHostFailure(t, out.Bytes(), "HOST_SOURCE_INVALID")
}

func TestProofHostSourceIdentityAndLifecycleArePinnedNotSelfDeclared(t *testing.T) {
	dir := t.TempDir()
	lifePath := filepath.Join(dir, "lifecycle.json")
	contextPath := filepath.Join(dir, "context.json")
	c := proofContextSyntaxFixture(dir)
	contextRaw := transactionJSON(t, c)
	if err := os.WriteFile(contextPath, contextRaw, 0600); err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"revoked", "retired", "closed", "Current"} {
		life := hostLifecycle{Version: hostLifecycleVersion, SourceID: "source", Epoch: "1", Status: status}
		b := transactionJSON(t, life)
		if err := os.WriteFile(lifePath, b, 0600); err != nil {
			t.Fatal(err)
		}
		s := hostTrustSource{Version: hostSourceVersion, SourceID: "source", Epoch: "1", ContextFile: contextPath, ContextSHA256: hostTestSHA(contextRaw), LifecycleFile: lifePath, LifecycleSHA256: hostTestSHA(b)}
		raw := transactionJSON(t, s)
		p := filepath.Join(dir, status+".json")
		if err := os.WriteFile(p, raw, 0600); err != nil {
			t.Fatal(err)
		}
		if got, err := acquireProofHost(p, hostTestSHA(raw), time.Now); err == nil {
			got.Close()
			t.Fatal("non-current lifecycle accepted")
		}
		if after, err := os.ReadFile(p); err != nil || !bytes.Equal(after, raw) {
			t.Fatal("rejected source was repaired", err)
		}
	}
	var out bytes.Buffer
	// Existing one-shot verifier options are not dispatched to the new mode.
	if isHostContextInvocation([]string{"--trust-context", contextPath, "--trust-context-sha256", hostTestSHA(contextRaw)}) {
		t.Fatal("old proof ABI hijacked")
	}
	if run([]string{"--trust-context", contextPath, "--trust-context-sha256", hostTestSHA(contextRaw)}, bytes.NewReader([]byte(`{}`)), &out, time.Now) != 1 {
		t.Fatal("invalid old proof changed behavior")
	}
	assertProofFailure(t, out.Bytes(), "INVALID_REQUEST")
}

type hostOutputFailure struct{}

func (hostOutputFailure) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestProofHostBoundedCommandNeverWritesSourceOnOutputFailure(t *testing.T) {
	// Negative startup output failure is still failure, with no source/repair.
	p := filepath.Join(t.TempDir(), "missing.json")
	request := hostContextRequest{Version: hostRequestVersion, Operation: "acquire", SourceID: "source", Epoch: "1", SourceFingerprint: ""}
	raw, _ := json.Marshal(request)
	if run([]string{"--host-trust-source", p, "--host-trust-source-sha256", strings.Repeat("ab", 32)}, bytes.NewReader(raw), hostOutputFailure{}, time.Now) != 1 {
		t.Fatal("output error became success")
	}
	if _, err := os.Lstat(p); !os.IsNotExist(err) {
		t.Fatal("normal producer created missing source", err)
	}
}
