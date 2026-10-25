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

// Possession fixture only. It is not a real Genesis allowlist or account grant.
func pqInitialUnitFixture(t *testing.T) ([]byte, ynxbatch.Registration) {
	t.Helper()
	key, pub, e := ynxbatch.KeyGen()
	if e != nil {
		t.Fatal(e)
	}
	defer key.Destroy()
	network := bytes.Repeat([]byte{0x31}, 32)
	owner := "0x" + strings.Repeat("12", 20)
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owner, PKA: pub.PKA, PKB: pub.PKB, PriorRevision: 0, NewRevision: 1, LedgerNonce: 1, ActivateAt: 20}
	message, e := intent.SigningBytes()
	if e != nil {
		t.Fatal(e)
	}
	batch, e := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
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
	return wire, ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: owner, Purpose: ynxauth.TransactionPurpose, PolicyRevision: "unit-bootstrap-only", ChainID: network, PKA: pub.PKA, PKB: pub.PKB, Enabled: true, ActiveFrom: 1}
}
func pqInitialUnitView(p pqWholeCase) bftgateway.PQMemberView {
	index := uint32(0)
	owner := p.registration.Owner
	tx := &chain.Transaction{Hash: p.native, Type: consensus.PQInitialRegistrationType, From: owner, To: owner, Amount: 0, Fee: 0, Nonce: 1, BlockNum: 7}
	return bftgateway.PQMemberView{Type: consensus.PQInitialRegistrationType, Status: "committed", Committed: true, Source: "comet-rpc", NativeTransactionHash: p.native, ABCITransactionHash: p.outer, Wire: p.wire, ExecutionHeight: 7, CometIndex: &index, From: owner, To: owner, Amount: 0, Fee: 0, Nonce: 1, Transaction: tx, ReadbackURL: "/transactions/pq/originals/" + p.native}
}
func TestPQRegistrationCaseNormalBirthRouteNeverCountsOrFundsTransfers(t *testing.T) {
	wire, knownUnitBinding := pqInitialUnitFixture(t)
	p, e := preparePQInitialCase(wire)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = ynxauth.VerifyPQInitialRegistrationPossession(wire, knownUnitBinding, 7); e != nil {
		t.Fatal(e)
	}
	var posts, gets atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			body, _ := io.ReadAll(r.Body)
			if r.URL.Path != "/accounts/"+p.registration.Owner+"/authorization/register" || !bytes.Equal(body, wire) {
				http.Error(w, "wrong original", 422)
				return
			}
			if _, e := ynxauth.VerifyPQInitialRegistrationPossession(body, knownUnitBinding, 7); e != nil {
				http.Error(w, "bad possession", 422)
				return
			}
		}
		if r.Method == http.MethodGet {
			gets.Add(1)
			if r.URL.Path != "/transactions/pq/originals/"+p.native {
				http.Error(w, "wrong original lookup", 404)
				return
			}
		}
		json.NewEncoder(w).Encode(pqInitialUnitView(p))
	}))
	defer server.Close()
	dir := t.TempDir()
	input := filepath.Join(dir, "registration-member.bin")
	os.WriteFile(input, wire, 0600)
	o := options{pqRegistrationWire: input, pqGateway: server.URL, output: filepath.Join(dir, "registration.json"), timeout: 5 * time.Second}
	if e = execute(o); e != nil {
		t.Fatal(e)
	}
	var got pqWholeCaseReport
	raw, _ := os.ReadFile(o.output)
	if e = json.Unmarshal(raw, &got); e != nil {
		t.Fatal(e)
	}
	if posts.Load() != 1 || gets.Load() != 1 || got.Status != "registration_observed" || !got.RegistrationObserved || got.AccountActivationHeight != 20 || got.EffectiveBusinessIncludedObserved != 0 || got.IndependentFinalityVerified {
		t.Fatal("registration became a transfer/finality claim", got)
	}
	for _, f := range []func(*bftgateway.PQMemberView){func(v *bftgateway.PQMemberView) { v.Amount = 1 }, func(v *bftgateway.PQMemberView) { v.Fee = 1 }, func(v *bftgateway.PQMemberView) { v.Nonce = 2 }, func(v *bftgateway.PQMemberView) { v.ExecutionHeight = 20; v.Transaction.BlockNum = 20 }, func(v *bftgateway.PQMemberView) { v.Transaction.Type = consensus.PQTransferType }, func(v *bftgateway.PQMemberView) { v.To = "other" }, func(v *bftgateway.PQMemberView) { v.Wire = []byte("other") }} {
		bad := pqInitialUnitView(p)
		f(&bad)
		if p.validateInitialCommitted(bad) == nil {
			t.Fatal("birth fund/fee/nonce/height injection accepted")
		}
	}
	o.pqReadbackOnly = true
	o.output = filepath.Join(dir, "registration-read-only.json")
	if e = execute(o); e != nil || posts.Load() != 1 {
		t.Fatal("initial registration was rePOSTed", e)
	}
	if _, e = preparePQMemberCase(wire); e == nil {
		t.Fatal("registration Member entered transfer path")
	}
}
func TestPQRegistrationCaseRealCLI(t *testing.T) {
	if wire := os.Getenv("YNX_PQ_INITIAL_CLI_INPUT"); wire != "" {
		flag.CommandLine = flag.NewFlagSet("ynx-consensus-perf-client", flag.ContinueOnError)
		os.Args = []string{"ynx-consensus-perf-client", "-pq-register", wire, "-pq-gateway", os.Getenv("YNX_PQ_INITIAL_CLI_GATEWAY"), "-output", os.Getenv("YNX_PQ_INITIAL_CLI_OUTPUT"), "-timeout", "5s"}
		main()
		return
	}
	wire, _ := pqInitialUnitFixture(t)
	p, e := preparePQInitialCase(wire)
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(pqInitialUnitView(p)) }))
	defer server.Close()
	dir := t.TempDir()
	input := filepath.Join(dir, "registration.bin")
	output := filepath.Join(dir, "normal-cli.json")
	os.WriteFile(input, wire, 0600)
	child := exec.Command(os.Args[0], "-test.run=^TestPQRegistrationCaseRealCLI$")
	child.Env = append(os.Environ(), "GOMAXPROCS=1", "YNX_PQ_INITIAL_CLI_INPUT="+input, "YNX_PQ_INITIAL_CLI_GATEWAY="+server.URL, "YNX_PQ_INITIAL_CLI_OUTPUT="+output)
	if raw, e := child.CombinedOutput(); e != nil {
		t.Fatalf("registration normal CLI failed %v %s", e, raw)
	}
	var got pqWholeCaseReport
	raw, e := os.ReadFile(output)
	if e != nil {
		t.Fatal(e)
	}
	json.Unmarshal(raw, &got)
	if !got.RegistrationObserved || got.TransactionType != consensus.PQInitialRegistrationType || got.EffectiveBusinessIncludedObserved != 0 || got.SubmissionAttempts != 1 {
		t.Fatal("normal CLI initial route differs", got)
	}
}
