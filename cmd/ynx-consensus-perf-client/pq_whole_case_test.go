package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Real canonical dual-signed input; the HTTP stub is explicitly a unit RPC
// observation, never an actual node/block/finality or production registration.
func pqWholeCaseSignedFixture(t *testing.T) ([]byte, ynxbatch.Registration) {
	t.Helper()
	key, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	network := bytes.Repeat([]byte{0x31}, 32)
	owner := "0x" + strings.Repeat("12", 20)
	to := "0x" + strings.Repeat("34", 20)
	messages := make([][]byte, 2)
	for i := range messages {
		messages[i], err = (ynxauth.Transfer{ChainID: network, NativeChainID: 6423, From: owner, To: to, Amount: 1, Fee: 1, Nonce: uint64(i + 1)}).SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
	}
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	wire, err := batch.WholeWire()
	if err != nil {
		t.Fatal(err)
	}
	return wire, ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: owner, Purpose: ynxauth.TransactionPurpose, PolicyRevision: "unit-only-known-registration", ChainID: network, PKA: pub.PKA, PKB: pub.PKB, Enabled: true, ActiveFrom: 1}
}
func verifyPQWholeUnit(wire []byte, registration ynxbatch.Registration) error {
	whole, err := ynxbatch.DecodeWhole(wire)
	if err != nil {
		return err
	}
	verifier, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: registration.ChainID, Purpose: registration.Purpose, CacheEntries: 1, Optimized: true, ResolveTrustedOwner: func(r ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		if r.Owner != registration.Owner || !bytes.Equal(r.ChainID, registration.ChainID) || r.Purpose != registration.Purpose {
			return ynxbatch.Registration{}, errors.New("unit registration mismatch")
		}
		return registration, nil
	}})
	if err != nil {
		return err
	}
	defer verifier.Clear()
	certificate, err := ynxbatch.EncodeCertificate(whole.Certificate)
	if err != nil {
		return err
	}
	return verifier.VerifyWholeBatch(certificate, whole.Messages, 7)
}
func pqWholeUnitView(p pqWholeCase) bftgateway.PQWholeView {
	index := uint32(0)
	rows := make([]chain.PQBatchMemberResult, len(p.members))
	for i, h := range p.members {
		rows[i] = chain.PQBatchMemberResult{Index: uint32(i), Outcome: "admitted", TransactionHash: h}
	}
	return bftgateway.PQWholeView{Type: consensus.PQWholeType, Status: "committed", Committed: true, Provenance: "comet-rpc", ABCITransactionHash: p.outer, BatchHash: p.batch, ExecutionHeight: 7, CometIndex: &index, FeeYNXT: uint64(len(rows)), Results: rows, Whole: p.wire, ReadbackURL: "/transactions/pq/wholes/" + p.outer}
}
func TestPQWholeCaseCanonicalDualSignedInputAndOriginalObservation(t *testing.T) {
	wire, registration := pqWholeCaseSignedFixture(t)
	p, err := preparePQWholeCase(wire)
	if err != nil {
		t.Fatal(err)
	}
	if err = verifyPQWholeUnit(wire, registration); err != nil {
		t.Fatal(err)
	}
	for _, branch := range []string{"ML-DSA-87", "SLH-DSA-SHA2-256f"} {
		whole, _ := ynxbatch.DecodeWhole(wire)
		if branch == "ML-DSA-87" {
			whole.Certificate.SigmaA[0] ^= 1
		} else {
			whole.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeWhole(whole)
		if err != nil {
			t.Fatal(err)
		}
		if verifyPQWholeUnit(bad, registration) == nil {
			t.Fatal("corrupted signature branch passed", branch)
		}
	}
	posts, gets := 0, 0
	view := pqWholeUnitView(p)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts++
			body, _ := io.ReadAll(r.Body)
			if r.URL.Path != "/transactions/pq/batches/broadcast" || !bytes.Equal(body, wire) || verifyPQWholeUnit(body, registration) != nil {
				http.Error(w, "bad canonical input", 422)
				return
			}
		}
		if r.Method == http.MethodGet {
			gets++
			if r.URL.Path != view.ReadbackURL {
				http.Error(w, "other original", 404)
				return
			}
		}
		json.NewEncoder(w).Encode(view)
	}))
	defer server.Close()
	got := runPQWholeCase(context.Background(), server.Client(), p, server.URL, false)
	if posts != 1 || gets != 1 || got.Status != "committed_observed" || got.EffectiveBusinessIncludedObserved != 2 || got.IndependentFinalityVerified || got.SustainedTPSQualified || !got.ConfiguredRPCObservationOnly {
		t.Fatalf("wrong bounded observation %+v post/get=%d/%d", got, posts, gets)
	}
	// A partial Whole counts only its canonical successful member effects.
	partial := pqWholeUnitView(p)
	partial.Results[1] = chain.PQBatchMemberResult{Index: 1, Outcome: "rejected", Error: "invalid nonce"}
	partial.FeeYNXT = 1
	a, rejected, err := p.validateCommitted(partial)
	if err != nil || a != 1 || rejected != 1 {
		t.Fatal("partial batch was counted as two businesses", a, rejected, err)
	}
	for _, mutate := range []func(*bftgateway.PQWholeView){func(v *bftgateway.PQWholeView) { v.Status = "durable" }, func(v *bftgateway.PQWholeView) { v.Provenance = "imported-authoritative-source" }, func(v *bftgateway.PQWholeView) { v.Results[0].TransactionHash = "other" }, func(v *bftgateway.PQWholeView) { v.Results[0].Index = 1 }, func(v *bftgateway.PQWholeView) { v.FeeYNXT = 99 }, func(v *bftgateway.PQWholeView) { v.Whole = []byte("other") }} {
		bad := pqWholeUnitView(p)
		mutate(&bad)
		if _, _, err = p.validateCommitted(bad); err == nil {
			t.Fatal("unbound member/Whole counted")
		}
	}
}
func TestPQWholeCaseUnknownIsReadOnlyReconciledAndIntentPreserved(t *testing.T) {
	wire, _ := pqWholeCaseSignedFixture(t)
	p, err := preparePQWholeCase(wire)
	if err != nil {
		t.Fatal(err)
	}
	posts, gets := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts++
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(bftgateway.PQWholeView{Type: consensus.PQWholeType, Status: "unknown", Provenance: "comet-rpc", ABCITransactionHash: p.outer, BatchHash: p.batch, ReadbackURL: "/transactions/pq/wholes/" + p.outer})
			return
		}
		gets++
		json.NewEncoder(w).Encode(pqWholeUnitView(p))
	}))
	defer server.Close()
	dir := t.TempDir()
	path := filepath.Join(dir, "original-whole.bin")
	os.WriteFile(path, wire, 0600)
	o := options{pqWholeWire: path, pqGateway: server.URL, output: filepath.Join(dir, "result.json"), timeout: 5 * time.Second}
	if err = execute(o); err != nil {
		t.Fatal(err)
	}
	var got pqWholeCaseReport
	raw, _ := os.ReadFile(o.output)
	if err = json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if !got.InitialSubmissionUnknown || posts != 1 || gets != 1 || got.EffectiveBusinessIncludedObserved != 2 {
		t.Fatal("UNKNOWN was replayed or lost", got, posts, gets)
	}
	intent, err := os.ReadFile(o.output + ".pq-intent.json")
	if err != nil || !bytes.Contains(intent, []byte(p.outer)) {
		t.Fatal("original intent absent", err)
	}
	if execute(o) == nil || posts != 1 {
		t.Fatal("existing output allowed another broadcast")
	}
	o.output = filepath.Join(dir, "read-only.json")
	o.pqReadbackOnly = true
	if err = execute(o); err != nil {
		t.Fatal(err)
	}
	if posts != 1 || gets != 2 {
		t.Fatal("readback-only broadcast")
	}
	after, _ := os.ReadFile(filepath.Join(dir, "result.json.pq-intent.json"))
	if !bytes.Equal(after, intent) {
		t.Fatal("UNKNOWN original intent changed")
	}
	o.transactions = "classic.json"
	if validateOptions(o) == nil {
		t.Fatal("classic fixture entered PQ case")
	}
}

func TestPQWholeCaseRedirectNeverRebroadcasts(t *testing.T) {
	wire, _ := pqWholeCaseSignedFixture(t)
	p, err := preparePQWholeCase(wire)
	if err != nil {
		t.Fatal(err)
	}
	posts, redirected := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/unexpected-second-post" {
			redirected++
			http.Error(w, "redirect followed", 500)
			return
		}
		if r.Method == http.MethodPost {
			posts++
			http.Redirect(w, r, "/unexpected-second-post", http.StatusTemporaryRedirect)
			return
		}
		json.NewEncoder(w).Encode(pqWholeUnitView(p))
	}))
	defer server.Close()
	dir := t.TempDir()
	path := filepath.Join(dir, "original-whole.bin")
	if err = os.WriteFile(path, wire, 0600); err != nil {
		t.Fatal(err)
	}
	o := options{pqWholeWire: path, pqGateway: server.URL, output: filepath.Join(dir, "result.json"), timeout: 5 * time.Second}
	if err = execute(o); err != nil {
		t.Fatal(err)
	}
	if posts != 1 || redirected != 0 {
		t.Fatal("canonical signed Whole was redirected/rebroadcast", posts, redirected)
	}
	var got pqWholeCaseReport
	raw, _ := os.ReadFile(o.output)
	json.Unmarshal(raw, &got)
	if !got.InitialSubmissionUnknown || got.OriginalReadbackAttempts != 1 || got.IndependentFinalityVerified {
		t.Fatal("redirect made invented finality", got)
	}
}

func TestPQWholeCaseRealCLI(t *testing.T) {
	if wire := os.Getenv("YNX_PQ_WHOLE_CLI_INPUT"); wire != "" {
		flag.CommandLine = flag.NewFlagSet("ynx-consensus-perf-client", flag.ContinueOnError)
		os.Args = []string{"ynx-consensus-perf-client", "-pq-whole", wire, "-pq-gateway", os.Getenv("YNX_PQ_WHOLE_CLI_GATEWAY"), "-output", os.Getenv("YNX_PQ_WHOLE_CLI_OUTPUT"), "-timeout", "5s"}
		main()
		return
	}
	wire, _ := pqWholeCaseSignedFixture(t)
	p, err := preparePQWholeCase(wire)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(pqWholeUnitView(p)) }))
	defer server.Close()
	dir := t.TempDir()
	input := filepath.Join(dir, "whole.bin")
	output := filepath.Join(dir, "normal-cli.json")
	if err = os.WriteFile(input, wire, 0600); err != nil {
		t.Fatal(err)
	}
	child := exec.Command(os.Args[0], "-test.run=^TestPQWholeCaseRealCLI$")
	child.Env = append(os.Environ(), "GOMAXPROCS=1", "YNX_PQ_WHOLE_CLI_INPUT="+input, "YNX_PQ_WHOLE_CLI_GATEWAY="+server.URL, "YNX_PQ_WHOLE_CLI_OUTPUT="+output)
	if raw, err := child.CombinedOutput(); err != nil {
		t.Fatalf("normal CLI failed %v %s", err, raw)
	}
	var got pqWholeCaseReport
	raw, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Protocol != ynxbatch.Version || got.SubmissionAttempts != 1 || got.EffectiveBusinessIncludedObserved != 2 || got.IndependentFinalityVerified {
		t.Fatal("normal CLI did not select canonical PQ path", got)
	}
}
