package bftgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// The shared transport substitutes only Comet HTTP/index responses. Every
// authorization, seven-day boundary, state transition, query and cold load is
// performed by the actual Application. This is not a Node.Start/finality test.
func TestGatewayPQStakingLifecycleOriginalsAndColdRecovery(t *testing.T) {
	f, statePath, classic := newGatewayMigrationFixture(t)
	commitGatewayRevocationBlock(t, f, 2, f.payload)
	m := newPQMock(t, f)
	m.timedBlocks = map[uint64]pqMockTimedBlock{}
	upstream := httptest.NewServer(http.HandlerFunc(m.serve))
	t.Cleanup(upstream.Close)
	g, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(g.Handler())
	t.Cleanup(server.Close)
	readState := func() []byte {
		t.Helper()
		data, err := os.ReadFile(statePath)
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	validator := f.migration.Validators[0].Address
	feeRecipient := ""
	for _, v := range f.migration.Validators {
		if v.Active {
			feeRecipient = v.Address
			break
		}
	}
	// A genuine old owner signature cannot replace PQ after activation.
	legacy, err := consensus.NewSignedApplicationAction(classic, f.migration.Network.ChainID, consensus.ActionStakeDelegate, consensus.StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 2)
	if err != nil {
		t.Fatal(err)
	}
	legacyRaw, err := consensus.EncodeSignedApplicationAction(legacy)
	if err != nil {
		t.Fatal(err)
	}
	beforeLegacy := readState()
	check, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: legacyRaw})
	if err != nil || check.Code == 0 || !bytes.Equal(beforeLegacy, readState()) {
		t.Fatalf("migrated owner classic staking was accepted or changed disk: %+v %v", check, err)
	}
	setAt := func(height uint64, at time.Time, wire []byte) {
		t.Helper()
		setGatewayAction(t, m, wire, nil, height)
		m.mu.Lock()
		m.blockTime = at
		m.mu.Unlock()
	}
	assertIdentity := func(v PQActionView, wire, raw []byte, kind string, nonce, height uint64) {
		t.Helper()
		if !v.Committed || v.Status != "committed" || v.Source != "comet-rpc" || v.Type != kind || v.From != f.owner || v.NativeTransactionHash != consensus.SignedTransactionHash(wire) || v.ABCITransactionHash != consensus.SignedTransactionHash(raw) || v.NativeTransactionHash == v.ABCITransactionHash || !bytes.Equal(v.Wire, wire) || !bytes.Equal(v.Transport, raw) || v.Fee != 1 || v.Nonce != nonce || v.ExecutionHeight != height || v.CometIndex == nil || *v.CometIndex != 0 {
			t.Fatalf("staking original identity/fee/nonce/height mismatch: %+v", v)
		}
	}
	var originals []PQActionView
	execute := func(kind string, payload any, nonce, height uint64, at time.Time, balanceChange, stakeChange int64) PQActionView {
		t.Helper()
		before := queryPQGatewayAccount(t, f.a, f.owner)
		feeBefore := queryPQGatewayAccount(t, f.a, feeRecipient)
		wire := gatewayActionWire(t, f, kind, payload, nonce, 1, 2)
		setAt(height, at, wire)
		status, v := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/octet-stream", wire)
		if status != http.StatusOK {
			t.Fatalf("actual %s HTTP execution: %d %+v", kind, status, v)
		}
		assertIdentity(v, wire, f.payload, kind, nonce, height)
		member, err := ynxbatch.DecodeMember(v.Wire)
		if err != nil || member.Certificate.N != 2 || member.Index != 1 {
			t.Fatal("staking gateway rewrote full non-N1 Member")
		}
		history, tx := actionQuery(t, f, v.NativeTransactionHash)
		if history.ExecutionHeight != height || history.Authorization.CommittedHeight != int64(height) || history.Authorization.ExecutionHeight != height+1 || history.Authorization.Owner != f.owner || !tx.Timestamp.Equal(at) || tx.Fee != 1 || tx.Nonce != nonce {
			t.Fatal("staking query substituted current/execute height, policy or time")
		}
		after, feeAfter := queryPQGatewayAccount(t, f.a, f.owner), queryPQGatewayAccount(t, f.a, feeRecipient)
		if after.Balance != before.Balance+balanceChange-1 || after.Staked != before.Staked+stakeChange || after.Nonce != nonce || after.ResourceUsage.BandwidthUsed != before.ResourceUsage.BandwidthUsed+1 || after.ResourceUsage.ComputeUsed != before.ResourceUsage.ComputeUsed || feeAfter.Balance != feeBefore.Balance+1 || feeAfter.Nonce != feeBefore.Nonce {
			t.Fatalf("staking exact business or fee effects changed: before=%+v after=%+v", before, after)
		}
		var moved int64
		for _, flow := range tx.LotFlows {
			if flow.From != f.owner || flow.To != feeRecipient || flow.Amount <= 0 || before.Lots[flow.LotID]-after.Lots[flow.LotID] != flow.Amount || feeAfter.Lots[flow.LotID]-feeBefore.Lots[flow.LotID] != flow.Amount {
				t.Fatal("staking fee flow differs from actual owner/recipient lots")
			}
			moved += flow.Amount
		}
		if moved != 1 {
			t.Fatal("staking fee flow is not exactly one")
		}
		for _, route := range []string{v.ReadbackURL, v.ABCIReadbackURL} {
			code, read := actionHTTP(t, server.URL+route, "", nil)
			if code != http.StatusOK || !reflect.DeepEqual(read, v) {
				t.Fatalf("staking original HTTP readback differs: %d %+v", code, read)
			}
		}
		originals = append(originals, v)
		return v
	}
	start := time.Date(2030, 1, 1, 0, 0, 3, 0, time.UTC)
	execute(ynxauth.ActionStakeDelegate, ynxauth.StakeDelegatePayload{Validator: validator, AmountYNXT: 20}, 2, 3, start, -20, 20)
	id := consensus.StakingDelegationID(f.owner, validator)
	unbondAt := start.Add(time.Second)
	unbond := execute(ynxauth.ActionStakeUnbond, ynxauth.StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, 3, 4, unbondAt, 0, -7)
	unbondID := consensus.ApplicationActionRecordID("stake-unbonding", unbond.ABCITransactionHash)
	available := unbondAt.Add(time.Duration(consensus.StakingUnbondingSeconds) * time.Second)
	beforeEarly := queryPQGatewayAccount(t, f.a, f.owner)
	beforeFee := queryPQGatewayAccount(t, f.a, feeRecipient)
	beforeHistory, _ := actionQuery(t, f, unbond.NativeTransactionHash)
	earlyWire := gatewayActionWire(t, f, ynxauth.ActionStakeWithdraw, ynxauth.StakeWithdrawPayload{UnbondingID: unbondID}, 4, 1, 1)
	setAt(5, available.Add(-time.Nanosecond), earlyWire)
	code, early := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/octet-stream", earlyWire)
	if code != http.StatusUnprocessableEntity || early.Status != "rejected" || early.Committed || early.ExecutionHeight != 5 || !strings.Contains(early.Error, "not yet available") {
		t.Fatalf("seven-day early withdrawal was not terminally rejected: %d %+v", code, early)
	}
	afterHistory, _ := actionQuery(t, f, unbond.NativeTransactionHash)
	if !reflect.DeepEqual(beforeEarly, queryPQGatewayAccount(t, f.a, f.owner)) || !reflect.DeepEqual(beforeFee, queryPQGatewayAccount(t, f.a, feeRecipient)) || !bytes.Equal(beforeHistory.History, afterHistory.History) || !bytes.Equal(beforeHistory.Effects, afterHistory.Effects) {
		t.Fatal("failed withdrawal consumed nonce, fee, balance or original effects")
	}
	// This is a new, explicitly signed N2 Member after a known terminal failure,
	// not an automatic retry of an UNKNOWN write or replacement of its receipt.
	withdraw := execute(ynxauth.ActionStakeWithdraw, ynxauth.StakeWithdrawPayload{UnbondingID: unbondID}, 4, 6, available, 7, 0)
	if withdraw.NativeTransactionHash == early.NativeTransactionHash || withdraw.ABCITransactionHash == early.ABCITransactionHash {
		t.Fatal("new withdrawal overwrote original terminal rejection identity")
	}
	code, retained := actionHTTP(t, server.URL+early.ABCIReadbackURL, "", nil)
	if code != http.StatusOK || !reflect.DeepEqual(retained, early) {
		t.Fatal("successful later withdrawal erased original rejected transaction")
	}
	// Query effects contain current, fully replayed delegation history. Refresh
	// them at H6 before comparing cold H6; original tx identity remains H3/H4/H6.
	for i, original := range originals {
		code, current := actionHTTP(t, server.URL+original.ReadbackURL, "", nil)
		if code != http.StatusOK {
			t.Fatal("original staking query failed after later lawful mutation")
		}
		assertIdentity(current, original.Wire, original.Transport, original.Type, original.Nonce, original.ExecutionHeight)
		originals[i] = current
	}
	beforeCold := readState()
	ownerBeforeCold := queryPQGatewayAccount(t, f.a, f.owner)
	feeBeforeCold := queryPQGatewayAccount(t, f.a, feeRecipient)
	if ownerBeforeCold.Balance != 83 || ownerBeforeCold.Staked != 13 || ownerBeforeCold.Nonce != 4 {
		t.Fatalf("staking lifecycle final ledger differs: %+v", ownerBeforeCold)
	}
	cold, err := consensus.NewPersistentApplication(f.migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	f.a = cold
	m.mu.Unlock()
	if !bytes.Equal(beforeCold, readState()) || !reflect.DeepEqual(ownerBeforeCold, queryPQGatewayAccount(t, cold, f.owner)) || !reflect.DeepEqual(feeBeforeCold, queryPQGatewayAccount(t, cold, feeRecipient)) {
		t.Fatal("cold application loader rewrote staking ledger or persisted state")
	}
	for _, original := range originals {
		for _, route := range []string{original.ReadbackURL, original.ABCIReadbackURL} {
			code, restored := actionHTTP(t, server.URL+route, "", nil)
			if code != http.StatusOK || !reflect.DeepEqual(restored, original) {
				t.Fatalf("cold staking original binding changed: %d %+v", code, restored)
			}
		}
	}
	// The shared test clock retains actual committed timestamps by requested H.
	for height, at := range map[uint64]time.Time{3: start, 4: unbondAt, 5: available.Add(-time.Nanosecond), 6: available} {
		var block cometBlock
		getJSON(t, upstream.URL+"/block?height="+strconv.FormatUint(height, 10), &block)
		if block.Result.Block.Header.Height != strconv.FormatUint(height, 10) || !block.Result.Block.Header.Time.Equal(at) {
			t.Fatal("test transport changed an earlier committed block's time")
		}
	}
	posts := m.posts
	for _, mutate := range []func(string, []byte) []byte{
		func(path string, data []byte) []byte {
			if strings.HasPrefix(path, consensus.PQActionHistoryPath) {
				var h consensus.PQActionHistoryView
				_ = json.Unmarshal(data, &h)
				h.Authorization.Owner = f.recipient
				data, _ = json.Marshal(h)
			}
			return data
		},
		func(path string, data []byte) []byte {
			if strings.HasPrefix(path, consensus.PQActionHistoryPath) {
				var h consensus.PQActionHistoryView
				_ = json.Unmarshal(data, &h)
				var tx chain.Transaction
				_ = json.Unmarshal(h.History, &tx)
				tx.Fee++
				h.History, _ = json.Marshal(tx)
				data, _ = json.Marshal(h)
			}
			return data
		},
	} {
		m.mu.Lock()
		m.queryMutation = mutate
		m.mu.Unlock()
		code, rejected := actionHTTP(t, server.URL+withdraw.ReadbackURL, "", nil)
		if code != http.StatusAccepted || rejected.Committed || m.posts != posts {
			t.Fatal("staking readback trusted wrong owner/fee or replayed write")
		}
	}
	m.mu.Lock()
	m.queryMutation = nil
	m.lookupMutation = func(tx *cometTx) { tx.Hash = strings.Repeat("f", 64) }
	m.mu.Unlock()
	code, rejected := actionHTTP(t, server.URL+withdraw.ABCIReadbackURL, "", nil)
	if code != http.StatusAccepted || rejected.Committed || m.posts != posts || !bytes.Equal(beforeCold, readState()) {
		t.Fatal("staking wrong ABCI identity authorized readback or mutated state")
	}
	m.mu.Lock()
	m.lookupMutation = nil
	m.mu.Unlock()
	if posts != 4 {
		t.Fatalf("expected exactly three successful writes and one known early rejection, got %d", posts)
	}
}
