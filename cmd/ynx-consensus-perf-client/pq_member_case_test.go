package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func pqMemberUnitFixture(t *testing.T) ([]byte, ynxbatch.Registration) {
	t.Helper()
	k, pub, e := ynxbatch.KeyGen()
	if e != nil {
		t.Fatal(e)
	}
	defer k.Destroy()
	network := bytes.Repeat([]byte{0x31}, 32)
	owner := "0x" + strings.Repeat("12", 20)
	message, e := (ynxauth.Transfer{ChainID: network, NativeChainID: 6423, From: owner, To: "0x" + strings.Repeat("34", 20), Amount: 1, Fee: 1, Nonce: 1}).SigningBytes()
	if e != nil {
		t.Fatal(e)
	}
	batch, e := ynxbatch.BatchSign(k, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	if e != nil {
		t.Fatal(e)
	}
	defer batch.Discard()
	member, e := ynxbatch.Extract(batch, 0)
	if e != nil {
		t.Fatal(e)
	}
	wire, e := ynxbatch.EncodeMember(member)
	if e != nil {
		t.Fatal(e)
	}
	return wire, ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: owner, Purpose: ynxauth.TransactionPurpose, PolicyRevision: "unit-only-known-registration", ChainID: network, PKA: pub.PKA, PKB: pub.PKB, Enabled: true, ActiveFrom: 1}
}
func verifyPQMemberUnit(wire []byte, r ynxbatch.Registration) error {
	v, e := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: r.ChainID, Purpose: r.Purpose, CacheEntries: 1, Optimized: true, ResolveTrustedOwner: func(ynxbatch.TrustRequest) (ynxbatch.Registration, error) { return r, nil }})
	if e != nil {
		return e
	}
	defer v.Clear()
	return v.VerifyOne(wire, 7)
}
func pqMemberUnitView(p pqWholeCase) bftgateway.PQMemberView {
	t := p.transfer
	index := uint32(0)
	tx := &chain.Transaction{Hash: p.native, From: t.From, To: t.To, Amount: int64(t.Amount), Fee: int64(t.Fee), Nonce: t.Nonce, BlockNum: 7}
	return bftgateway.PQMemberView{Type: consensus.PQTransferType, Status: "committed", Committed: true, Source: "comet-rpc", NativeTransactionHash: p.native, ABCITransactionHash: p.outer, Wire: p.wire, ExecutionHeight: 7, CometIndex: &index, From: t.From, To: t.To, Amount: tx.Amount, Fee: tx.Fee, Nonce: t.Nonce, Transaction: tx, ReadbackURL: "/transactions/pq/originals/" + p.native}
}
func TestPQMemberCaseCanonicalN1AndOriginalNativeHash(t *testing.T) {
	wire, registration := pqMemberUnitFixture(t)
	p, e := preparePQMemberCase(wire)
	if e != nil {
		t.Fatal(e)
	}
	if e = verifyPQMemberUnit(wire, registration); e != nil {
		t.Fatal(e)
	}
	if p.native != consensus.SignedTransactionHash(wire) || p.outer == p.native || len(p.members) != 1 || p.batch != "" {
		t.Fatal("Member and Whole/ABCI identities conflated")
	}
	member, _ := ynxbatch.DecodeMember(wire)
	member.Certificate.SigmaB[0] ^= 1
	bad, e := ynxbatch.EncodeMember(member)
	if e != nil {
		t.Fatal(e)
	}
	if verifyPQMemberUnit(bad, registration) == nil {
		t.Fatal("N1 accepted damaged SLH branch")
	}
	var posts, gets atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			body, _ := io.ReadAll(r.Body)
			if r.URL.Path != "/transactions/pq/broadcast" || !bytes.Equal(body, wire) || verifyPQMemberUnit(body, registration) != nil {
				http.Error(w, "invalid Member", 422)
				return
			}
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(bftgateway.PQMemberView{Type: consensus.PQTransferType, Status: "unknown", Source: "comet-rpc", NativeTransactionHash: p.native, ABCITransactionHash: p.outer, ReadbackURL: "/transactions/pq/originals/" + p.native})
			return
		}
		gets.Add(1)
		if r.URL.Path != "/transactions/pq/originals/"+p.native {
			http.Error(w, "other original identity", 404)
			return
		}
		json.NewEncoder(w).Encode(pqMemberUnitView(p))
	}))
	defer server.Close()
	dir := t.TempDir()
	path := filepath.Join(dir, "approved-member.bin")
	if e = os.WriteFile(path, wire, 0600); e != nil {
		t.Fatal(e)
	}
	o := options{pqMemberWire: path, pqGateway: server.URL, output: filepath.Join(dir, "result.json"), timeout: 5 * time.Second}
	if e = execute(o); e != nil {
		t.Fatal(e)
	}
	var got pqWholeCaseReport
	raw, _ := os.ReadFile(o.output)
	if e = json.Unmarshal(raw, &got); e != nil {
		t.Fatal(e)
	}
	if posts.Load() != 1 || gets.Load() != 1 || !got.InitialSubmissionUnknown || got.TransactionType != consensus.PQTransferType || got.NativeTransactionHash != p.native || got.Members != 1 || got.EffectiveBusinessIncludedObserved != 1 || got.IndependentFinalityVerified {
		t.Fatal("N1 normal route/UNKNOWN business count differs", got)
	}
	o.pqReadbackOnly = true
	o.output = filepath.Join(dir, "read-only.json")
	if e = execute(o); e != nil || posts.Load() != 1 {
		t.Fatal("N1 original readback resubmitted", e)
	}
	for _, f := range []func(*bftgateway.PQMemberView){func(v *bftgateway.PQMemberView) { v.Status = "durable" }, func(v *bftgateway.PQMemberView) { v.Source = "source_import" }, func(v *bftgateway.PQMemberView) { v.Nonce++ }, func(v *bftgateway.PQMemberView) { v.Amount = 1000000000000000000 }, func(v *bftgateway.PQMemberView) { v.NativeTransactionHash = p.outer }, func(v *bftgateway.PQMemberView) { v.Transaction.Hash = p.outer }, func(v *bftgateway.PQMemberView) { v.Wire = bad }} {
		view := pqMemberUnitView(p)
		f(&view)
		if _, e = p.validateMemberCommitted(view); e == nil {
			t.Fatal("unbound N1 response counted")
		}
	}
	o.pqWholeWire = path
	if validateOptions(o) == nil {
		t.Fatal("two wire profiles accepted")
	}
}
func TestPQMemberCaseRealCLI(t *testing.T) {
	if wire := os.Getenv("YNX_PQ_MEMBER_CLI_INPUT"); wire != "" {
		flag.CommandLine = flag.NewFlagSet("ynx-consensus-perf-client", flag.ContinueOnError)
		os.Args = []string{"ynx-consensus-perf-client", "-pq-member", wire, "-pq-gateway", os.Getenv("YNX_PQ_MEMBER_CLI_GATEWAY"), "-output", os.Getenv("YNX_PQ_MEMBER_CLI_OUTPUT"), "-timeout", "5s"}
		main()
		return
	}
	wire, _ := pqMemberUnitFixture(t)
	p, e := preparePQMemberCase(wire)
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(pqMemberUnitView(p)) }))
	defer server.Close()
	dir := t.TempDir()
	input := filepath.Join(dir, "member.bin")
	output := filepath.Join(dir, "normal-cli.json")
	os.WriteFile(input, wire, 0600)
	child := exec.Command(os.Args[0], "-test.run=^TestPQMemberCaseRealCLI$")
	child.Env = append(os.Environ(), "GOMAXPROCS=1", "YNX_PQ_MEMBER_CLI_INPUT="+input, "YNX_PQ_MEMBER_CLI_GATEWAY="+server.URL, "YNX_PQ_MEMBER_CLI_OUTPUT="+output)
	if raw, e := child.CombinedOutput(); e != nil {
		t.Fatalf("N1 normal CLI failed %v %s", e, raw)
	}
	var got pqWholeCaseReport
	raw, e := os.ReadFile(output)
	if e != nil {
		t.Fatal(e)
	}
	json.Unmarshal(raw, &got)
	if got.TransactionType != consensus.PQTransferType || got.EffectiveBusinessIncludedObserved != 1 || got.SubmissionAttempts != 1 || got.IndependentFinalityVerified {
		t.Fatal("normal CLI N1 did not use canonical Member route", got)
	}
}
