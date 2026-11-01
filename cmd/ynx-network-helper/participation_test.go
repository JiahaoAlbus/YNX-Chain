package main_test

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// These HTTP services and temporary PQ keys are isolated fixtures. The consumer
// only reports configured-RPC observations; no real Wallet publisher, public
// account, funds, vote, original issuer or independent-finality proof is used.
var participationKeys struct {
	once sync.Once
	key  *ynxbatch.PrivateKey
	pub  ynxbatch.PublicKey
	err  error
}

func participantKey(t *testing.T) (*ynxbatch.PrivateKey, ynxbatch.PublicKey) {
	t.Helper()
	participationKeys.once.Do(func() { participationKeys.key, participationKeys.pub, participationKeys.err = ynxbatch.KeyGen() })
	if participationKeys.err != nil {
		t.Fatal(participationKeys.err)
	}
	return participationKeys.key, participationKeys.pub
}

type participationFixture struct {
	t                                                                                                *testing.T
	mu                                                                                               sync.Mutex
	server                                                                                           *httptest.Server
	reader                                                                                           *participation.HTTPReader
	wallet                                                                                           fixtureParticipationWallet
	service                                                                                          *participation.Service
	path                                                                                             string
	network                                                                                          participation.Network
	owner                                                                                            string
	nonce                                                                                            uint64
	wrongGenesis, wrongDomain, missingSummary, missingUnbond, opaque, drop, malformedResult, pending bool
	publishes, lookups, signatures                                                                   int
	results                                                                                          map[string]participation.WalletResult
	views                                                                                            map[string]map[string]any
	chainTime                                                                                        time.Time
	summaryBlock                                                                                     chan struct{}
	summaryReached                                                                                   chan struct{}
	unbondingEdit                                                                                    func(*consensus.BFTUnbondingEntry)
	delegationEdit                                                                                   func(*consensus.BFTStakeDelegation)
}

func newParticipationFixture(t *testing.T, withWallet bool) *participationFixture {
	t.Helper()
	f := &participationFixture{t: t, owner: "0x" + strings.Repeat("4", 40), nonce: 1, path: filepath.Join(t.TempDir(), "participation.json"), network: participation.Network{Genesis: strings.Repeat("a", 64), NetworkID32: strings.Repeat("b", 64), NativeChainID: "6423", CometChainID: "ynx_6423-1"}, results: map[string]participation.WalletResult{}, views: map[string]map[string]any{}, chainTime: time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)}
	_, _ = participantKey(t)
	f.server = httptest.NewServer(http.HandlerFunc(f.handler))
	t.Cleanup(f.server.Close)
	var e error
	f.reader, e = participation.NewHTTPReader(f.server.URL, f.server.URL, f.network, f.server.Client())
	if e != nil {
		t.Fatal(e)
	}
	f.wallet = fixtureParticipationWallet{f.server.URL, f.server.Client()}
	var w participation.Wallet
	if withWallet {
		w = f.wallet
	}
	f.service, e = participation.New(f.path, f.reader, w)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = f.service.Close() })
	return f
}
func (f *participationFixture) request(id string) participation.Request {
	return participation.Request{RequestID: id, Owner: f.owner, Action: participation.Delegate, Validator: "fixture-validator-A", AmountYNXT: "10", FeeCapYNXT: "1", ExpiresAt: time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339Nano)}
}
func (f *participationFixture) counts() (int, int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.publishes, f.signatures, f.lookups
}
func pJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
func (f *participationFixture) handler(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, pub := participantKey(f.t)
	switch {
	case r.URL.Path == "/node/pq-identity":
		genesis := f.network.Genesis
		if f.wrongGenesis {
			genesis = strings.Repeat("c", 64)
		}
		pJSON(w, map[string]any{"version": "ynx-pq-rpc-identity-v1", "source": "configured-comet-rpc", "identity": consensus.PQWalletIdentityView{Version: consensus.PQWalletIdentityVersion, Source: "configured-abci-bootstrap", RecordsView: "committed", HashAlgorithm: "sha256", NativeChainID: 6423, NativeGenesisHash: genesis, CometChainID: f.network.CometChainID, CometGenesisSHA256: strings.Repeat("d", 64), MigrationStateHash: strings.Repeat("e", 64), MigrationHeight: 1, InitialHeight: 2, CurrentStateHeight: 20, CurrentStateAppHash: strings.Repeat("f", 64)}})
	case r.URL.Path == "/accounts/"+f.owner+"/authorization":
		domain := f.network.NetworkID32
		if f.wrongDomain {
			domain = strings.Repeat("c", 64)
		}
		network, _ := hex.DecodeString(domain)
		policy := &ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: network, EnableAt: 1, Records: []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: f.owner, PKA: pub.PKA, PKB: pub.PKB, Revision: 1, RegisteredAt: 2, ActiveFrom: 3, LedgerNonce: 1}}}
		pJSON(w, consensus.PQWalletAccountView{Source: "comet-rpc", RecordsView: "committed", PolicyView: "next_execution", RecordsComplete: true, Owner: f.owner, NativeChainID: 6423, NetworkID: domain, CommittedHeight: 20, CommittedAppHash: strings.Repeat("f", 64), ExecutionHeight: 21, LedgerNonce: f.nonce, Enabled: true, GlobalPolicyVersion: ynxauth.PolicyVersion, Policy: policy, AuthorizationStatus: "active", PQSigningEnabled: true, CommittedAuthorizationStatus: "active", CommittedPQSigningEnabled: true})
	case r.URL.Path == "/staking/summary":
		if f.summaryBlock != nil {
			gate, reached := f.summaryBlock, f.summaryReached
			f.summaryBlock = nil
			f.mu.Unlock()
			close(reached)
			select {
			case <-gate:
			case <-r.Context().Done():
			}
			f.mu.Lock()
			if r.Context().Err() != nil {
				http.Error(w, "fixture read cancelled", 499)
				return
			}
		}
		if f.missingSummary {
			http.NotFound(w, r)
			return
		}
		pJSON(w, map[string]any{"schemaVersion": 1, "source": "ynx-consensus-abci", "failure": false, "policyVersion": 1, "version": "1", "unbondingSeconds": consensus.StakingUnbondingSeconds, "commissionBps": consensus.StakingCommissionBPS, "validators": []any{map[string]any{"address": "fixture-validator-A", "active": true}}})
	case strings.HasPrefix(r.URL.Path, "/staking/delegations/"):
		if f.missingUnbond {
			http.NotFound(w, r)
			return
		}
		history := "fixture original authorization lineage"
		if f.opaque {
			history = ""
		}
		entry := consensus.BFTStakeDelegation{ID: strings.Repeat("1", 24), Delegator: f.owner, Validator: "fixture-validator-A", AmountYNXT: 20, Status: "active", TxHash: "0x" + strings.Repeat("2", 64), AuthorizationHistory: history}
		if f.delegationEdit != nil {
			f.delegationEdit(&entry)
		}
		pJSON(w, map[string]any{"source": "ynx-consensus-abci", "failure": false, "version": 1, "delegation": entry})
	case strings.HasPrefix(r.URL.Path, "/staking/unbondings/"):
		entry := consensus.BFTUnbondingEntry{ID: strings.Repeat("3", 24), DelegationID: strings.Repeat("1", 24), Delegator: f.owner, Validator: "fixture-validator-A", AmountYNXT: 7, Status: "queued", RequestedAt: time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC), AvailableAt: time.Date(2030, 1, 8, 0, 0, 0, 0, time.UTC), BlockHeight: 20, TxHash: "0x" + strings.Repeat("2", 64)}
		if f.unbondingEdit != nil {
			f.unbondingEdit(&entry)
		}
		pJSON(w, map[string]any{"source": "ynx-consensus-abci", "failure": false, "version": 1, "unbonding": entry})
	case r.URL.Path == "/status":
		pJSON(w, map[string]any{"latestBlockTime": f.chainTime})
	case strings.HasPrefix(r.URL.Path, "/governance/proposals/"):
		pJSON(w, map[string]any{"source": "ynx-governance-authoritative-state", "version": "ynx-governance-api/v1", "asOf": time.Now().UTC().Format(time.RFC3339Nano), "data": map[string]any{"id": "fixture-proposal", "status": "voting", "input": map[string]any{"summary": "Actual registry report, not native PQ vote"}, "votingEndsAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano), "votingPower": map[string]uint64{f.owner: 9007199254740993}}})
	case r.URL.Path == "/governance/parameters":
		pJSON(w, map[string]any{"source": "ynx-governance-authoritative-state", "version": "ynx-governance-api/v1", "asOf": time.Now().UTC().Format(time.RFC3339Nano), "data": map[string]any{"parameters": []any{}}})
	case r.URL.Path == "/fixture-wallet/capabilities":
		pJSON(w, participation.WalletCapabilities{Publisher: "isolated-fixture-wallet", Network: f.network, Suite: ynxbatch.Version, Actions: []string{ynxauth.ActionStakeDelegate, ynxauth.ActionStakeUnbond, ynxauth.ActionStakeWithdraw}, PublishOriginalNativeAction: true, LookupOriginalOperation: true})
	case r.URL.Path == "/fixture-wallet/publish" && r.Method == http.MethodPost:
		f.publishes++
		var in struct {
			ID      string
			Intent  participation.Intent
			Binding participation.Binding
		}
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			http.Error(w, "invalid fixture input", 400)
			return
		}
		if old, ok := f.results[in.ID]; ok {
			pJSON(w, old)
			return
		}
		out := participation.WalletResult{OperationID: in.ID, Intent: in.Binding, State: "pending"}
		if !f.pending {
			hash, e := f.signView(in.Intent)
			if e != nil {
				http.Error(w, e.Error(), 500)
				return
			}
			out.State = "submitted"
			out.NativeHash = hash
			f.nonce++
		}
		f.results[in.ID] = out
		if f.drop {
			http.Error(w, "fixture dropped response after accepting original operation", 502)
			return
		}
		pJSON(w, out)
	case strings.HasPrefix(r.URL.Path, "/fixture-wallet/lookup/"):
		f.lookups++
		id := strings.TrimPrefix(r.URL.Path, "/fixture-wallet/lookup/")
		if v, ok := f.results[id]; ok {
			pJSON(w, v)
		} else {
			http.NotFound(w, r)
		}
	case strings.HasPrefix(r.URL.Path, "/transactions/pq/actions/originals/"):
		hash := strings.TrimPrefix(r.URL.Path, "/transactions/pq/actions/originals/")
		view, ok := f.views[hash]
		if !ok {
			w.WriteHeader(202)
			pJSON(w, map[string]any{"status": "unknown", "source": "comet-rpc", "nativeTransactionHash": hash})
			return
		}
		if f.malformedResult {
			copy := map[string]any{}
			for k, v := range view {
				copy[k] = v
			}
			copy["from"] = "0x" + strings.Repeat("5", 40)
			pJSON(w, copy)
			return
		}
		pJSON(w, view)
	default:
		http.NotFound(w, r)
	}
}
func (f *participationFixture) signView(i participation.Intent) (string, error) {
	key, _ := participantKey(f.t)
	network, _ := hex.DecodeString(i.Network.NetworkID32)
	nonce, _ := strconv.ParseUint(i.Conditions.NextNonce, 10, 64)
	fee, _ := strconv.ParseUint(i.Conditions.FeeYNXT, 10, 64)
	action := ynxauth.Action{ChainID: network, NativeChainID: 6423, Owner: i.Request.Owner, Nonce: nonce, Fee: fee, Kind: i.ActionKind, Payload: i.CanonicalPayload}
	message, e := action.SigningBytes()
	if e != nil {
		return "", e
	}
	batch, e := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: i.Request.Owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	if e != nil {
		return "", e
	}
	defer batch.Discard()
	member, e := ynxbatch.Extract(batch, 0)
	if e != nil {
		return "", e
	}
	wire, e := ynxbatch.EncodeMember(member)
	if e != nil {
		return "", e
	}
	sum := sha256.Sum256(wire)
	hash := "0x" + hex.EncodeToString(sum[:])
	f.signatures++
	f.views[hash] = map[string]any{"type": action.Kind, "status": "committed", "committed": true, "source": "comet-rpc", "nativeTransactionHash": hash, "abciTransactionHash": "0x" + strings.Repeat("8", 64), "wire": wire, "executionHeight": "21", "from": action.Owner, "fee": i.Conditions.FeeYNXT, "nonce": i.Conditions.NextNonce, "effects": map[string]any{"fixtureStaking": true}}
	return hash, nil
}

type fixtureParticipationWallet struct {
	base   string
	client *http.Client
}

func (w fixtureParticipationWallet) call(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		raw, _ := json.Marshal(in)
		body = bytes.NewReader(raw)
	}
	req, e := http.NewRequestWithContext(ctx, method, w.base+path, body)
	if e != nil {
		return e
	}
	res, e := w.client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("isolated Wallet HTTP %d", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}
func (w fixtureParticipationWallet) Capabilities(ctx context.Context) (participation.WalletCapabilities, error) {
	var v participation.WalletCapabilities
	e := w.call(ctx, http.MethodGet, "/fixture-wallet/capabilities", nil, &v)
	return v, e
}
func (w fixtureParticipationWallet) Publish(ctx context.Context, id string, i participation.Intent, b participation.Binding) (participation.WalletResult, error) {
	var v participation.WalletResult
	e := w.call(ctx, http.MethodPost, "/fixture-wallet/publish", struct {
		ID      string
		Intent  participation.Intent
		Binding participation.Binding
	}{id, i, b}, &v)
	return v, e
}
func (w fixtureParticipationWallet) Lookup(ctx context.Context, id string, b participation.Binding) (participation.WalletResult, error) {
	var v participation.WalletResult
	e := w.call(ctx, http.MethodGet, "/fixture-wallet/lookup/"+id, nil, &v)
	return v, e
}

func TestP0905ParticipationRegistryDoesNotBecomeNativeVote(t *testing.T) {
	f := newParticipationFixture(t, true)
	req := f.request("vote-1")
	req.Action = participation.Vote
	req.Validator = ""
	req.AmountYNXT = ""
	req.Proposal = "fixture-proposal"
	req.Choice = "yes"
	entry, e := f.service.Prepare(context.Background(), req)
	if !errors.Is(e, participation.ErrUnsupported) || entry.State != participation.Unsupported || entry.Intent.Conditions.SnapshotHeight != "" || entry.Intent.Conditions.ReportedVotingPower != "9007199254740993" || entry.Intent.ActionKind != "" {
		t.Fatalf("registry promoted to native: %+v %v", entry, e)
	}
	if _, e = f.service.Submit(context.Background(), entry.ID); !errors.Is(e, participation.ErrUnsupported) {
		t.Fatalf("unsupported vote published: %v", e)
	}
	if p, s, _ := f.counts(); p != 0 || s != 0 {
		t.Fatal("legacy registry vote used")
	}
	report, e := f.reader.ReadGovernanceProposal(context.Background(), req.Proposal)
	if e != nil || !bytes.Contains(report.Data, []byte("Actual registry report")) {
		t.Fatalf("original complete proposal missing: %+v %v", report, e)
	}
}
func TestP0906ParticipationWalletMissingKeepsDurableIntent(t *testing.T) {
	f := newParticipationFixture(t, false)
	entry, e := f.service.Prepare(context.Background(), f.request("missing-wallet"))
	if !errors.Is(e, participation.ErrUnsupported) || entry.ID == "" || entry.State != participation.Unsupported || entry.Intent.ActionKind != ynxauth.ActionStakeDelegate || len(entry.Intent.CanonicalPayload) == 0 {
		t.Fatalf("missing durable intent: %+v %v", entry, e)
	}
	decoded, e := ynxauth.DecodeActionPayload(entry.Intent.ActionKind, entry.Intent.CanonicalPayload)
	if e != nil || decoded.(ynxauth.StakeDelegatePayload).AmountYNXT != 10 {
		t.Fatalf("new invented payload: %+v %v", decoded, e)
	}
	if _, e = f.service.Submit(context.Background(), entry.ID); !errors.Is(e, participation.ErrUnsupported) {
		t.Fatal("missing original publisher was bypassed")
	}
	if _, ok := f.service.Get(entry.ID); !ok {
		t.Fatal("blocked intent not retained")
	}
}
func TestP0906ParticipationSameSlotConcurrentPublishOnce(t *testing.T) {
	f := newParticipationFixture(t, true)
	ctx := context.Background()
	first, e := f.service.Prepare(ctx, f.request("window-A"))
	if e != nil {
		t.Fatal(e)
	}
	second, e := f.service.Prepare(ctx, f.request("window-B"))
	if e != nil || first.ID != second.ID {
		t.Fatalf("same semantic slot split: %+v %v", second, e)
	}
	changed := f.request("window-C")
	changed.AmountYNXT = "11"
	if _, e = f.service.Prepare(ctx, changed); !errors.Is(e, participation.ErrConflict) {
		t.Fatalf("changed principal reused approval: %v", e)
	}
	var wg sync.WaitGroup
	for j := 0; j < 6; j++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = f.service.Submit(ctx, first.ID) }()
	}
	wg.Wait()
	got, ok := f.service.Get(first.ID)
	if !ok || got.State != participation.ReportedCommitted || got.Observation == nil || got.Observation.IndependentFinality {
		t.Fatalf("original authority readback missing or fake independent proof: %+v", got)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.publishes != 1 || f.signatures != 1 {
		t.Fatalf("signed/published more than once: %d/%d", f.publishes, f.signatures)
	}
}
func TestP0906ParticipationLostResponseRestartOnlyReconciles(t *testing.T) {
	f := newParticipationFixture(t, true)
	f.mu.Lock()
	f.drop = true
	f.mu.Unlock()
	ctx := context.Background()
	entry, e := f.service.Prepare(ctx, f.request("lost-1"))
	if e != nil {
		t.Fatal(e)
	}
	entry, e = f.service.Submit(ctx, entry.ID)
	if !errors.Is(e, participation.ErrUnknown) || entry.State != participation.Unknown || entry.FirstCause == "" {
		t.Fatalf("lost response fabricated outcome: %+v %v", entry, e)
	}
	if _, e = f.service.Prepare(ctx, f.request("different-request-and-ledger-nonce")); !errors.Is(e, participation.ErrUnknown) {
		t.Fatalf("new nonce bypassed unknown original: %v", e)
	}
	if e = f.service.Close(); e != nil {
		t.Fatal(e)
	}
	restored, e := participation.New(f.path, f.reader, f.wallet)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.Close()
	pending, ok := restored.Get(entry.ID)
	if !ok || pending.State != participation.Unknown || pending.FirstCause != entry.FirstCause {
		t.Fatalf("UNKNOWN/firstcause lost: %+v", pending)
	}
	read, e := restored.Reconcile(ctx, entry.ID)
	if e != nil || read.State != participation.ReportedCommitted || read.PublishAttemptedAt != entry.PublishAttemptedAt || read.FirstCause != entry.FirstCause {
		t.Fatalf("original reconciliation failed: %+v %v", read, e)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.publishes != 1 || f.signatures != 1 || f.lookups != 1 {
		t.Fatalf("reconcile resigned: publish/sign/lookup %d/%d/%d", f.publishes, f.signatures, f.lookups)
	}
}
func TestP0906ParticipationOriginalUnbondAndUnlockConditions(t *testing.T) {
	f := newParticipationFixture(t, true)
	req := f.request("unbond-1")
	req.Action = participation.Unbond
	req.Validator = ""
	req.DelegationID = strings.Repeat("1", 24)
	req.AmountYNXT = "7"
	entry, e := f.service.Prepare(context.Background(), req)
	if e != nil || entry.Intent.ActionKind != ynxauth.ActionStakeUnbond || entry.Intent.Conditions.UnbondingSeconds != "604800" {
		t.Fatalf("unbond original contract not used: %+v %v", entry, e)
	}
	decoded, e := ynxauth.DecodeActionPayload(entry.Intent.ActionKind, entry.Intent.CanonicalPayload)
	if e != nil || decoded.(ynxauth.StakeUnbondPayload).DelegationID != req.DelegationID {
		t.Fatal("unbond payload differs")
	}
	locked, e := f.reader.ReadUnbonding(context.Background(), strings.Repeat("3", 24), f.owner)
	if e != nil || locked.WithdrawAvailable {
		t.Fatalf("locked funds shown available: %+v %v", locked, e)
	}
	f.mu.Lock()
	f.chainTime = time.Date(2030, 1, 8, 0, 0, 0, 0, time.UTC)
	f.mu.Unlock()
	unlocked, e := f.reader.ReadUnbonding(context.Background(), strings.Repeat("3", 24), f.owner)
	if e != nil || !unlocked.WithdrawAvailable {
		t.Fatalf("real boundary unavailable: %+v %v", unlocked, e)
	}
}
func TestP0906ParticipationCapabilitiesAndBindingNegatives(t *testing.T) {
	for _, tc := range []struct {
		name   string
		edit   func(*participationFixture)
		unbond bool
		want   error
	}{
		{"wrong native genesis same chain id", func(f *participationFixture) { f.wrongGenesis = true }, false, participation.ErrInvalid},
		{"wrong network domain separate from genesis", func(f *participationFixture) { f.wrongDomain = true }, false, participation.ErrInvalid},
		{"staking summary absent", func(f *participationFixture) { f.missingSummary = true }, false, participation.ErrUnsupported},
		{"unbond endpoint absent", func(f *participationFixture) { f.missingUnbond = true }, true, participation.ErrUnsupported},
		{"opaque original delegation", func(f *participationFixture) { f.opaque = true }, true, participation.ErrUnsupported},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newParticipationFixture(t, true)
			f.mu.Lock()
			tc.edit(f)
			f.mu.Unlock()
			req := f.request("negative")
			if tc.unbond {
				req.Action = participation.Unbond
				req.Validator = ""
				req.DelegationID = strings.Repeat("1", 24)
			}
			_, e := f.service.Prepare(context.Background(), req)
			if !errors.Is(e, tc.want) {
				t.Fatalf("got %v want %v", e, tc.want)
			}
			if p, _, _ := f.counts(); p != 0 {
				t.Fatal("failed capability published")
			}
		})
	}
}
func TestP0906ParticipationStaleNonceAndRevocationFence(t *testing.T) {
	f := newParticipationFixture(t, true)
	ctx := context.Background()
	entry, e := f.service.Prepare(ctx, f.request("stale"))
	if e != nil {
		t.Fatal(e)
	}
	f.mu.Lock()
	f.nonce++
	f.mu.Unlock()
	if _, e = f.service.Submit(ctx, entry.ID); !errors.Is(e, participation.ErrStale) {
		t.Fatalf("changed nonce signed: %v", e)
	}
	if e = f.service.Revoke(); e != nil {
		t.Fatal(e)
	}
	got, _ := f.service.Get(entry.ID)
	if got.State != participation.Revoked {
		t.Fatalf("pending approval did not lose local authority: %+v", got)
	}
	if _, e = f.service.Prepare(ctx, f.request("after-revoke")); !errors.Is(e, participation.ErrRevoked) {
		t.Fatalf("revoked generation made new intent: %v", e)
	}
	if p, _, _ := f.counts(); p != 0 {
		t.Fatal("revoked/stale published")
	}
}
func TestP0906ParticipationMalformedResultPreservesUnknown(t *testing.T) {
	f := newParticipationFixture(t, true)
	f.mu.Lock()
	f.malformedResult = true
	f.mu.Unlock()
	entry, e := f.service.Prepare(context.Background(), f.request("malformed-result"))
	if e != nil {
		t.Fatal(e)
	}
	entry, e = f.service.Submit(context.Background(), entry.ID)
	if !errors.Is(e, participation.ErrUnknown) || entry.State != participation.Unknown || entry.WalletResult == nil || entry.WalletResult.NativeHash == "" {
		t.Fatalf("invalid readback lost original or greened: %+v %v", entry, e)
	}
	_, _ = f.service.Submit(context.Background(), entry.ID)
	if p, s, _ := f.counts(); p != 1 || s != 1 {
		t.Fatal("bad result caused resign")
	}
}

func TestP0906ParticipationRevokeDuringPreflightBlocksPublisher(t *testing.T) {
	f := newParticipationFixture(t, true)
	entry, e := f.service.Prepare(context.Background(), f.request("revoke-in-preflight"))
	if e != nil {
		t.Fatal(e)
	}
	gate, reached := make(chan struct{}), make(chan struct{})
	f.mu.Lock()
	f.summaryBlock, f.summaryReached = gate, reached
	f.mu.Unlock()
	done := make(chan error, 1)
	go func() { _, e := f.service.Submit(context.Background(), entry.ID); done <- e }()
	select {
	case <-reached:
	case <-time.After(2 * time.Second):
		close(gate)
		t.Fatal("preflight did not reach actual source")
	}
	if e = f.service.Revoke(); e != nil {
		close(gate)
		t.Fatal(e)
	}
	close(gate)
	if e = <-done; !errors.Is(e, participation.ErrRevoked) {
		t.Fatalf("old generation dispatched after preflight: %v", e)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.publishes != 0 || f.signatures != 0 {
		t.Fatal("revocation leaked new effect")
	}
}

func TestP0906ParticipationDurabilityFailureBeforePublishSealsOutbox(t *testing.T) {
	f := newParticipationFixture(t, true)
	entry, e := f.service.Prepare(context.Background(), f.request("disk-error"))
	if e != nil {
		t.Fatal(e)
	}
	if e = os.Mkdir(f.path+".tmp", 0700); e != nil {
		t.Fatal(e)
	}
	entry, e = f.service.Submit(context.Background(), entry.ID)
	if e == nil || entry.State != participation.Unknown || entry.PublishAttemptedAt == "" || entry.FirstCause == "" {
		t.Fatalf("failed durable claim faked success: %+v %v", entry, e)
	}
	if p, _, _ := f.counts(); p != 0 {
		t.Fatal("publisher called before durable outbox")
	}
	if e = f.service.Close(); e == nil {
		t.Fatal("close hid persistence failure")
	}
	if _, e = os.Stat(f.path + ".owner.lock"); e != nil {
		t.Fatal("uncertain journal ownership was released")
	}
	if other, e := participation.New(f.path, f.reader, f.wallet); e == nil {
		_ = other.Close()
		t.Fatal("failed Close released the live kernel writer")
	}
}

func TestP0906ParticipationExpiryAndStrictRequests(t *testing.T) {
	f := newParticipationFixture(t, true)
	for _, tc := range []struct {
		name string
		edit func(*participation.Request)
		want error
	}{
		{"legacy stake kind", func(r *participation.Request) { r.Action = "stake" }, participation.ErrUnsupported},
		{"zero amount", func(r *participation.Request) { r.AmountYNXT = "0" }, participation.ErrInvalid},
		{"float amount", func(r *participation.Request) { r.AmountYNXT = "1.5" }, participation.ErrInvalid},
		{"overflow amount", func(r *participation.Request) { r.AmountYNXT = "18446744073709551616" }, participation.ErrInvalid},
		{"noncanonical amount", func(r *participation.Request) { r.AmountYNXT = "010" }, participation.ErrInvalid},
		{"path target", func(r *participation.Request) { r.Validator = "../staking/stake" }, participation.ErrInvalid},
		{"expired", func(r *participation.Request) {
			r.ExpiresAt = time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)
		}, participation.ErrInvalid},
		{"extra vote fields", func(r *participation.Request) { r.Proposal = "not-this-action" }, participation.ErrInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := f.request("invalid-" + strings.ReplaceAll(tc.name, " ", "-"))
			tc.edit(&r)
			if _, e := f.service.Prepare(context.Background(), r); !errors.Is(e, tc.want) {
				t.Fatalf("got %v want %v", e, tc.want)
			}
		})
	}
	r := f.request("expires-before-publish")
	expiry := time.Now().Add(200 * time.Millisecond)
	r.ExpiresAt = expiry.UTC().Format(time.RFC3339Nano)
	entry, e := f.service.Prepare(context.Background(), r)
	if e != nil {
		t.Fatal(e)
	}
	if wait := time.Until(expiry); wait > 0 {
		time.Sleep(wait)
	}
	if _, e = f.service.Submit(context.Background(), entry.ID); !errors.Is(e, participation.ErrInvalid) {
		t.Fatalf("expired approval dispatched: %v", e)
	}
	if p, _, _ := f.counts(); p != 0 || len(f.service.List()) != 1 {
		t.Fatal("invalid request created effects or durable junk")
	}
}

func TestP0906ParticipationRevokedUnknownCanOnlyReadOriginal(t *testing.T) {
	f := newParticipationFixture(t, true)
	f.mu.Lock()
	f.pending = true
	f.mu.Unlock()
	ctx := context.Background()
	entry, e := f.service.Prepare(ctx, f.request("accepted-before-stop"))
	if e != nil {
		t.Fatal(e)
	}
	entry, e = f.service.Submit(ctx, entry.ID)
	if !errors.Is(e, participation.ErrUnknown) || entry.State != participation.AwaitingWallet {
		t.Fatalf("pending original not retained: %+v %v", entry, e)
	}
	if e = f.service.Revoke(); e != nil {
		t.Fatal(e)
	}
	// The remote fixture finishes the already accepted original operation; this
	// is not a new local Publish/sign request or an assertion of cancellation.
	f.mu.Lock()
	hash, e := f.signView(entry.Intent)
	if e == nil {
		v := f.results[entry.ID]
		v.NativeHash = hash
		v.State = "submitted"
		f.results[entry.ID] = v
	}
	f.mu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	read, e := f.service.Reconcile(ctx, entry.ID)
	if e != nil || read.State != participation.ReportedCommitted {
		t.Fatalf("old fact could not reconcile: %+v %v", read, e)
	}
	if read.Intent.Generation != "1" {
		t.Fatal("old result acquired new authority generation")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.publishes != 1 || f.signatures != 1 || f.lookups != 1 {
		t.Fatal("revoke triggered new submission")
	}
}

func runParticipationCrashChild(t *testing.T) {
	var network participation.Network
	if json.Unmarshal([]byte(os.Getenv("P09_PARTICIPATION_FIXTURE_NETWORK")), &network) != nil {
		t.Fatal("fixture network missing")
	}
	base, path, owner := os.Getenv("P09_PARTICIPATION_FIXTURE_URL"), os.Getenv("P09_PARTICIPATION_FIXTURE_PATH"), os.Getenv("P09_PARTICIPATION_FIXTURE_OWNER")
	reader, e := participation.NewHTTPReader(base, base, network, http.DefaultClient)
	if e != nil {
		t.Fatal(e)
	}
	service, e := participation.New(path, reader, fixtureParticipationWallet{base, http.DefaultClient})
	if e != nil {
		t.Fatal(e)
	}
	request := participation.Request{RequestID: "isolated-crash-original", Owner: owner, Action: participation.Delegate, Validator: "fixture-validator-A", AmountYNXT: "10", FeeCapYNXT: "1", ExpiresAt: time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339Nano)}
	entry, e := service.Prepare(context.Background(), request)
	if e != nil {
		t.Fatal(e)
	}
	entry, e = service.Submit(context.Background(), entry.ID)
	if !errors.Is(e, participation.ErrUnknown) {
		t.Fatalf("expected original response-loss fixture: %+v %v", entry, e)
	}
	fmt.Println("P09_CRASH_READY " + entry.ID)
	// The parent kills only this self-spawned fixture test process. No node,
	// signer daemon, public network or arbitrary PID is involved.
	select {}
}

func TestP0906ParticipationKernelLockCrashAndLegacyRecovery(t *testing.T) {
	if os.Getenv("YNX_P09_PARTICIPATION_CRASH_CHILD") == "1" {
		runParticipationCrashChild(t)
		return
	}
	f := newParticipationFixture(t, true)
	f.mu.Lock()
	f.drop = true
	f.mu.Unlock()
	path := filepath.Join(t.TempDir(), "crash-outbox.json")
	executable, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	cmd := exec.Command(executable, "-test.run=^TestP0906ParticipationKernelLockCrashAndLegacyRecovery$", "-test.v")
	network, _ := json.Marshal(f.network)
	cmd.Env = append(os.Environ(), "YNX_P09_PARTICIPATION_CRASH_CHILD=1", "P09_PARTICIPATION_FIXTURE_URL="+f.server.URL, "P09_PARTICIPATION_FIXTURE_PATH="+path, "P09_PARTICIPATION_FIXTURE_OWNER="+f.owner, "P09_PARTICIPATION_FIXTURE_NETWORK="+string(network))
	stdout, e := cmd.StdoutPipe()
	if e != nil {
		t.Fatal(e)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if e = cmd.Start(); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	})
	ready := make(chan string, 1)
	go func() {
		scan := bufio.NewScanner(stdout)
		for scan.Scan() {
			line := scan.Text()
			if strings.HasPrefix(line, "P09_CRASH_READY ") {
				ready <- strings.TrimPrefix(line, "P09_CRASH_READY ")
				return
			}
		}
		ready <- ""
	}()
	var id string
	select {
	case id = <-ready:
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatalf("crash fixture not ready: %s", stderr.String())
	}
	if id == "" {
		t.Fatalf("fixture exited without durable original: %s", stderr.String())
	}
	if live, e := participation.New(path, f.reader, f.wallet); e == nil {
		_ = live.Close()
		t.Fatal("second live writer acquired same journal")
	}
	if e = cmd.Process.Kill(); e != nil {
		t.Fatal(e)
	}
	_ = cmd.Wait()
	cmd.Process = nil
	restored, e := participation.New(path, f.reader, f.wallet)
	if e != nil {
		t.Fatalf("dead known kernel owner blocked normal restart: %v", e)
	}
	defer restored.Close()
	original, ok := restored.Get(id)
	if !ok || original.State != participation.Unknown || original.FirstCause == "" {
		t.Fatalf("crash lost UNKNOWN/firstcause: %+v", original)
	}
	reconciled, e := restored.Reconcile(context.Background(), id)
	if e != nil || reconciled.State != participation.ReportedCommitted {
		t.Fatalf("crash could not read original: %+v %v", reconciled, e)
	}
	if p, s, l := f.counts(); p != 1 || s != 1 || l != 1 {
		t.Fatalf("crash replayed effects: %d/%d/%d", p, s, l)
	}
	legacy := filepath.Join(t.TempDir(), "legacy.json")
	if e = os.Mkdir(legacy+".owner", 0700); e != nil {
		t.Fatal(e)
	}
	if service, e := participation.New(legacy, f.reader, f.wallet); e == nil {
		_ = service.Close()
		t.Fatal("legacy owner silently adopted")
	}
	if stat, e := os.Stat(legacy + ".owner"); e != nil || !stat.IsDir() {
		t.Fatal("legacy owner removed")
	}
}

func TestP0906ParticipationNormalCloseRenewsMetadataButExplicitRevokeStays(t *testing.T) {
	f := newParticipationFixture(t, true)
	ctx := context.Background()
	old, e := f.service.Prepare(ctx, f.request("old-session"))
	if e != nil {
		t.Fatal(e)
	}
	if e = f.service.Close(); e != nil {
		t.Fatal(e)
	}
	next, e := participation.New(f.path, f.reader, f.wallet)
	if e != nil {
		t.Fatal(e)
	}
	previous, ok := next.Get(old.ID)
	if !ok || previous.State != participation.Revoked || previous.Intent.Generation != old.Intent.Generation {
		t.Fatalf("old prepared authority revived or disappeared: %+v", previous)
	}
	fresh, e := next.Prepare(ctx, f.request("fresh-normal-session"))
	if e != nil || fresh.ID == old.ID || fresh.Intent.Generation == old.Intent.Generation {
		t.Fatalf("normal restart permanently blocked metadata: %+v %v", fresh, e)
	}
	if e = next.Revoke(); e != nil {
		t.Fatal(e)
	}
	if e = next.Close(); e != nil {
		t.Fatal(e)
	}
	revoked, e := participation.New(f.path, f.reader, f.wallet)
	if e != nil {
		t.Fatal(e)
	}
	defer revoked.Close()
	if _, e = revoked.Prepare(ctx, f.request("must-remain-explicitly-revoked")); !errors.Is(e, participation.ErrRevoked) {
		t.Fatalf("restart cleared explicit revoke: %v", e)
	}
	if p, s, _ := f.counts(); p != 0 || s != 0 {
		t.Fatal("metadata renewal gained asset authority")
	}
}

func TestP0906ParticipationV1ProjectionMigrationPreservesRevokedUnknown(t *testing.T) {
	f := newParticipationFixture(t, true)
	f.mu.Lock()
	f.drop = true
	f.mu.Unlock()
	ctx := context.Background()
	entry, e := f.service.Prepare(ctx, f.request("v1-original"))
	if e != nil {
		t.Fatal(e)
	}
	entry, e = f.service.Submit(ctx, entry.ID)
	if !errors.Is(e, participation.ErrUnknown) {
		t.Fatal(e)
	}
	if e = f.service.Revoke(); e != nil {
		t.Fatal(e)
	}
	if e = f.service.Close(); e != nil {
		t.Fatal(e)
	}
	var old struct {
		Version    int                            `json:"version"`
		Generation uint64                         `json:"generation"`
		Stopped    bool                           `json:"stopped"`
		Entries    map[string]participation.Entry `json:"entries"`
		Slots      map[string]string              `json:"slots"`
		Requests   map[string]string              `json:"requests"`
	}
	if _, e = productstore.Load(f.path, &old); e != nil {
		t.Fatal(e)
	}
	// This frozen legacy descriptor deliberately excludes generation. The new
	// index must migrate it without changing any original operation or intent.
	c := entry.Intent.Conditions
	legacyCritical := struct {
		Network                                                                                               participation.Network
		Owner, Action, Policy, Nonce, Fee, Validator, Object, Available, Wait, Commission, Proposal, Snapshot string
		ProposalBinding                                                                                       participation.Binding
	}{c.Network, c.Owner, c.Action, c.PolicyRevision, c.NextNonce, c.FeeYNXT, c.Validator, c.ObjectVersion, c.AvailableYNXT, c.UnbondingSeconds, c.CommissionBPS, c.Proposal, c.SnapshotHeight, c.ProposalBinding}
	raw, _ := json.Marshal(struct {
		Guard    string
		Critical any
	}{entry.Guard, legacyCritical})
	sum := sha512.Sum512(raw)
	legacySlot := hex.EncodeToString(sum[:])
	old.Version = 1
	old.Slots = map[string]string{legacySlot: entry.ID}
	v := old.Entries[entry.ID]
	v.Slot = legacySlot
	old.Entries[entry.ID] = v
	if e = productstore.Save(f.path, old); e != nil {
		t.Fatal(e)
	}
	restored, e := participation.New(f.path, f.reader, f.wallet)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.Close()
	got, ok := restored.Get(entry.ID)
	if !ok || got.State != participation.Unknown || got.Binding != entry.Binding || got.BusinessBinding != entry.BusinessBinding || got.Intent.Generation != entry.Intent.Generation || got.PublishAttemptedAt != entry.PublishAttemptedAt || got.FirstCause != entry.FirstCause || got.Slot == legacySlot {
		t.Fatalf("migration changed original outbox or failed index migration: %+v", got)
	}
	if _, e = restored.Prepare(ctx, f.request("revoke-not-cleared-by-migration")); !errors.Is(e, participation.ErrRevoked) {
		t.Fatalf("migration cleared explicit revoke: %v", e)
	}
	read, e := restored.Reconcile(ctx, entry.ID)
	if e != nil || read.State != participation.ReportedCommitted {
		t.Fatalf("migrated original cannot reconcile: %+v %v", read, e)
	}
	if p, s, l := f.counts(); p != 1 || s != 1 || l != 1 {
		t.Fatalf("migration replayed original: %d/%d/%d", p, s, l)
	}
}
