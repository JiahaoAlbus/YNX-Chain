package governance

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestCometChainExecutionClientBroadcastsAndReadsCanonicalRecord(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x51}, 32))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	intent := testCometGovernanceIntent(now)
	tx, err := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionGovernanceExecutionBegin, intent, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := consensus.EncodeSignedApplicationAction(tx)
	record := consensus.BFTGovernanceExecution{
		ProposalID: intent.ProposalID, ActionHash: intent.ActionHash, ManifestHash: intent.ManifestHash,
		GovernanceAuditHash: intent.GovernanceAuditHash, TimelockAuditHash: intent.TimelockAuditHash,
		CanaryAuditHash: intent.CanaryAuditHash, EvidenceHash: intent.EvidenceHash, Scope: intent.Scope,
		Signer: signer, Status: "submitted", EarliestExecution: intent.EarliestExecution,
		LatestExecution: intent.LatestExecution, SubmittedAt: now, SubmittedHeight: 11,
		BeginTxHash: consensus.ApplicationActionHash(raw), AuditHash: strings.Repeat("9", 64),
	}
	recordJSON, _ := json.Marshal(record)
	var broadcastCalls, queryCalls int
	currentRaw := raw
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/status":
			_, _ = w.Write([]byte(`{"result":{"node_info":{"network":"ynx_6423-1"},"sync_info":{"latest_block_height":"12","catching_up":false}}}`))
		case "/broadcast_tx_commit":
			broadcastCalls++
			if r.URL.Query().Get("tx") != "0x"+fmt.Sprintf("%x", currentRaw) {
				t.Errorf("unexpected broadcast transaction")
			}
			_, _ = fmt.Fprintf(w, `{"result":{"check_tx":{"code":0,"log":""},"tx_result":{"code":0,"log":""},"hash":%q,"height":"11"}}`, strings.TrimPrefix(consensus.ApplicationActionHash(currentRaw), "0x"))
		case "/abci_query":
			queryCalls++
			if r.URL.Query().Get("path") != `"/governance/executions/`+intent.ProposalID+`"` {
				t.Errorf("unexpected ABCI path %q", r.URL.Query().Get("path"))
			}
			_, _ = fmt.Fprintf(w, `{"result":{"response":{"code":0,"log":"","height":"12","value":%q}}}`, base64.StdEncoding.EncodeToString(recordJSON))
		case "/block":
			_, _ = fmt.Fprintf(w, `{"result":{"block_id":{"hash":%q},"block":{"header":{"height":"11"}}}}`, strings.Repeat("a", 64))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client, err := NewCometChainExecutionClient(server.URL, 6423, 2*time.Second, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if err = client.BroadcastGovernanceAction(context.Background(), raw); err != nil {
		t.Fatal(err)
	}
	verifyIntent := consensus.GovernanceExecutionVerifyPayload{
		ProposalID: intent.ProposalID, BeginTxHash: record.BeginTxHash, ActionHash: intent.ActionHash,
		ManifestHash: intent.ManifestHash, Outcome: "verified", StateRoot: strings.Repeat("a", 64), EvidenceHash: strings.Repeat("b", 64),
	}
	verifyTx, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionGovernanceExecutionVerify, verifyIntent, 2)
	currentRaw, _ = consensus.EncodeSignedApplicationAction(verifyTx)
	if err = client.BroadcastGovernanceAction(context.Background(), currentRaw); err != nil {
		t.Fatal(err)
	}
	got, found, err := client.GovernanceExecution(context.Background(), intent.ProposalID)
	if err != nil || !found || got.BeginTxHash != record.BeginTxHash || got.ProposalID != intent.ProposalID {
		t.Fatalf("canonical query failed: %+v found=%v err=%v", got, found, err)
	}
	if broadcastCalls != 2 || queryCalls != 1 {
		t.Fatalf("unexpected RPC calls: broadcast=%d query=%d", broadcastCalls, queryCalls)
	}
	blockHash, err := client.GovernanceBlockHash(context.Background(), 11)
	if err != nil || blockHash != "0x"+strings.Repeat("a", 64) {
		t.Fatalf("canonical block lookup failed: %q err=%v", blockHash, err)
	}
}

func TestCometChainExecutionClientFailsClosedOnNotFoundRejectionAndTamper(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x52}, 32))
	intent := testCometGovernanceIntent(time.Date(2026, 7, 27, 13, 0, 0, 0, time.UTC))
	tx, _ := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionGovernanceExecutionBegin, intent, 1)
	raw, _ := consensus.EncodeSignedApplicationAction(tx)
	mode := "not_found"
	network := "ynx_6423-1"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = fmt.Fprintf(w, `{"result":{"node_info":{"network":%q},"sync_info":{"latest_block_height":"12","catching_up":false}}}`, network)
			return
		}
		switch mode {
		case "not_found":
			_, _ = w.Write([]byte(`{"result":{"response":{"code":1,"log":"governance execution not found","height":"12","value":""}}}`))
		case "rejected":
			_, _ = w.Write([]byte(`{"result":{"check_tx":{"code":2,"log":"invalid nonce"},"tx_result":{"code":0,"log":""},"hash":"","height":"0"}}`))
		case "wrong_hash":
			_, _ = w.Write([]byte(`{"result":{"check_tx":{"code":0,"log":""},"tx_result":{"code":0,"log":""},"hash":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","height":"12"}}`))
		case "tampered_query":
			payload := base64.StdEncoding.EncodeToString([]byte(`{"proposalId":"` + intent.ProposalID + `","unexpected":true}`))
			_, _ = fmt.Fprintf(w, `{"result":{"response":{"code":0,"log":"","height":"12","value":%q}}}`, payload)
		}
	}))
	defer server.Close()
	client, _ := NewCometChainExecutionClient(server.URL, 6423, 2*time.Second, server.Client())

	if _, found, err := client.GovernanceExecution(context.Background(), intent.ProposalID); err != nil || found {
		t.Fatalf("canonical not-found classification failed: found=%v err=%v", found, err)
	}
	network = "ynx_1-1"
	if _, _, err := client.GovernanceExecution(context.Background(), intent.ProposalID); err == nil {
		t.Fatal("wrong CometBFT network identity was accepted")
	}
	network = "ynx_6423-1"
	mode = "rejected"
	if err := client.BroadcastGovernanceAction(context.Background(), raw); err == nil {
		t.Fatal("CometBFT CheckTx rejection was accepted")
	}
	mode = "wrong_hash"
	if err := client.BroadcastGovernanceAction(context.Background(), raw); err == nil {
		t.Fatal("CometBFT transaction hash mismatch was accepted")
	}
	mode = "tampered_query"
	if _, _, err := client.GovernanceExecution(context.Background(), intent.ProposalID); err == nil {
		t.Fatal("unknown canonical record field was accepted")
	}
}

func TestRuntimeV4WiresPinnedCometExecutionOwnerAndV3RemainsDisabled(t *testing.T) {
	cfg, now := runtimeFixture(t)
	service, auth, owner, err := OpenIntegratedRuntime(cfg, now, nil)
	if err != nil || service == nil || auth == nil || owner != nil {
		t.Fatalf("v3 integration state is not truthful: owner=%T err=%v", owner, err)
	}
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x53}, 32))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"result":{"response":{"code":1,"log":"governance execution not found","height":"1","value":""}}}`))
	}))
	defer rpc.Close()

	cfg, now = runtimeFixture(t)
	cfg.SchemaVersion = "ynx-governanced-config/v4"
	cfg.ChainCore = &RuntimeChainCoreConfig{RPCURL: rpc.URL, ChainID: 6423, ExecutionSigner: signer, RequestTimeout: "2s"}
	service, auth, owner, err = OpenIntegratedRuntime(cfg, now, rpc.Client())
	if err != nil || service == nil || auth == nil || owner == nil {
		t.Fatalf("v4 Chain Core owner was not wired: owner=%T err=%v", owner, err)
	}
	cfg.SchemaVersion = "ynx-governanced-config/v3"
	if _, _, err = ValidateRuntimeConfig(cfg); err == nil {
		t.Fatal("v3 config silently accepted Chain Core execution fields")
	}
	cfg.SchemaVersion = "ynx-governanced-config/v4"
	cfg.ChainCore.ExecutionSigner = "not-a-native-address"
	if _, _, err = ValidateRuntimeConfig(cfg); err == nil {
		t.Fatal("runtime accepted an unpinned invalid execution signer")
	}
	cfg.ChainCore.ExecutionSigner = signer
	cfg.ChainCore.RPCURL = "http://rpc.example.invalid:26657"
	if _, _, err = ValidateRuntimeConfig(cfg); err == nil {
		t.Fatal("runtime accepted plaintext non-loopback CometBFT RPC")
	}
}

func testCometGovernanceIntent(now time.Time) consensus.GovernanceExecutionBeginPayload {
	return consensus.GovernanceExecutionBeginPayload{
		ProposalID: strings.Repeat("1", 64), ActionHash: strings.Repeat("2", 64),
		ManifestHash: strings.Repeat("3", 64), GovernanceAuditHash: strings.Repeat("4", 64),
		TimelockAuditHash: strings.Repeat("5", 64), CanaryAuditHash: strings.Repeat("6", 64),
		EvidenceHash: strings.Repeat("7", 64), Scope: "bridge",
		EarliestExecution: now.Add(-time.Minute), LatestExecution: now.Add(time.Hour),
	}
}
