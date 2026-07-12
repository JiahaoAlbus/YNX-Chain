package bftgateway

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsAndQueriesSignedAIWorkflow(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 61))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(signer, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	fixture := newABCICometFixture(t, app, int64(migration.Height))
	upstream := httptest.NewServer(fixture)
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()

	permissionTx, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionAIPermissionCreate, consensus.AIPermissionPayload{SessionID: "bft-session", Requester: "merchant_ops", Scope: "trust_label", Purpose: "review label", ExpiryHours: 2}, 1)
	permissionRaw, _ := consensus.EncodeSignedApplicationAction(permissionTx)
	var permission consensus.BFTAIPermission
	postSignedAction(t, server.URL+"/ai/permissions", permissionRaw, http.StatusCreated, &permission)
	if permission.Signer != signer || permission.Status != "active" {
		t.Fatalf("unexpected permission: %+v", permission)
	}

	proposalTx, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionAIProposalCreate, consensus.AIActionProposalPayload{SessionID: "bft-session", Requester: "merchant_ops", Scope: "trust_label", ActionType: "risk label", Description: "review bounded evidence", ExpiryHours: 2}, 2)
	proposalRaw, _ := consensus.EncodeSignedApplicationAction(proposalTx)
	var proposal consensus.BFTAIAction
	postSignedAction(t, server.URL+"/ai/actions", proposalRaw, http.StatusCreated, &proposal)
	if proposal.Status != "pending_approval" || !proposal.Sensitive || proposal.Executable {
		t.Fatalf("unexpected proposal: %+v", proposal)
	}

	approvalTx, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionAIProposalApprove, consensus.AIActionDecisionPayload{ActionID: proposal.ID, Approver: "reviewer_1", PermissionID: permission.ID}, 3)
	approvalRaw, _ := consensus.EncodeSignedApplicationAction(approvalTx)
	var approved consensus.BFTAIAction
	postSignedAction(t, server.URL+"/ai/actions/"+proposal.ID+"/approve", approvalRaw, http.StatusOK, &approved)
	if approved.Status != "approved" || !approved.Executable || approved.PermissionID != permission.ID {
		t.Fatalf("unexpected approval: %+v", approved)
	}

	var listed map[string][]consensus.BFTAIAction
	getJSON(t, server.URL+"/ai/actions?sessionId=bft-session", &listed)
	if len(listed["actions"]) != 1 || listed["actions"][0].ID != proposal.ID {
		t.Fatalf("unexpected action list: %+v", listed)
	}
	var audit struct {
		Events []consensus.BFTAIAuditEvent `json:"events"`
	}
	getJSON(t, server.URL+"/ai/audit", &audit)
	if len(audit.Events) != 3 || audit.Events[2].RecordID != proposal.ID {
		t.Fatalf("unexpected audit: %+v", audit)
	}
	var account chain.ConsensusAccount
	getJSON(t, server.URL+"/accounts/"+signer, &account)
	if account.Nonce != 3 || account.Balance != 97 || account.ResourceUsage.AICreditsUsed != 3 {
		t.Fatalf("unexpected signer account: %+v", account)
	}

	postSignedAction(t, server.URL+"/ai/actions/wrong/approve", approvalRaw, http.StatusBadRequest, nil)
	postSignedAction(t, server.URL+"/ai/permissions", append(permissionRaw, '\n'), http.StatusBadRequest, nil)
}

type abciCometFixture struct {
	t      *testing.T
	mu     sync.Mutex
	app    *consensus.Application
	height int64
	blocks map[int64][]byte
	times  map[int64]time.Time
}

func newABCICometFixture(t *testing.T, app *consensus.Application, height int64) *abciCometFixture {
	return &abciCometFixture{t: t, app: app, height: height, blocks: map[int64][]byte{}, times: map[int64]time.Time{}}
}

func (f *abciCometFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/status":
		blockTime := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC).Add(time.Duration(f.height) * time.Second)
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"node_info": map[string]any{"network": "ynx_6423-1"}, "sync_info": map[string]any{"earliest_block_hash": strings.Repeat("E", 64), "earliest_block_height": "1", "earliest_block_time": blockTime.Add(-time.Duration(f.height-1) * time.Second), "latest_block_hash": strings.Repeat("A", 64), "latest_block_height": strconv.FormatInt(f.height, 10), "latest_block_time": blockTime, "catching_up": false}}})
	case "/validators":
		validators := make([]map[string]any, 4)
		for i := range validators {
			validators[i] = map[string]any{"address": fmt.Sprintf("%040X", i+1), "voting_power": "10", "proposer_priority": "0", "pub_key": map[string]any{"type": "tendermint/PubKeyEd25519", "value": base64.StdEncoding.EncodeToString(make([]byte, 32))}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"block_height": strconv.FormatInt(f.height, 10), "validators": validators}})
	case "/broadcast_tx_commit":
		raw, err := hex.DecodeString(strings.TrimPrefix(r.URL.Query().Get("tx"), "0x"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		check, _ := f.app.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: raw})
		if check.Code != 0 {
			_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"check_tx": map[string]any{"code": check.Code, "log": check.Log}, "tx_result": map[string]any{"code": 0}, "hash": strings.ToUpper(strings.TrimPrefix(consensus.SignedTransactionHash(raw), "0x")), "height": "0"}})
			return
		}
		f.height++
		blockTime := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC).Add(time.Duration(f.height) * time.Second)
		finalized, err := f.app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: f.height, Time: blockTime, Txs: [][]byte{raw}})
		if err != nil || finalized.TxResults[0].Code != 0 {
			f.t.Fatalf("fixture finalize failed: %+v %v", finalized, err)
		}
		if _, err := f.app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
			f.t.Fatal(err)
		}
		f.blocks[f.height], f.times[f.height] = raw, blockTime
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"check_tx": map[string]any{"code": 0}, "tx_result": map[string]any{"code": 0}, "hash": strings.ToUpper(strings.TrimPrefix(consensus.SignedTransactionHash(raw), "0x")), "height": strconv.FormatInt(f.height, 10)}})
	case "/block":
		height, _ := strconv.ParseInt(r.URL.Query().Get("height"), 10, 64)
		raw, ok := f.blocks[height]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"block_id": map[string]any{"hash": fmt.Sprintf("%064X", height)}, "block": map[string]any{"header": map[string]any{"height": strconv.FormatInt(height, 10), "time": f.times[height], "proposer_address": strings.Repeat("A", 40), "last_block_id": map[string]any{"hash": fmt.Sprintf("%064X", height-1)}}, "data": map[string]any{"txs": []string{base64.StdEncoding.EncodeToString(raw)}}}}})
	case "/tx":
		hash := strings.ToLower(r.URL.Query().Get("hash"))
		for height, raw := range f.blocks {
			if consensus.SignedTransactionHash(raw) == hash {
				_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"hash": strings.ToUpper(strings.TrimPrefix(hash, "0x")), "height": strconv.FormatInt(height, 10), "index": 0, "tx_result": map[string]any{"code": 0, "log": "application_action", "gas_used": "1"}, "tx": base64.StdEncoding.EncodeToString(raw)}})
				return
			}
		}
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32603, "message": "tx not found"}})
	case "/block_results":
		height, _ := strconv.ParseInt(r.URL.Query().Get("height"), 10, 64)
		if _, ok := f.blocks[height]; !ok {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"height": strconv.FormatInt(height, 10), "txs_results": []map[string]any{{"code": 0, "log": "application_action", "gas_used": "1"}}}})
	case "/abci_query":
		path, err := strconv.Unquote(r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, "bad path", 400)
			return
		}
		response, err := f.app.Query(context.Background(), &abcitypes.RequestQuery{Path: path})
		if err != nil {
			f.t.Fatal(err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"response": map[string]any{"code": response.Code, "log": response.Log, "height": strconv.FormatInt(f.height, 10), "value": base64.StdEncoding.EncodeToString(response.Value)}}})
	default:
		http.NotFound(w, r)
	}
}

func postSignedAction(t *testing.T, endpoint string, raw []byte, expected int, out any) {
	t.Helper()
	resp, err := http.Post(endpoint, "application/json", strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		t.Fatalf("POST %s expected %d got %d", endpoint, expected, resp.StatusCode)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}
