package bftgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func gatewayActionWire(t *testing.T, f *pqGatewayFixture, kind string, p any, nonce, fee uint64, n int) []byte {
	t.Helper()
	body, err := ynxauth.EncodeActionPayload(kind, p)
	if err != nil {
		t.Fatal(err)
	}
	action := ynxauth.Action{ChainID: f.network, NativeChainID: uint64(f.migration.Network.ChainID), Owner: f.owner, Kind: kind, Payload: body, Nonce: nonce, Fee: fee}
	messages := make([][]byte, n)
	for i := range messages {
		a := action
		if i != n-1 {
			a.Nonce += uint64(i + 100)
		}
		messages[i], err = a.SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
	}
	batch, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, err := ynxbatch.Extract(batch, uint32(n-1))
	if err != nil {
		t.Fatal(err)
	}
	wire, err := ynxbatch.EncodeMember(member)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func setGatewayAction(t *testing.T, m *pqMockComet, wire, raw []byte, height uint64) {
	t.Helper()
	if raw == nil {
		_, payload, _, err := decodeIngressPQAction(wire, "application/octet-stream")
		if err != nil {
			t.Fatal(err)
		}
		raw = payload
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.f.wire, m.f.payload, m.height = bytes.Clone(wire), bytes.Clone(raw), height
}

func actionHTTP(t *testing.T, endpoint, contentType string, body []byte) (int, PQActionView) {
	t.Helper()
	var response *http.Response
	var err error
	if body == nil {
		response, err = http.Get(endpoint)
	} else {
		response, err = http.Post(endpoint, contentType, bytes.NewReader(body))
	}
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var v PQActionView
	if err := json.NewDecoder(response.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	if response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("action original response is cacheable")
	}
	return response.StatusCode, v
}

func actionQuery(t *testing.T, f *pqGatewayFixture, native string) (consensus.PQActionHistoryView, chain.Transaction) {
	t.Helper()
	r, err := f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: consensus.PQActionHistoryPath + native})
	var v consensus.PQActionHistoryView
	if err != nil || r.Code != 0 || json.Unmarshal(r.Value, &v) != nil {
		t.Fatalf("actual action query: %+v %v", r, err)
	}
	tx, _, err := consensus.ValidatePQActionHistoryView(v, r.Height)
	if err != nil {
		t.Fatal(err)
	}
	return v, tx
}

func gatewayActionMaterial(t *testing.T) (string, chain.ConsensusContractMaterial, ynxauth.ContractDeployPayload) {
	t.Helper()
	name := ynxauth.ContractCounterName
	rel := filepath.Join("contracts", "devtools", name+".sol")
	source, err := os.ReadFile(filepath.Join("..", "..", rel))
	if err != nil {
		t.Fatal(err)
	}
	artifact, err := os.ReadFile(filepath.Join("..", "..", "artifacts", rel, name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var a struct {
		BuildInfoID      string `json:"buildInfoId"`
		DeployedBytecode string `json:"deployedBytecode"`
	}
	if err = json.Unmarshal(artifact, &a); err != nil {
		t.Fatal(err)
	}
	build, err := os.ReadFile(filepath.Join("..", "..", "artifacts", "build-info", a.BuildInfoID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	trimmed := strings.TrimSpace(string(source))
	sourceHash, codeHash, err := chain.ValidateBoundedPinnedContract(name, trimmed, a.DeployedBytecode)
	if err != nil {
		t.Fatal(err)
	}
	return trimmed, chain.ConsensusContractMaterial{ArtifactFile: artifact, BuildInfoFile: build}, ynxauth.ContractDeployPayload{Name: name, SourceHash: sourceHash, DeployedBytecodeHash: codeHash, CompilerConfigHash: chain.SolidityCompilerConfig().ConfigHash, ConstructorArgs: []uint64{7}}
}

func TestGatewayPQActionAllThirteenKindsOriginalsFeesAndRestart(t *testing.T) {
	f := newPQGatewayFixture(t)
	statePath := filepath.Join(t.TempDir(), "action-state.json")
	var err error
	f.a, err = consensus.NewPersistentApplication(f.migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	height, nonce := uint64(3), uint64(2)
	feeRecipient := ""
	for _, v := range f.migration.Validators {
		if v.Active {
			feeRecipient = v.Address
			break
		}
	}
	seen := map[string]bool{}
	var originals []PQActionView
	execute := func(kind string, payload any, fee uint64, n int, source string, material *chain.ConsensusContractMaterial) PQActionView {
		t.Helper()
		before := queryPQGatewayAccount(t, f.a, f.owner)
		feeBefore := queryPQGatewayAccount(t, f.a, feeRecipient)
		wire := gatewayActionWire(t, f, kind, payload, nonce, fee, n)
		body, contentType := wire, "application/octet-stream"
		var raw []byte
		if material != nil {
			raw, err = consensus.EncodePQContractTransaction(wire, source, material)
			if err != nil {
				t.Fatal(err)
			}
			body, contentType = raw, "application/json"
		}
		setGatewayAction(t, m, wire, raw, height)
		code, v := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", contentType, body)
		if code != http.StatusOK || !v.Committed || v.Status != "committed" || v.Source != "comet-rpc" || v.Type != kind || v.NativeTransactionHash != consensus.SignedTransactionHash(wire) || v.ABCITransactionHash != consensus.SignedTransactionHash(f.payload) || v.NativeTransactionHash == v.ABCITransactionHash || !bytes.Equal(v.Wire, wire) || !bytes.Equal(v.Transport, f.payload) || v.ExecutionHeight != height || v.Nonce != nonce || v.Fee != fee {
			t.Fatalf("%s real execution: %d %+v", kind, code, v)
		}
		for _, route := range []string{v.ReadbackURL, v.ABCIReadbackURL} {
			status, read := actionHTTP(t, server.URL+route, "", nil)
			if status != http.StatusOK || !reflect.DeepEqual(read, v) {
				t.Fatalf("%s original GET changed complete result: %d %+v", kind, status, read)
			}
		}
		history, tx := actionQuery(t, f, v.NativeTransactionHash)
		after, feeAfter := queryPQGatewayAccount(t, f.a, f.owner), queryPQGatewayAccount(t, f.a, feeRecipient)
		if after.Nonce != nonce || tx.Nonce != nonce || tx.Fee != int64(fee) || tx.BlockNum != height {
			t.Fatal("action did not consume exact ledger nonce, fee and height")
		}
		if fee > 0 {
			var effects struct {
				DEX *struct {
					Event consensus.BFTDexEvent `json:"event"`
				} `json:"dex"`
			}
			if err := json.Unmarshal(history.Effects, &effects); err != nil {
				t.Fatal(err)
			}
			flows := append([]chain.LotFlow(nil), tx.LotFlows...)
			if effects.DEX != nil {
				flows = append(flows, effects.DEX.Event.NativeFlows...)
			}
			for _, pair := range [][2]chain.ConsensusAccount{{before, after}, {feeBefore, feeAfter}} {
				prior, current := pair[0], pair[1]
				expectedBalance := prior.Balance
				expectedLots := map[string]int64{}
				for id, amount := range prior.Lots {
					expectedLots[id] = amount
				}
				for _, flow := range flows {
					if flow.From == prior.Address {
						expectedBalance -= flow.Amount
						expectedLots[flow.LotID] -= flow.Amount
					}
					if flow.To == prior.Address {
						expectedBalance += flow.Amount
						expectedLots[flow.LotID] += flow.Amount
					}
				}
				if current.Balance != expectedBalance || !reflect.DeepEqual(current.Lots, expectedLots) {
					t.Fatalf("%s lost exact native balance/fee/lot movement", kind)
				}
			}
			if after.ResourceUsage.BandwidthUsed != before.ResourceUsage.BandwidthUsed+1 {
				t.Fatal("action omitted or duplicated bandwidth charge")
			}
		} else if !reflect.DeepEqual(before.Lots, after.Lots) || !reflect.DeepEqual(feeBefore, feeAfter) {
			t.Fatal("fee-zero action acquired fee or lot movements")
		}
		seen[kind], originals = true, append(originals, v)
		height++
		nonce++
		return v
	}
	beforeStake := queryPQGatewayAccount(t, f.a, f.owner)
	stake := execute(ynxauth.ActionStake, ynxauth.StakePayload{Amount: 2}, 0, 4, "", nil)
	member, err := ynxbatch.DecodeMember(stake.Wire)
	if err != nil || member.Certificate.N != 4 || member.Index != 3 {
		t.Fatal("legal non-N1 action Member was rewritten")
	}
	afterStake := queryPQGatewayAccount(t, f.a, f.owner)
	if afterStake.Balance != beforeStake.Balance-2 || afterStake.Staked != beforeStake.Staked+2 || afterStake.ResourceUsage.ComputeUsed != beforeStake.ResourceUsage.ComputeUsed+1 {
		t.Fatal("stake accounting changed")
	}
	delegation := ynxauth.ResourceDelegationPayload{Provider: f.owner, Beneficiary: f.owner, AmountYNXT: 5, PolicyHash: f.migration.ResourcePolicy.PolicyHash, IdempotencyKey: "gateway-provider"}
	delegation.RequestHash = consensus.ResourceDelegationRequestHash(delegation.Provider, delegation.Beneficiary, 5, delegation.PolicyHash, delegation.IdempotencyKey)
	execute(ynxauth.ActionResourceDelegate, delegation, 0, 1, "", nil)
	expires := time.Unix(int64(height), 0).UTC().Add(time.Minute)
	quote, err := chain.ResourceQuoteForPolicy(f.migration.ResourcePolicy, f.owner, 2, 1, 0, 0, expires)
	if err != nil {
		t.Fatal(err)
	}
	rental := ynxauth.ResourceRentalPayload{Address: f.owner, Provider: f.owner, Bandwidth: 2, Compute: 1, QuoteID: quote.ID, QuoteExpiresAt: expires.Format(time.RFC3339Nano), PolicyHash: f.migration.ResourcePolicy.PolicyHash, MaxPriceYNXT: uint64(quote.PriceYNXT), IdempotencyKey: "gateway-rent"}
	rental.RequestHash = consensus.ResourceRentalRequestHash(rental.Address, rental.Provider, 2, 1, 0, 0, rental.QuoteID, expires, rental.PolicyHash, int64(rental.MaxPriceYNXT), rental.IdempotencyKey)
	execute(ynxauth.ActionResourceRent, rental, 0, 1, "", nil)
	deadline := uint64(time.Date(2031, 1, 1, 0, 0, 0, 0, time.UTC).Unix())
	for _, step := range []struct {
		kind    string
		payload any
	}{
		{ynxauth.ActionDexAssetCreate, ynxauth.DexAssetCreatePayload{AssetID: "gateway-token", Symbol: "GWT", Name: "Gateway PQ Token", Decimals: 6, MaxSupply: 100000, InitialSupply: 50000}},
		{ynxauth.ActionDexAssetMint, ynxauth.DexAssetAmountPayload{AssetID: "gateway-token", Amount: 1000}},
		{ynxauth.ActionDexAssetTransfer, ynxauth.DexAssetTransferPayload{AssetID: "gateway-token", Recipient: f.recipient, Amount: 1000}},
		{ynxauth.ActionDexPoolCreate, ynxauth.DexPoolCreatePayload{PoolID: "dex_gateway_pq", Asset0: consensus.DexNativeAssetID, Asset1: "gateway-token", FeeBps: 30}},
		{ynxauth.ActionDexLiquidityAdd, ynxauth.DexLiquidityPayload{PoolID: "dex_gateway_pq", Amount0: 20, Amount1: 2000, MinShares: 200, DeadlineUnix: deadline}},
		{ynxauth.ActionDexSwapExactInput, ynxauth.DexSwapExactInputPayload{PoolID: "dex_gateway_pq", AssetIn: "gateway-token", AmountIn: 500, MinAmountOut: 1, DeadlineUnix: deadline}},
		{ynxauth.ActionDexSwapExactOutput, ynxauth.DexSwapExactOutputPayload{PoolID: "dex_gateway_pq", AssetOut: "gateway-token", AmountOut: 100, MaxAmountIn: 10, DeadlineUnix: deadline}},
		{ynxauth.ActionDexLiquidityRemove, ynxauth.DexLiquidityRemovePayload{PoolID: "dex_gateway_pq", Shares: 20, MinAmount0: 1, MinAmount1: 1, DeadlineUnix: deadline}},
	} {
		execute(step.kind, step.payload, 1, 1, "", nil)
	}
	source, material, deployment := gatewayActionMaterial(t)
	deployed := execute(ynxauth.ActionContractDeploy, deployment, ynxauth.ContractDeployFee, 1, source, &material)
	artifact, err := f.a.PQContractArtifact(deployed.To)
	if err != nil {
		t.Fatal(err)
	}
	commitment, err := chain.ContractExecutionStateCommitment(artifact)
	if err != nil {
		t.Fatal(err)
	}
	call := ynxauth.ContractExecutePayload{Name: artifact.Name, Target: artifact.Address, SourceHash: artifact.SourceHash, DeployedBytecodeHash: artifact.DeployedBytecodeHash, CompilerConfigHash: artifact.CompilerConfigHash, ExpectedStorageCommitment: commitment, Calldata: "0x7cf5dab0" + fmt.Sprintf("%064x", 4)}
	execute(ynxauth.ActionContractExecute, call, ynxauth.ContractExecuteFee, 1, "", nil)
	if len(seen) != 13 || m.posts != 13 {
		t.Fatalf("not all 13 real action kinds executed once: %v posts=%d", seen, m.posts)
	}
	policy := gatewayRevocationPolicy(t, f, f.owner)
	record := policy.Policy.Records[0]
	revoke := signGatewayRevocation(t, f.key, ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: record.PKA, PKB: record.PKB, AuthorizingRevision: 1, ThroughRevision: 1, LedgerNonce: nonce, ExecuteAt: height, RevokeAt: height + 1})
	raw, err := consensus.EncodePQTransaction(consensus.PQRevocationType, revoke)
	if err != nil {
		t.Fatal(err)
	}
	commitGatewayRevocationBlock(t, f, int64(height), raw)
	cold, err := consensus.NewPersistentApplication(f.migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	f.a = cold
	m.mu.Unlock()
	for _, original := range originals {
		for _, route := range []string{original.ReadbackURL, original.ABCIReadbackURL} {
			status, v := actionHTTP(t, server.URL+route, "", nil)
			if status != http.StatusOK || !reflect.DeepEqual(v, original) {
				t.Fatal("revocation or cold restart rewrote lawful historical action")
			}
		}
	}
	wire := gatewayActionWire(t, f, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 1}, nonce+1, 0, 1)
	setGatewayAction(t, m, wire, nil, height+1)
	code, v := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/octet-stream", wire)
	if code != http.StatusUnprocessableEntity || v.Committed {
		t.Fatal("revoked owner executed new action")
	}
}

func TestGatewayPQActionUnknownSinglePOSTAndReadbackIntegrity(t *testing.T) {
	f := newPQGatewayFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	wire := gatewayActionWire(t, f, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 2}, 2, 0, 1)
	setGatewayAction(t, m, wire, nil, 3)
	m.mode = "lost-response"
	code, unknown := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/octet-stream", wire)
	if code != http.StatusAccepted || unknown.Status != "unknown" || unknown.Committed || m.posts != 1 || unknown.NativeTransactionHash != consensus.SignedTransactionHash(wire) || !bytes.Equal(unknown.Transport, f.payload) {
		t.Fatalf("lost response changed original or retried: %d %+v", code, unknown)
	}
	code, original := actionHTTP(t, server.URL+unknown.ReadbackURL, "", nil)
	if code != http.StatusOK || !original.Committed || m.posts != 1 {
		t.Fatal("original-hash readback could not reconcile without another POST")
	}
	for name, mutate := range map[string]func(*cometTx){
		"outer hash":      func(tx *cometTx) { tx.Hash = strings.Repeat("F", 64) },
		"height":          func(tx *cometTx) { tx.Height = "4" },
		"result data":     func(tx *cometTx) { tx.TxResult.Data = []byte(unknown.NativeTransactionHash) },
		"original bytes":  func(tx *cometTx) { tx.Tx = append(bytes.Clone(tx.Tx), ' ') },
		"false rejection": func(tx *cometTx) { tx.TxResult.Code = 9; tx.TxResult.Data = nil },
	} {
		t.Run(name, func(t *testing.T) {
			m.mu.Lock()
			m.lookupMutation = mutate
			m.mu.Unlock()
			code, v := actionHTTP(t, server.URL+unknown.ReadbackURL, "", nil)
			if code != http.StatusAccepted || v.Committed || v.NativeTransactionHash != unknown.NativeTransactionHash || m.posts != 1 {
				t.Fatal("different index accepted or readback wrote again")
			}
		})
	}
	m.mu.Lock()
	m.lookupMutation = nil
	m.queryMutation = func(path string, b []byte) []byte {
		if strings.HasPrefix(path, consensus.PQActionHistoryPath) {
			var h consensus.PQActionHistoryView
			_ = json.Unmarshal(b, &h)
			var tx chain.Transaction
			_ = json.Unmarshal(h.History, &tx)
			tx.Amount++
			h.History, _ = json.Marshal(tx)
			b, _ = json.Marshal(h)
		}
		return b
	}
	m.mu.Unlock()
	for _, route := range []string{original.ReadbackURL, original.ABCIReadbackURL} {
		code, v := actionHTTP(t, server.URL+route, "", nil)
		if code != http.StatusAccepted || v.Committed || m.posts != 1 {
			t.Fatal("changed execution fields accepted")
		}
	}
}

func TestGatewayPQActionOriginalANDNetworkNonceAndRedirect(t *testing.T) {
	f := newPQGatewayFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	good := gatewayActionWire(t, f, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 2}, 2, 0, 1)
	before := queryPQGatewayAccount(t, f.a, f.owner)
	for _, branch := range []string{"A", "B"} {
		member, err := ynxbatch.DecodeMember(good)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "A" {
			member.Certificate.SigmaA[0] ^= 1
		} else {
			member.Certificate.SigmaB[0] ^= 1
		}
		wire, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		setGatewayAction(t, m, wire, nil, 3)
		code, v := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/octet-stream", wire)
		if code != http.StatusUnprocessableEntity || v.Committed || !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.owner)) {
			t.Fatalf("branch %s accepted or mutated state", branch)
		}
	}
	wrongNonce := gatewayActionWire(t, f, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 2}, 3, 0, 1)
	originalNetwork := f.network
	f.network = bytes.Clone(f.network)
	f.network[0] ^= 1
	wrongNetwork := gatewayActionWire(t, f, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 2}, 2, 0, 1)
	f.network = originalNetwork
	for _, wire := range [][]byte{wrongNonce, wrongNetwork} {
		setGatewayAction(t, m, wire, nil, 3)
		code, v := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/octet-stream", wire)
		if code != http.StatusUnprocessableEntity || v.Committed || !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.owner)) {
			t.Fatal("wrong nonce/network mutated real state")
		}
	}
	setGatewayAction(t, m, good, nil, 3)
	m.mode = "redirect"
	posts := m.posts
	code, v := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/octet-stream", good)
	if code != http.StatusAccepted || v.Committed || m.posts != posts+1 || !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.owner)) {
		t.Fatal("redirect replayed signed action")
	}
}

func TestGatewayPQActionDeploymentMaterialsCanonicalCapAndImportedHistory(t *testing.T) {
	f := newPQGatewayFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	source, material, p := gatewayActionMaterial(t)
	wire := gatewayActionWire(t, f, ynxauth.ActionContractDeploy, p, 2, ynxauth.ContractDeployFee, 1)
	raw, err := consensus.EncodePQContractTransaction(wire, source, &material)
	if err != nil {
		t.Fatal(err)
	}
	setGatewayAction(t, m, wire, raw, 3)
	for _, input := range []struct {
		content string
		body    []byte
	}{
		{"application/octet-stream", wire}, {"application/json", append(bytes.Clone(raw), ' ')},
	} {
		code, _ := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", input.content, input.body)
		if code != http.StatusBadRequest || m.posts != 0 {
			t.Fatal("incomplete or noncanonical deployment reached POST")
		}
	}
	// Canonical complete material is retained; its bytes alone exceed the
	// pre-existing RPC cap. No compiler validation or external write is claimed.
	large := material
	large.BuildInfoFile = bytes.Repeat([]byte{'x'}, 600000)
	over, err := consensus.EncodePQContractTransaction(wire, source, &large)
	if err != nil {
		t.Fatal(err)
	}
	code, v := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/json", over)
	if code != http.StatusRequestEntityTooLarge || m.posts != 0 || !bytes.Equal(v.Transport, over) || !bytes.Equal(v.Wire, wire) {
		t.Fatal("oversize deployment was truncated, rewritten or posted")
	}
	before := queryPQGatewayAccount(t, f.a, f.owner)
	for _, changedSource := range []string{source + "\n// unauthorized source", source} {
		badMaterial := material
		if changedSource == source {
			badMaterial.ArtifactFile = []byte(`{"invalid":"compiler artifact"}`)
		}
		bad, err := consensus.EncodePQContractTransaction(wire, changedSource, &badMaterial)
		if err != nil {
			t.Fatal(err)
		}
		setGatewayAction(t, m, wire, bad, 3)
		code, v := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/json", bad)
		if code != http.StatusUnprocessableEntity || v.Committed || !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.owner)) {
			t.Fatal("source/material mismatch executed")
		}
	}
	// A source-native execution has its actual original hash but no Comet index.
	stake := gatewayActionWire(t, f, ynxauth.ActionStake, ynxauth.StakePayload{Amount: 2}, 2, 0, 1)
	if _, _, err := f.d.SubmitPQAction(stake); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	migration, err := f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	a, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	f.a = a
	m.mu.Unlock()
	posts := m.posts
	code, v = actionHTTP(t, server.URL+"/transactions/pq/actions/originals/"+consensus.SignedTransactionHash(stake), "", nil)
	if code != http.StatusAccepted || v.Committed || v.ABCITransactionHash != "" || m.posts != posts {
		t.Fatal("imported history acquired fabricated Comet identity")
	}
}

func TestPQActionEffectsProjectionPreservesAllIntegerPrecision(t *testing.T) {
	out, err := decimalPQActionEffects([]byte(`{"nonce":18446744073709551615,"nested":[9223372036854775807,-1],"ok":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"nested":["9223372036854775807","-1"],"nonce":"18446744073709551615","ok":true}` {
		t.Fatalf("numeric precision lost: %s", out)
	}
	decoder := json.NewDecoder(bytes.NewReader(out))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		t.Fatal("projection has trailing data")
	}
}

func TestGatewayPQActionActualFinalizeRejectionIsNotCommitted(t *testing.T) {
	f := newPQGatewayFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	// CheckTx has no block timestamp; this original quote expires exactly at
	// the actual block's timestamp. The real Finalize executor must reject it.
	expires := time.Unix(3, 0).UTC()
	quote, err := chain.ResourceQuoteForPolicy(f.migration.ResourcePolicy, f.owner, 2, 1, 0, 0, expires)
	if err != nil {
		t.Fatal(err)
	}
	p := ynxauth.ResourceRentalPayload{Address: f.owner, Provider: chain.ProtocolResourceProvider, Bandwidth: 2, Compute: 1, QuoteID: quote.ID, QuoteExpiresAt: expires.Format(time.RFC3339Nano), PolicyHash: f.migration.ResourcePolicy.PolicyHash, MaxPriceYNXT: uint64(quote.PriceYNXT), IdempotencyKey: "expired-at-block"}
	p.RequestHash = consensus.ResourceRentalRequestHash(p.Address, p.Provider, 2, 1, 0, 0, p.QuoteID, expires, p.PolicyHash, int64(p.MaxPriceYNXT), p.IdempotencyKey)
	wire := gatewayActionWire(t, f, ynxauth.ActionResourceRent, p, 2, 0, 1)
	setGatewayAction(t, m, wire, nil, 3)
	check, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: f.payload})
	if err != nil || check.Code != 0 {
		t.Fatalf("fixture failed before actual block-time check: %+v %v", check, err)
	}
	before := queryPQGatewayAccount(t, f.a, f.owner)
	code, v := actionHTTP(t, server.URL+"/transactions/pq/actions/broadcast", "application/octet-stream", wire)
	if code != http.StatusUnprocessableEntity || v.Status != "rejected" || v.Committed || v.ExecutionHeight != 3 || v.CometIndex == nil || !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.owner)) || m.posts != 1 {
		t.Fatalf("real Finalize rejection was lost or mutated business state: %d %+v", code, v)
	}
	code, indexed := actionHTTP(t, server.URL+v.ABCIReadbackURL, "", nil)
	if code != http.StatusOK || !reflect.DeepEqual(indexed, v) {
		t.Fatal("outer lookup changed actual execution failure")
	}
	code, original := actionHTTP(t, server.URL+v.ReadbackURL, "", nil)
	if code != http.StatusAccepted || original.Status != "unknown" || original.Committed || original.NativeTransactionHash != v.NativeTransactionHash || m.posts != 1 {
		t.Fatal("failed execution was invented as committed original or retried")
	}
}
