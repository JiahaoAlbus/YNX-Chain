//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

func hostTestSHA(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }

func TestProofHostHeldOriginalSourceRejectsReplacementMutationAndLinks(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "original.json")
	raw := []byte(`{"original":"held"}`)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	ref, err := openHeldProofSource("original", path, hostTestSHA(raw), 1024)
	if err != nil {
		t.Fatal(err)
	}
	defer ref.file.Close()
	if err = ref.current(); err != nil {
		t.Fatal(err)
	}
	retained := filepath.Join(dir, "retained-original.json")
	if err = os.Rename(path, retained); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = ref.current(); err == nil {
		t.Fatal("same public bytes in a replacement inode reused held source")
	}
	if original, err := os.ReadFile(retained); err != nil || !bytes.Equal(original, raw) {
		t.Fatal("refusal changed original", err)
	}
	for _, kind := range []string{"symlink", "hardlink", "writable", "wrong-pin", "oversize"} {
		t.Run(kind, func(t *testing.T) {
			p := filepath.Join(dir, kind)
			switch kind {
			case "symlink":
				err = os.Symlink(path, p)
			case "hardlink":
				err = os.Link(path, p)
			default:
				err = os.WriteFile(p, raw, 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			pin, max := hostTestSHA(raw), int64(1024)
			if kind == "writable" {
				if err = os.Chmod(p, 0666); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "wrong-pin" {
				pin = strings.Repeat("ab", 32)
			}
			if kind == "oversize" {
				max = 1
			}
			if got, e := openHeldProofSource(kind, p, pin, max); e == nil {
				got.file.Close()
				t.Fatal("unsafe original source accepted")
			}
		})
	}
}

// Lifecycle control only: this intentionally does not construct a Snapshot,
// call Current, export trust, or pretend that fabricated metadata is authority.
func TestProofHostRevokeRetireJoinCannotReleaseAcceptedWork(t *testing.T) {
	for _, operation := range []string{"revoke", "retire"} {
		t.Run(operation, func(t *testing.T) {
			r := &proofHostRef{state: "current"}
			r.cond = sync.NewCond(&r.mu)
			if err := r.begin(); err != nil {
				t.Fatal(err)
			}
			if operation == "revoke" {
				r.Revoke()
			} else {
				r.Retire()
			}
			if err := r.begin(); err == nil {
				t.Fatal("terminal reference admitted new work")
			}
			joined := make(chan struct{})
			entered := make(chan struct{})
			go func() { close(entered); r.Join(); close(joined) }()
			<-entered
			select {
			case <-joined:
				t.Fatal("join returned with accepted work in flight")
			default:
			}
			if err := r.finish(); err == nil {
				t.Fatal("revoked in-flight work could publish its result")
			}
			<-joined
			if err := r.Close(); err != nil {
				t.Fatal(err)
			}
			if err := r.Close(); err != nil || r.state != "closed" {
				t.Fatal("close was not idempotent", err)
			}
			if err := r.begin(); err == nil {
				t.Fatal("closed reference was reacquired")
			}
		})
	}
}

func TestProofHostHeldSourceCannotRestoreOldBytesAndModificationTime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lifecycle.json")
	original := []byte(`{"status":"current"}`)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	r, err := openHeldProofSource("lifecycle", path, hostTestSHA(original), 1024)
	if err != nil {
		t.Fatal(err)
	}
	defer r.file.Close()
	if err = os.WriteFile(path, []byte(`{"status":"revoked"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Chtimes(path, r.info.ModTime(), r.info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err = r.current(); err == nil {
		t.Fatal("restored bytes/mtime revived captured lifecycle")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, original) {
		t.Fatal("refusal changed source", err)
	}
}

type hostPublicFixture struct {
	Version              string `json:"version"`
	SyntheticOnly        bool   `json:"syntheticOnly"`
	NativeRootAuthorized bool   `json:"nativeRootAuthorized"`
	Materials            []struct {
		Name, SHA256, ByteLength string
		Bytes                    []byte
	} `json:"materials"`
	TrustContextParameters map[string]string `json:"trustContextParameters"`
	TrustContextFiles      map[string]string `json:"trustContextFiles"`
	Cases                  []struct {
		ExpectedTransaction json.RawMessage `json:"expectedTransaction"`
		Request             json.RawMessage `json:"request"`
	} `json:"cases"`
}

func materializeHostFixture(t *testing.T, fixture hostPublicFixture) (string, string, hostTrustSource, transactionTrustContext) {
	t.Helper()
	dir := t.TempDir()
	if fixture.Version != "YNX-PQ-CONSENSUS-TRANSACTION-PROOF-PUBLIC-FIXTURE/v1" || !fixture.SyntheticOnly || fixture.NativeRootAuthorized || len(fixture.Cases) != 3 {
		t.Fatal("expected original public synthetic proof fixture, never production authority")
	}
	digests := map[string]string{}
	for _, m := range fixture.Materials {
		if filepath.Base(m.Name) != m.Name || hostTestSHA(m.Bytes) != m.SHA256 || len(m.Bytes) == 0 {
			t.Fatal("original public material identity mismatch")
		}
		if err := os.WriteFile(filepath.Join(dir, m.Name), m.Bytes, 0600); err != nil {
			t.Fatal(err)
		}
		digests[m.Name] = m.SHA256
	}
	fields := map[string]string{}
	for k, v := range fixture.TrustContextParameters {
		fields[k] = v
	}
	for k, v := range fixture.TrustContextFiles {
		if digests[v] == "" {
			t.Fatal("missing original public material")
		}
		fields[k] = filepath.Join(dir, v)
	}
	var c trustContext
	if err := strictStringObject(transactionJSON(t, fields), &c); err != nil {
		t.Fatal(err)
	}
	var expected transactionExpected
	if err := json.Unmarshal(fixture.Cases[0].ExpectedTransaction, &expected); err != nil {
		t.Fatal(err)
	}
	tx := transactionTrustContext{Version: transactionContextVersion, LightTrust: c, ExpectedTransaction: expected}
	contextRaw := transactionJSON(t, tx)
	contextPath := filepath.Join(dir, "context.json")
	if err := os.WriteFile(contextPath, contextRaw, 0600); err != nil {
		t.Fatal(err)
	}
	life := hostLifecycle{Version: hostLifecycleVersion, SourceID: "synthetic-source-controls", Epoch: "9007199254740993", Status: "current"}
	lifeRaw := transactionJSON(t, life)
	lifePath := filepath.Join(dir, "lifecycle.json")
	if err := os.WriteFile(lifePath, lifeRaw, 0600); err != nil {
		t.Fatal(err)
	}
	s := hostTrustSource{Version: hostSourceVersion, SourceID: life.SourceID, Epoch: life.Epoch, ContextFile: contextPath, ContextSHA256: hostTestSHA(contextRaw), LifecycleFile: lifePath, LifecycleSHA256: hostTestSHA(lifeRaw), MigrationSHA256: digests[filepath.Base(c.MigrationFile)], GenesisSHA256: digests[filepath.Base(c.GenesisFile)], StateSHA256: digests[filepath.Base(c.StateFile)], ScheduleSHA256: digests[filepath.Base(c.ScheduleFile)], TrustedLightBlockSHA256: digests[filepath.Base(c.TrustedLightBlockFile)]}
	raw := transactionJSON(t, s)
	sourcePath := filepath.Join(dir, "source.json")
	if err := os.WriteFile(sourcePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return sourcePath, hostTestSHA(raw), s, tx
}

// The normal CI producer emits this existing real dual-signed public fixture.
// The separate CI invocation MUST set the path; an absent fixture is explicitly
// skipped, never reported as a real acquisition or proof-verifier success.
func TestProofHostFromOriginalSignedPublicFixture(t *testing.T) {
	path := os.Getenv("YNX_PQ_HOST_PUBLIC_FIXTURE")
	if path == "" {
		t.Skip("requires the original normal CI public signed transaction fixture; no acquisition evidence from this skip")
	}
	raw, err := readPublicFile(path, 128<<20)
	if err != nil {
		t.Fatal(err)
	}
	var fixture hostPublicFixture
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	sourcePath, pin, s, tx := materializeHostFixture(t, fixture)
	ref, err := acquireProofHost(sourcePath, pin, time.Now)
	if err != nil {
		t.Fatal("actual normal source acquisition", err)
	}
	defer ref.Close()
	exported, err := ref.Current()
	if err != nil {
		t.Fatal(err)
	}
	if exported.ContextPath != s.ContextFile || exported.ContextSHA256 != s.ContextSHA256 || exported.Epoch != s.Epoch || exported.ExpectedTransaction == nil || *exported.ExpectedTransaction != tx.ExpectedTransaction || exported.NativeRootAuthorized || exported.ProofVerified || exported.SourceDeploymentQualified {
		t.Fatal("export altered original expected target or granted authority")
	}
	if !matchesSHA256(exported.ContextBytes, s.ContextSHA256) || !matchesSHA256(exported.SourceBytes, pin) || !matchesSHA256(exported.LifecycleBytes, s.LifecycleSHA256) {
		t.Fatal("export did not preserve original pinned bytes")
	}
	original, err := os.ReadFile(s.ContextFile)
	if err != nil || !bytes.Equal(original, exported.ContextBytes) {
		t.Fatal("context was re-encoded", err)
	}
	// Returned public buffers cannot mutate the held original or its expected.
	exported.ContextBytes[0] ^= 1
	exported.SourceBytes[0] ^= 1
	exported.LifecycleBytes[0] ^= 1
	exported.ExpectedTransaction.Index = "999"
	current, err := ref.Current()
	if err != nil || !bytes.Equal(current.ContextBytes, original) || *current.ExpectedTransaction != tx.ExpectedTransaction {
		t.Fatal("returned export aliases held ref", err)
	}
	var verified bytes.Buffer
	if run([]string{"--trust-context", current.ContextPath, "--trust-context-sha256", current.ContextSHA256}, bytes.NewReader(fixture.Cases[0].Request), &verified, time.Now) != 0 {
		t.Fatal("existing unchanged normal verifier rejected producer output", verified.String())
	}
	var result transactionCommandResult
	if err = json.Unmarshal(verified.Bytes(), &result); err != nil || result.Code != "VERIFIED_TRANSACTION_DATA" || result.Result == nil || !result.Result.ExecutionSuccessful {
		t.Fatal("real transaction proof did not verify", err)
	}

	args := []string{"--host-trust-source", sourcePath, "--host-trust-source-sha256", pin}
	acquireRequest := hostContextRequest{Version: hostRequestVersion, Operation: "acquire", SourceID: s.SourceID, Epoch: s.Epoch, SourceFingerprint: ""}
	var acquired bytes.Buffer
	if run(args, bytes.NewReader(transactionJSON(t, acquireRequest)), &acquired, time.Now) != 0 || acquired.Len() > maxHostContextOutputBytes {
		t.Fatal("normal bounded acquisition failed or exceeded transport bound", acquired.String())
	}
	var acquiredResult hostCommandResult
	if err = json.Unmarshal(acquired.Bytes(), &acquiredResult); err != nil || acquiredResult.Code != "EXPORTED_PROOF_TRUST_DATA" || acquiredResult.Context == nil || acquiredResult.Context.ContextPath != current.ContextPath || !reflect.DeepEqual(acquiredResult.Context.ExpectedTransaction, current.ExpectedTransaction) {
		t.Fatal("normal acquisition did not export the original context target", err)
	}
	if run(args, bytes.NewReader(transactionJSON(t, acquireRequest)), hostOutputFailure{}, time.Now) != 1 {
		t.Fatal("actual export with lost output reported success")
	}
	if originalAfter, err := os.ReadFile(s.ContextFile); err != nil || !bytes.Equal(originalAfter, original) {
		t.Fatal("lost output changed the original source", err)
	}
	request := hostContextRequest{Version: hostRequestVersion, Operation: "current", SourceID: s.SourceID, Epoch: s.Epoch, SourceFingerprint: current.SourceFingerprint}
	var output bytes.Buffer
	if run(args, bytes.NewReader(transactionJSON(t, request)), &output, time.Now) != 0 {
		t.Fatal("normal bounded current command failed", output.String())
	}
	var response hostCommandResult
	if err = json.Unmarshal(output.Bytes(), &response); err != nil || response.Context == nil || response.Context.SourceFingerprint != current.SourceFingerprint || !reflect.DeepEqual(response.Context.ExpectedTransaction, current.ExpectedTransaction) {
		t.Fatal("current export lost original target", err)
	}
	request.SourceFingerprint = strings.Repeat("ef", 32)
	output.Reset()
	if run(args, bytes.NewReader(transactionJSON(t, request)), &output, time.Now) == 0 {
		t.Fatal("foreign captured source fingerprint accepted")
	}
	assertHostFailure(t, output.Bytes(), "HOST_SOURCE_NOT_CURRENT")

	// Actual external lifecycle change revokes the held reference. Restoring
	// bytes cannot resurrect this in-process ref; Main owns cross-process epoch
	// retirement and must never treat a fresh child as a new grant.
	lifeRaw, err := os.ReadFile(s.LifecycleFile)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(s.LifecycleFile, bytes.Replace(lifeRaw, []byte(`"current"`), []byte(`"revoked"`), 1), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = ref.Current(); err == nil {
		t.Fatal("revoked source remained current")
	}
	if err = os.WriteFile(s.LifecycleFile, lifeRaw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = ref.Current(); err == nil {
		t.Fatal("restoring lifecycle bytes revived terminal ref")
	}

	for _, mode := range []string{"trusted-signature", "state", "context-expected"} {
		t.Run(mode, func(t *testing.T) {
			p, _, source, context := materializeHostFixture(t, fixture)
			switch mode {
			case "trusted-signature":
				b, err := os.ReadFile(context.LightTrust.TrustedLightBlockFile)
				if err != nil {
					t.Fatal(err)
				}
				lb, err := consensus.DecodePQTrustedLightBlock(b)
				if err != nil {
					t.Fatal(err)
				}
				if len(lb.Commit.Signatures) == 0 || len(lb.Commit.Signatures[0].Signature) == 0 {
					t.Fatal("missing actual signed fixture")
				}
				lb.Commit.Signatures[0].Signature[len(lb.Commit.Signatures[0].Signature)-1] ^= 1
				b, err = cmtjson.Marshal(lb)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(context.LightTrust.TrustedLightBlockFile, b, 0600); err != nil {
					t.Fatal(err)
				}
				source.TrustedLightBlockSHA256 = hostTestSHA(b)
				context.LightTrust.TrustedLightBlockSHA256 = source.TrustedLightBlockSHA256
			case "state":
				b, err := os.ReadFile(context.LightTrust.StateFile)
				if err != nil {
					t.Fatal(err)
				}
				b = append(bytes.Clone(b), []byte(`{"invalidTail":true}`)...)
				if err = os.WriteFile(context.LightTrust.StateFile, b, 0600); err != nil {
					t.Fatal(err)
				}
				source.StateSHA256 = hostTestSHA(b)
			case "context-expected":
				context.ExpectedTransaction.Block.BlockHash = strings.Repeat("de", 32)
			}
			b := transactionJSON(t, context)
			if err := os.WriteFile(source.ContextFile, b, 0600); err != nil {
				t.Fatal(err)
			}
			source.ContextSHA256 = hostTestSHA(b)
			b = transactionJSON(t, source)
			if err := os.WriteFile(p, b, 0600); err != nil {
				t.Fatal(err)
			}
			// New independent QA pins isolate normal signature/state/target
			// checks; these locally generated fixtures are never Host authority.
			if bad, err := acquireProofHost(p, hostTestSHA(b), time.Now); err == nil {
				bad.Close()
				t.Fatal("invalid source passed actual normal loader")
			}
		})
	}
	t.Log("PQ_PROOF_HOST_PUBLIC_FIXTURE_PASS normalSource=true originalExpected=true originalVerifier=true lifecycleRevocation=true productionAuthority=false")
}
