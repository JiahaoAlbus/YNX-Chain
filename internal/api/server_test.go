package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestDevnetAPIFlow(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()
	var status map[string]any
	doJSON(t, http.MethodGet, server.URL+"/status", nil, http.StatusOK, &status)
	if status["chainId"].(float64) != 6425 {
		t.Fatalf("expected devnet chain ID 6425, got %v", status["chainId"])
	}
	if status["nativeCurrencySymbol"] != "YNXT" {
		t.Fatalf("expected YNXT, got %v", status["nativeCurrencySymbol"])
	}
	var faucetTx map[string]any
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": "ynx_alice", "amount": 1000}, http.StatusCreated, &faucetTx)
	var transferTx map[string]any
	doJSON(t, http.MethodPost, server.URL+"/transfer", map[string]any{"from": "ynx_alice", "to": "ynx_bob", "amount": 125}, http.StatusCreated, &transferTx)
	block := devnet.ProduceBlock()
	if block.Height != 1 || len(block.Transactions) != 2 {
		t.Fatalf("unexpected block: %+v", block)
	}
	var trace map[string]any
	doJSON(t, http.MethodGet, server.URL+"/trust/trace/ynx_bob", nil, http.StatusOK, &trace)
	if len(trace["lots"].([]any)) != 1 {
		t.Fatalf("expected inherited lot: %v", trace)
	}
	var summary map[string]any
	doJSON(t, http.MethodGet, server.URL+"/explorer/summary", nil, http.StatusOK, &summary)
	if summary["totalTransactions"].(float64) != 2 {
		t.Fatalf("summary did not count txs: %v", summary)
	}
	var label map[string]any
	doJSON(t, http.MethodPost, server.URL+"/trust/labels", map[string]any{"subject": "ynx_bob", "label": "reviewed", "labelType": "risk", "riskWeightBps": 250, "confidenceBps": 8200, "source": "unit-test", "evidenceHash": "sha256:unit-evidence", "expiryHours": 24, "reviewRequired": true}, http.StatusCreated, &label)
	if label["labelId"] == "" || label["source"] != "unit-test" || label["evidenceHash"] != "sha256:unit-evidence" || label["assetEffect"] != "none_advisory_only" || label["appealAvailable"] != true {
		t.Fatalf("expected rich advisory label metadata: %v", label)
	}
	var rejected map[string]any
	doJSON(t, http.MethodPost, server.URL+"/trust/labels", map[string]any{"subject": "ynx_bob", "label": "freeze", "riskWeightBps": 9000, "source": "unit-test", "evidenceHash": "sha256:bad", "assetEffect": "freeze_native_ynxt"}, http.StatusBadRequest, &rejected)
	var evidence map[string]any
	doJSON(t, http.MethodPost, server.URL+"/trust/evidence", map[string]any{"subject": "ynx_bob"}, http.StatusCreated, &evidence)
	if evidence["jsonHash"] == "" {
		t.Fatalf("expected evidence hash: %v", evidence)
	}
	riskSummary := evidence["riskSummary"].(map[string]any)
	if riskSummary["assetEffect"] != "none_advisory_only" || riskSummary["appealPath"] != "/trust/appeals" || riskSummary["effectiveRiskWeightBps"].(float64) <= 0 {
		t.Fatalf("expected reviewer-facing risk summary: %v", riskSummary)
	}
	doJSON(t, http.MethodGet, server.URL+"/trust/evidence/"+evidence["id"].(string), nil, http.StatusOK, &evidence)
}

func TestValidatorPeerReadinessAPI(t *testing.T) {
	validators, err := chain.ParseValidatorSet("ynx_val_primary|primary|43.153.202.237|primary validator|peer-primary;ynx_val_sg|singapore|43.134.23.58|bonded validator|peer-sg")
	if err != nil {
		t.Fatal(err)
	}
	peers, err := chain.ParseValidatorPeers("ynx_val_primary|peer-primary|43.153.202.237|43.153.202.237:26656|primary validator;ynx_val_sg|peer-sg|43.134.23.58|43.134.23.58:26656|bonded validator")
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnetWithValidatorsAndPeers(chain.DefaultNetworkConfig("testnet"), validators, peers)
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()

	var heartbeat map[string]any
	doJSON(t, http.MethodPost, server.URL+"/validators/ynx_val_sg/heartbeat", map[string]any{
		"peerId":       "peer-sg-live",
		"host":         "43.134.23.58:26656",
		"ready":        true,
		"status":       "reachable",
		"latestHeight": 12,
		"evidence":     "api-heartbeat-unit-test",
	}, http.StatusOK, &heartbeat)
	if heartbeat["address"] != "ynx_val_sg" || heartbeat["peerReady"] != true || heartbeat["peerStatus"] != "reachable" || heartbeat["latestHeight"].(float64) != 12 || heartbeat["peerId"] != "peer-sg-live" {
		t.Fatalf("unexpected heartbeat response: %v", heartbeat)
	}

	var validatorsOut map[string]any
	doJSON(t, http.MethodGet, server.URL+"/validators", nil, http.StatusOK, &validatorsOut)
	got := validatorsOut["validators"].([]any)
	if len(got) != 2 {
		t.Fatalf("expected two validators: %v", validatorsOut)
	}
	sg := validatorJSONByAddress(got, "ynx_val_sg")
	if sg == nil || sg["peerReady"] != true || sg["peerStatus"] != "reachable" || sg["peerEvidence"] != "api-heartbeat-unit-test" {
		t.Fatalf("expected readable peer readiness in validators response: %v", validatorsOut)
	}

	var status map[string]any
	doJSON(t, http.MethodGet, server.URL+"/status", nil, http.StatusOK, &status)
	if status["readyValidatorCount"].(float64) != 1 {
		t.Fatalf("expected ready validator count 1: %v", status)
	}
	discovery := status["validatorPeerDiscovery"].(map[string]any)
	if discovery["expected"].(float64) != 2 || discovery["observed"].(float64) != 1 {
		t.Fatalf("expected validator peer discovery summary: %v", status)
	}

	var peersOut map[string]any
	doJSON(t, http.MethodGet, server.URL+"/validators/peers", nil, http.StatusOK, &peersOut)
	peerValues := peersOut["peers"].([]any)
	sgPeer := validatorJSONByAddress(peerValues, "ynx_val_sg")
	if sgPeer == nil || sgPeer["observed"] != true || sgPeer["p2pAddress"] != "43.134.23.58:26656" || sgPeer["evidence"] != "api-heartbeat-unit-test" {
		t.Fatalf("expected readable peer discovery in peers response: %v", peersOut)
	}

	var observed map[string]any
	doJSON(t, http.MethodPost, server.URL+"/validators/ynx_val_primary/peers/observe", map[string]any{
		"peerId":       "peer-primary-live",
		"host":         "43.153.202.237",
		"p2pAddress":   "43.153.202.237:26656",
		"status":       "reachable",
		"latestHeight": 14,
		"evidence":     "api-peer-observe-unit-test",
	}, http.StatusOK, &observed)
	if observed["address"] != "ynx_val_primary" || observed["observed"] != true || observed["latestHeight"].(float64) != 14 || observed["evidence"] != "api-peer-observe-unit-test" {
		t.Fatalf("unexpected observed peer response: %v", observed)
	}

	var bad map[string]any
	doJSON(t, http.MethodPost, server.URL+"/validators/ynx_missing/heartbeat", map[string]any{"ready": true}, http.StatusBadRequest, &bad)
	doJSON(t, http.MethodPost, server.URL+"/validators/ynx_missing/peers/observe", map[string]any{"status": "reachable"}, http.StatusBadRequest, &bad)
}

func TestGovernanceRequestAndAppealAPIFlow(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()

	var rules map[string]any
	doJSON(t, http.MethodGet, server.URL+"/governance/request-validity-rules", nil, http.StatusOK, &rules)
	for _, expected := range []string{
		"governance-review-user-rights",
		"targeted-scope-required",
		"evidence-required",
		"native-ynxt-no-direct-freeze",
		"asset-type-boundary",
		"user-notice-required",
	} {
		if !rulesContain(rules["rules"].([]any), expected) {
			t.Fatalf("expected request validity rule %s in %v", expected, rules)
		}
	}

	var reviewRequest map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "unit_governance",
		"subject":     "ynx_governance_subject",
		"action":      "risk label review",
		"assetType":   "stablecoin",
		"scope":       "single transfer",
		"description": "review a scoped transfer with evidence",
		"evidence":    []string{"case:api", "tx:0xabc"},
	}, http.StatusCreated, &reviewRequest)
	if reviewRequest["classification"] != string(chain.RequestRequiresReview) || reviewRequest["status"] != "pending_review" || reviewRequest["transparencyEntryId"] == "" {
		t.Fatalf("expected review-required governance request: %v", reviewRequest)
	}
	if !stringSliceContains(reviewRequest["ruleIds"].([]any), "governance-review-user-rights") || reviewRequest["requiresUserNotice"] != true {
		t.Fatalf("expected review rule id and user notice: %v", reviewRequest)
	}

	requestID := reviewRequest["id"].(string)
	var readRequest map[string]any
	doJSON(t, http.MethodGet, server.URL+"/governance/requests/"+requestID, nil, http.StatusOK, &readRequest)
	if readRequest["id"] != requestID || readRequest["classification"] != string(chain.RequestRequiresReview) {
		t.Fatalf("expected readable persisted governance request: %v", readRequest)
	}

	var reviewed map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests/"+requestID+"/review", nil, http.StatusOK, &reviewed)
	if reviewed["status"] != "reviewed" || reviewed["reviewedAt"] == nil {
		t.Fatalf("expected explicit governance review status: %v", reviewed)
	}

	var nativeRejected map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "unit_governance",
		"subject":     "ynx_governance_subject",
		"action":      "freeze native YNXT",
		"assetType":   "YNXT",
		"scope":       "single account",
		"description": "directly freeze user native YNXT by protocol request",
		"evidence":    []string{"case:native"},
	}, http.StatusCreated, &nativeRejected)
	if nativeRejected["classification"] != string(chain.RequestIllegalOrAbusive) || nativeRejected["status"] != "rejected" || nativeRejected["nativeYnxtProtected"] != true {
		t.Fatalf("expected native YNXT protection rejection: %v", nativeRejected)
	}
	if !stringSliceContains(nativeRejected["ruleIds"].([]any), "native-ynxt-no-direct-freeze") {
		t.Fatalf("expected native YNXT rule id: %v", nativeRejected)
	}

	var overbroad map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "unit_governance",
		"subject":     "ynx_governance_subject",
		"action":      "trace all wallets",
		"assetType":   "stablecoin",
		"scope":       "all wallets",
		"description": "bulk trace everyone",
		"evidence":    []string{"case:bulk"},
	}, http.StatusCreated, &overbroad)
	if overbroad["classification"] != string(chain.RequestOverbroad) || !stringSliceContains(overbroad["ruleIds"].([]any), "targeted-scope-required") {
		t.Fatalf("expected overbroad request rejection: %v", overbroad)
	}

	var missingEvidence map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "unit_governance",
		"subject":     "ynx_governance_subject",
		"action":      "risk label review",
		"assetType":   "stablecoin",
		"scope":       "single transfer",
		"description": "review without evidence",
	}, http.StatusCreated, &missingEvidence)
	if missingEvidence["classification"] != string(chain.RequestInsufficientEvidence) || !stringSliceContains(missingEvidence["ruleIds"].([]any), "evidence-required") {
		t.Fatalf("expected insufficient evidence classification: %v", missingEvidence)
	}

	var outOfScope map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "unit_governance",
		"subject":     "ynx_governance_subject",
		"action":      "review off-chain bank account",
		"assetType":   "bank_account",
		"scope":       "single external account",
		"description": "off-chain asset boundary check",
		"evidence":    []string{"case:asset-boundary"},
	}, http.StatusCreated, &outOfScope)
	if outOfScope["classification"] != string(chain.RequestOutOfScope) || outOfScope["status"] != "rejected" || !stringSliceContains(outOfScope["ruleIds"].([]any), "asset-type-boundary") {
		t.Fatalf("expected asset boundary rejection: %v", outOfScope)
	}

	var manual map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "unit_governance",
		"subject":     "ynx_governance_subject",
		"action":      "metadata correction",
		"assetType":   "evidence",
		"scope":       "single evidence packet",
		"description": "correct one evidence packet with case evidence",
		"evidence":    []string{"case:manual"},
	}, http.StatusCreated, &manual)
	var rejected map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests/"+manual["id"].(string)+"/reject", map[string]any{"reason": "manual API rejection"}, http.StatusOK, &rejected)
	if rejected["classification"] != string(chain.RequestRejected) || rejected["status"] != "rejected" || rejected["rejectedAt"] == nil || !stringSliceContains(rejected["reasons"].([]any), "manual API rejection") {
		t.Fatalf("expected manual rejection metadata: %v", rejected)
	}

	var appeal map[string]any
	var badAppeal map[string]any
	doJSON(t, http.MethodPost, server.URL+"/trust/appeals", map[string]any{
		"requestId": "missing_request",
		"subject":   "ynx_governance_subject",
		"appellant": "ynx_governance_subject",
		"reason":    "missing request should not open an appeal",
	}, http.StatusBadRequest, &badAppeal)
	if badAppeal["error"] == "" {
		t.Fatalf("expected missing request appeal error: %v", badAppeal)
	}
	doJSON(t, http.MethodPost, server.URL+"/trust/appeals", map[string]any{
		"requestId": requestID,
		"subject":   "ynx_governance_subject",
		"appellant": "ynx_governance_subject",
		"reason":    "false positive correction",
		"evidence":  []string{"wallet ownership proof"},
	}, http.StatusCreated, &appeal)
	if appeal["status"] != "SUBMITTED" || appeal["transparencyEntryId"] == "" {
		t.Fatalf("expected submitted appeal with transparency entry: %v", appeal)
	}
	var readAppeal map[string]any
	doJSON(t, http.MethodGet, server.URL+"/trust/appeals/"+appeal["id"].(string), nil, http.StatusOK, &readAppeal)
	if readAppeal["id"] != appeal["id"] || readAppeal["requestId"] != requestID {
		t.Fatalf("expected readable persisted appeal: %v", readAppeal)
	}

	var report map[string]any
	doJSON(t, http.MethodGet, server.URL+"/governance/transparency", nil, http.StatusOK, &report)
	if report["entryCount"].(float64) < 8 || report["rejectedCount"].(float64) < 4 || report["appealCount"].(float64) < 1 || report["reviewCount"].(float64) < 1 {
		t.Fatalf("expected transparency report counts for governance and appeal flow: %v", report)
	}
	entries := report["entries"].([]any)
	if !entriesContainTypeStatus(entries, "governance_rejection", "rejected") || !entriesContainTypeStatus(entries, "trust_appeal", "SUBMITTED") {
		t.Fatalf("expected rejection and appeal transparency entries: %v", report)
	}
}

func TestEVMRPCSubset(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()
	var out map[string]any
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []any{}}, http.StatusOK, &out)
	if out["result"] != "0x1917" {
		t.Fatalf("expected 0x1917 for chainId 6423, got %v", out)
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 2, "method": "eth_blockNumber", "params": []any{}}, http.StatusOK, &out)
	if out["result"] == "" {
		t.Fatalf("missing block number: %v", out)
	}
	if _, err := devnet.Faucet("ynx_evm_alice", 1000); err != nil {
		t.Fatal(err)
	}
	transfer, err := devnet.Transfer("ynx_evm_alice", "ynx_evm_bob", 125)
	if err != nil {
		t.Fatal(err)
	}
	block := devnet.ProduceBlock()
	if block.Height == 0 {
		t.Fatal("expected produced block")
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 3, "method": "eth_getTransactionReceipt", "params": []any{transfer.Hash}}, http.StatusOK, &out)
	receipt := out["result"].(map[string]any)
	logs := receipt["logs"].([]any)
	if len(logs) != 1 {
		t.Fatalf("expected receipt logs, got %v", receipt)
	}
	log := logs[0].(map[string]any)
	if log["transactionHash"] != transfer.Hash || log["logIndex"] != "0x1" {
		t.Fatalf("unexpected receipt log: %v", log)
	}
	topic := log["topics"].([]any)[0].(string)
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 4, "method": "eth_getLogs", "params": []any{map[string]any{"fromBlock": "0x1", "toBlock": "latest", "address": log["address"], "topics": []any{topic}}}}, http.StatusOK, &out)
	filteredLogs := out["result"].([]any)
	if len(filteredLogs) != 1 || filteredLogs[0].(map[string]any)["transactionHash"] != transfer.Hash {
		t.Fatalf("expected filtered EVM log, got %v", out)
	}
}

func TestPrometheusMetrics(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": "ynx_metrics", "amount": 1000}, http.StatusCreated, nil)
	devnet.ProduceBlock()

	resp, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected metrics status 200, got %d", resp.StatusCode)
	}
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(resp.Body)
	body := buf.String()
	for _, expected := range []string{
		`ynx_chain_height{network="testnet",chain_id="6423",native_symbol="YNXT"} 1`,
		"ynx_chain_transactions_total",
		"ynx_chain_validators",
		"ynx_chain_persistence_error",
		"ynx_resource_delegated_ynxt",
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("metrics missing %q in:\n%s", expected, body)
		}
	}
}

func TestPayResourceAndIDEFlow(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()

	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": "ynx_builder", "amount": 1000}, http.StatusCreated, nil)

	var intent map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/intents", map[string]any{"merchant": "merchant_unit", "amount": 50, "idempotencyKey": "intent-api-key"}, http.StatusCreated, &intent)
	intentID := intent["id"].(string)
	var duplicateIntent map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/intents", map[string]any{"merchant": "merchant_unit", "amount": 999, "idempotencyKey": "intent-api-key"}, http.StatusCreated, &duplicateIntent)
	if duplicateIntent["id"] != intentID || duplicateIntent["amount"].(float64) != 50 {
		t.Fatalf("expected idempotent intent replay: %v original %v", duplicateIntent, intent)
	}
	var invoice map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/invoices", map[string]any{"intentId": intentID, "dueInHours": 12, "idempotencyKey": "invoice-api-key"}, http.StatusCreated, &invoice)
	var duplicateInvoice map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/invoices", map[string]any{"intentId": intentID, "dueInHours": 99, "idempotencyKey": "invoice-api-key"}, http.StatusCreated, &duplicateInvoice)
	if duplicateInvoice["id"] != invoice["id"] {
		t.Fatalf("expected idempotent invoice replay: %v original %v", duplicateInvoice, invoice)
	}
	doJSON(t, http.MethodGet, server.URL+"/pay/invoices/"+invoice["id"].(string), nil, http.StatusOK, &invoice)
	var webhook map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/webhook-signatures", map[string]any{"intentId": intentID, "eventType": "payment_intent.created", "signingKey": "unit-test-key", "idempotencyKey": "webhook-api-key"}, http.StatusCreated, &webhook)
	if webhook["algorithm"] != "hmac-sha256" || webhook["payloadHash"] == "" || webhook["replaySafe"] != true {
		t.Fatalf("unexpected webhook signature: %v", webhook)
	}
	var duplicateWebhook map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/webhook-signatures", map[string]any{"intentId": intentID, "eventType": "payment_intent.created", "signingKey": "other-key", "idempotencyKey": "webhook-api-key"}, http.StatusCreated, &duplicateWebhook)
	if duplicateWebhook["eventId"] != webhook["eventId"] || duplicateWebhook["signature"] != webhook["signature"] {
		t.Fatalf("expected idempotent webhook replay: %v original %v", duplicateWebhook, webhook)
	}
	doJSON(t, http.MethodGet, server.URL+"/pay/webhook-signatures/"+webhook["eventId"].(string), nil, http.StatusOK, &webhook)
	var refund map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/refunds", map[string]any{"intentId": intentID, "amount": 10, "reason": "unit", "idempotencyKey": "refund-api-key"}, http.StatusCreated, &refund)
	var duplicateRefund map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/refunds", map[string]any{"intentId": intentID, "amount": 20, "reason": "changed", "idempotencyKey": "refund-api-key"}, http.StatusCreated, &duplicateRefund)
	if duplicateRefund["id"] != refund["id"] || duplicateRefund["amount"].(float64) != 10 {
		t.Fatalf("expected idempotent refund replay: %v original %v", duplicateRefund, refund)
	}
	var payEvents map[string]any
	doJSON(t, http.MethodGet, server.URL+"/pay/events?intentId="+intentID, nil, http.StatusOK, &payEvents)
	events := payEvents["events"].([]any)
	if len(events) != 4 {
		t.Fatalf("expected four pay events, got %v", payEvents)
	}
	firstEvent := events[0].(map[string]any)
	if firstEvent["auditHash"] == "" {
		t.Fatalf("expected pay event audit hash: %v", firstEvent)
	}
	doJSON(t, http.MethodGet, server.URL+"/pay/events/"+firstEvent["id"].(string), nil, http.StatusOK, &firstEvent)

	var quote map[string]any
	doJSON(t, http.MethodGet, server.URL+"/resource-market/quote?address=ynx_builder&bandwidth=100&compute=5&aiCredits=2&trustCredits=1", nil, http.StatusOK, &quote)
	if quote["priceYnxt"].(float64) <= 0 {
		t.Fatalf("expected positive quote: %v", quote)
	}
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": "ynx_provider", "amount": 1000}, http.StatusCreated, nil)
	var delegation map[string]any
	doJSON(t, http.MethodPost, server.URL+"/resource-market/delegations", map[string]any{"provider": "ynx_provider", "beneficiary": "ynx_provider", "amount": 500}, http.StatusCreated, &delegation)
	if delegation["delegation"].(map[string]any)["status"] != "active" {
		t.Fatalf("expected active delegation: %v", delegation)
	}
	var rental map[string]any
	doJSON(t, http.MethodPost, server.URL+"/resource-market/rent", map[string]any{"address": "ynx_builder", "provider": "ynx_provider", "bandwidth": 100, "compute": 5, "aiCredits": 2, "trustCredits": 1}, http.StatusCreated, &rental)
	rentalObject := rental["rental"].(map[string]any)
	if rentalObject["provider"] != "ynx_provider" || rentalObject["providerIncomeYnxt"].(float64) <= 0 {
		t.Fatalf("expected provider income split: %v", rental)
	}
	var income map[string]any
	doJSON(t, http.MethodGet, server.URL+"/resource-market/income/ynx_provider", nil, http.StatusOK, &income)
	if len(income["income"].([]any)) != 1 {
		t.Fatalf("expected income record: %v", income)
	}
	var analytics map[string]any
	doJSON(t, http.MethodGet, server.URL+"/resource-market/analytics", nil, http.StatusOK, &analytics)
	if analytics["activeDelegationCount"].(float64) != 1 || analytics["resourceRentalCount"].(float64) != 1 {
		t.Fatalf("expected resource analytics: %v", analytics)
	}

	source := "pragma solidity ^0.8.24; contract Demo { event Pinged(address indexed caller, uint256 value); function ping() public pure returns (uint256) { return 1; } }"
	var compiler map[string]any
	doJSON(t, http.MethodGet, server.URL+"/ide/compiler", nil, http.StatusOK, &compiler)
	if compiler["version"] != "0.8.24" || compiler["pinned"] != true || compiler["configHash"] == "" || compiler["productionCompilerEnabled"] != false {
		t.Fatalf("expected inspectable pinned compiler config: %v", compiler)
	}
	var compiled map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/compile", map[string]any{"name": "Demo", "source": source}, http.StatusOK, &compiled)
	if compiled["compilerMode"] == "" || compiled["runtimeMode"] == "" || compiled["artifactHash"] == "" || compiled["compilerConfigHash"] != compiler["configHash"] || compiled["artifactKind"] != "source-analyzer-artifact" {
		t.Fatalf("expected deterministic compile artifact metadata with pinned compiler config: %v", compiled)
	}
	compiledCompiler := compiled["compiler"].(map[string]any)
	if compiledCompiler["version"] != "0.8.24" || compiledCompiler["preferWasm"] != true || compiled["reproducibleBuild"] != false {
		t.Fatalf("expected pinned compiler metadata on compile result: %v", compiled)
	}
	compiledFunctions := compiled["functions"].([]any)
	if len(compiledFunctions) != 1 || compiledFunctions[0].(map[string]any)["signature"] != "ping()" {
		t.Fatalf("expected compile function ABI: %v", compiled)
	}
	var deployed map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/deploy", map[string]any{"deployer": "ynx_builder", "name": "Demo", "source": source}, http.StatusCreated, &deployed)
	contract := deployed["contract"].(map[string]any)
	address := contract["address"].(string)
	contractEvents := contract["events"].([]any)
	if len(contractEvents) != 1 || contractEvents[0].(map[string]any)["signature"] != "Pinged(address,uint256)" {
		t.Fatalf("expected contract event metadata: %v", contract)
	}
	deployTx := deployed["transaction"].(map[string]any)["hash"].(string)
	devnet.ProduceBlock()
	var verified map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/verify", map[string]any{"address": address, "source": source}, http.StatusOK, &verified)
	if verified["verified"] != true {
		t.Fatalf("expected verified contract: %v", verified)
	}
	if verified["verifierStatus"] != "source_hash_and_pinned_compiler_config_matched_local_artifact" || verified["compilerConfigHash"] != compiler["configHash"] || verified["reproducibleBuild"] != true {
		t.Fatalf("expected local verifier status: %v", verified)
	}
	var verifierEvidence map[string]any
	doJSON(t, http.MethodGet, server.URL+"/ide/verifier/"+address, nil, http.StatusOK, &verifierEvidence)
	if verifierEvidence["localServiceStatus"] != "local-verifier-evidence" || verifierEvidence["remotePublicProofStatus"] != "not_remote_public_proof" || verifierEvidence["artifactKind"] != "source-analyzer-artifact" {
		t.Fatalf("expected explicit local verifier evidence: %v", verifierEvidence)
	}
	doJSON(t, http.MethodGet, server.URL+"/contracts/"+address, nil, http.StatusOK, &verified)
	verifiedFunctions := verified["functions"].([]any)
	selector := verifiedFunctions[0].(map[string]any)["selector"].(string)
	var callResult map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/call", map[string]any{"address": address, "function": "ping"}, http.StatusOK, &callResult)
	if callResult["returnValue"] != "1" || callResult["encodedResult"] != "0x0000000000000000000000000000000000000000000000000000000000000001" {
		t.Fatalf("expected deterministic IDE call result: %v", callResult)
	}
	var out map[string]any
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 6, "method": "eth_call", "params": []any{map[string]any{"to": address, "data": selector}, "latest"}}, http.StatusOK, &out)
	if out["result"] != "0x0000000000000000000000000000000000000000000000000000000000000001" {
		t.Fatalf("expected deterministic eth_call result: %v", out)
	}
	verifiedEvents := verified["events"].([]any)
	topic := verifiedEvents[0].(map[string]any)["topic"].(string)
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 7, "method": "eth_getTransactionReceipt", "params": []any{deployTx}}, http.StatusOK, &out)
	receiptLogs := out["result"].(map[string]any)["logs"].([]any)
	if len(receiptLogs) < 3 {
		t.Fatalf("expected contract deploy receipt logs, got %v", out)
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 8, "method": "eth_getLogs", "params": []any{map[string]any{"address": address, "topics": []any{topic}}}}, http.StatusOK, &out)
	filtered := out["result"].([]any)
	if len(filtered) != 1 || filtered[0].(map[string]any)["address"] != address {
		t.Fatalf("expected filtered contract event log, got %v", out)
	}
}

func TestIDECompileUsesHardhatArtifactWhenSourceMatches(t *testing.T) {
	root := testRepoRoot(t)
	if _, err := os.Stat(root + "/artifacts/contracts/tokens/SampleYNXTCompatibleERC20.sol/SampleYNXTCompatibleERC20.json"); err != nil {
		t.Skip("hardhat artifact not built")
	}
	sourceBytes, err := os.ReadFile(root + "/contracts/tokens/SampleYNXTCompatibleERC20.sol")
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()

	var compiled map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/compile", map[string]any{"name": "SampleYNXTCompatibleERC20", "source": string(sourceBytes)}, http.StatusOK, &compiled)
	if compiled["artifactKind"] != "pinned-solc-bytecode-artifact" || compiled["deployedBytecodeHash"] == "" || compiled["compilerExecutionStatus"] != "matched_existing_hardhat_solc_0_8_24_artifact" {
		t.Fatalf("expected real hardhat compiler artifact metadata: %v", compiled)
	}
	compilerArtifact := compiled["compilerArtifact"].(map[string]any)
	if compilerArtifact["sourceName"] != "contracts/tokens/SampleYNXTCompatibleERC20.sol" || compilerArtifact["deployedBytecodeHash"] != compiled["deployedBytecodeHash"] {
		t.Fatalf("expected compiler artifact hashes to be exposed: %v", compiled)
	}
	deployer := "0x1111111111111111111111111111111111111111"
	if _, err := devnet.Faucet(deployer, 100); err != nil {
		t.Fatal(err)
	}
	var deployed map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/deploy", map[string]any{"deployer": deployer, "name": "SampleYNXTCompatibleERC20", "source": string(sourceBytes), "constructorArgs": []string{"1000000"}}, http.StatusCreated, &deployed)
	contract := deployed["contract"].(map[string]any)
	address := contract["address"].(string)
	constructorArgs := contract["constructorArgs"].([]any)
	if len(constructorArgs) != 1 || constructorArgs[0] != "1000000" {
		t.Fatalf("expected constructor args to be preserved in contract metadata: %v", contract)
	}
	runtimeStorage := contract["runtimeStorage"].(map[string]any)
	if runtimeStorage["0x0000000000000000000000000000000000000000000000000000000000000003"] != "0x00000000000000000000000000000000000000000000000000000000000f4240" {
		t.Fatalf("expected totalSupply constructor arg to seed canonical storage slot 3: %v", runtimeStorage)
	}
	var verified map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/verify", map[string]any{"address": address, "source": string(sourceBytes)}, http.StatusOK, &verified)
	if verified["verifierStatus"] != "source_hash_compiler_config_and_deployed_bytecode_matched_local_artifact" || verified["deployedBytecodeComparisonStatus"] != "matched_local_deployed_bytecode_hash" {
		t.Fatalf("expected deployed bytecode hash comparison status: %v", verified)
	}
	var evidence map[string]any
	doJSON(t, http.MethodGet, server.URL+"/ide/verifier/"+address, nil, http.StatusOK, &evidence)
	if evidence["localServiceStatus"] != "local-hardhat-artifact-verifier-evidence" || evidence["remotePublicProofStatus"] != "not_remote_public_proof" || evidence["artifactKind"] != "pinned-solc-bytecode-artifact" {
		t.Fatalf("expected hardhat verifier evidence endpoint: %v", evidence)
	}
	if evidence["deployedBytecodeComparisonStatus"] != "matched_local_deployed_bytecode_hash" || evidence["deployedBytecodeHash"] != verified["deployedBytecodeHash"] {
		t.Fatalf("expected verifier evidence hashes to match verified contract: %v verified=%v", evidence, verified)
	}
	functions := verified["functions"].([]any)
	var decimalsSelector string
	var totalSupplySelector string
	var balanceOfSelector string
	var transferSelector string
	for _, entry := range functions {
		fn := entry.(map[string]any)
		if fn["signature"] == "decimals()" {
			decimalsSelector = fn["selector"].(string)
			if decimalsSelector != "0x313ce567" || fn["bytecodeSelectorMatched"] != true || fn["selectorSource"] != "hardhat-ethers-keccak-selector-metadata" {
				t.Fatalf("expected hardhat ERC20 decimals selector evidence: %v", fn)
			}
		}
		if fn["signature"] == "totalSupply()" {
			totalSupplySelector = fn["selector"].(string)
			if totalSupplySelector != "0x18160ddd" || fn["bytecodeSelectorMatched"] != true || fn["selectorSource"] != "hardhat-ethers-keccak-selector-metadata" {
				t.Fatalf("expected hardhat ERC20 totalSupply selector evidence: %v", fn)
			}
		}
		if fn["signature"] == "balanceOf(address)" {
			balanceOfSelector = fn["selector"].(string)
			if balanceOfSelector != "0x70a08231" || fn["bytecodeSelectorMatched"] != true || fn["selectorSource"] != "hardhat-ethers-keccak-selector-metadata" {
				t.Fatalf("expected hardhat ERC20 balanceOf selector evidence: %v", fn)
			}
		}
		if fn["signature"] == "transfer(address,uint256)" {
			transferSelector = fn["selector"].(string)
			if transferSelector != "0xa9059cbb" || fn["bytecodeSelectorMatched"] != true || fn["selectorSource"] != "hardhat-ethers-keccak-selector-metadata" {
				t.Fatalf("expected hardhat ERC20 transfer selector evidence: %v", fn)
			}
		}
	}
	if decimalsSelector == "" {
		t.Fatalf("expected decimals() ABI function in verified hardhat artifact: %v", verified)
	}
	if totalSupplySelector == "" {
		t.Fatalf("expected totalSupply() ABI function in verified hardhat artifact: %v", verified)
	}
	if balanceOfSelector == "" {
		t.Fatalf("expected balanceOf(address) ABI function in verified hardhat artifact: %v", verified)
	}
	if transferSelector == "" {
		t.Fatalf("expected transfer(address,uint256) ABI function in verified hardhat artifact: %v", verified)
	}
	events := verified["events"].([]any)
	var transferTopic string
	for _, entry := range events {
		event := entry.(map[string]any)
		if event["signature"] == "Transfer(address,address,uint256)" {
			transferTopic = event["topic"].(string)
		}
	}
	if transferTopic == "" {
		t.Fatalf("expected Transfer event metadata in verified hardhat artifact: %v", verified)
	}
	var callResult map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/call", map[string]any{"address": address, "function": "decimals"}, http.StatusOK, &callResult)
	if callResult["returnValue"] != "18" || callResult["encodedResult"] != "0x0000000000000000000000000000000000000000000000000000000000000012" || callResult["executionStatus"] != "evm_opcode_interpreter_staticcall_subset" || callResult["executionEngine"] != "local-bounded-evm-opcode-interpreter" || callResult["bytecodeSelectorMatched"] != true {
		t.Fatalf("expected artifact-backed EVM opcode interpreter staticcall subset result: %v", callResult)
	}
	if callResult["opcodeStepCount"].(float64) <= 0 {
		t.Fatalf("expected opcode interpreter step evidence: %v", callResult)
	}
	var totalSupplyCall map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/call", map[string]any{"address": address, "function": "totalSupply"}, http.StatusOK, &totalSupplyCall)
	if totalSupplyCall["returnValue"] != "1000000" || totalSupplyCall["encodedResult"] != "0x00000000000000000000000000000000000000000000000000000000000f4240" || totalSupplyCall["executionStatus"] != "evm_opcode_interpreter_staticcall_subset" || totalSupplyCall["executionEngine"] != "local-bounded-evm-opcode-interpreter" {
		t.Fatalf("expected constructor-seeded totalSupply from EVM interpreter: %v", totalSupplyCall)
	}
	var out map[string]any
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 31, "method": "eth_call", "params": []any{map[string]any{"to": address, "data": decimalsSelector}, "latest"}}, http.StatusOK, &out)
	if out["result"] != "0x0000000000000000000000000000000000000000000000000000000000000012" {
		t.Fatalf("expected artifact-backed eth_call decimals result: %v", out)
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 32, "method": "eth_call", "params": []any{map[string]any{"to": address, "data": totalSupplySelector + strings.Repeat("0", 64)}, "latest"}}, http.StatusOK, &out)
	if out["result"] != "0x00000000000000000000000000000000000000000000000000000000000f4240" {
		t.Fatalf("expected artifact-backed eth_call totalSupply result from full calldata: %v", out)
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 33, "method": "eth_call", "params": []any{map[string]any{"to": address, "data": balanceOfSelector + strings.Repeat("0", 24) + strings.TrimPrefix(deployer, "0x")}, "latest"}}, http.StatusOK, &out)
	if out["result"] != "0x00000000000000000000000000000000000000000000000000000000000f4240" {
		t.Fatalf("expected artifact-backed eth_call balanceOf result from mapping/SHA3 storage: %v", out)
	}
	devnet.ProduceBlock()
	recipient := "0x2222222222222222222222222222222222222222"
	transferCalldata := transferSelector + strings.Repeat("0", 24) + strings.TrimPrefix(recipient, "0x") + strings.Repeat("0", 62) + "fa"
	var executed map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/execute", map[string]any{"caller": deployer, "address": address, "calldata": transferCalldata}, http.StatusOK, &executed)
	executedResult := executed["result"].(map[string]any)
	if executedResult["returnValue"] != "true" || executedResult["encodedResult"] != "0x0000000000000000000000000000000000000000000000000000000000000001" || executedResult["executionStatus"] != "bounded_local_evm_sstore_state_transition_subset" || executedResult["executionEngine"] != "local-bounded-evm-sstore-transition-interpreter" {
		t.Fatalf("expected bounded ERC20 transfer SSTORE state transition evidence: %v", executed)
	}
	if executedResult["stateTransition"] != "bytecode-subset-sstore-updated-local-storage-and-pending-contract-call-created" || executedResult["opcodeStepCount"].(float64) <= 0 || executedResult["logCount"].(float64) != 1 {
		t.Fatalf("expected bytecode subset state transition metadata: %v", executed)
	}
	storageWrites := executedResult["storageWrites"].([]any)
	if len(storageWrites) != 2 {
		t.Fatalf("expected two SSTORE writes for ERC20 transfer: %v", executed)
	}
	for _, write := range storageWrites {
		if write.(map[string]any)["opcode"] != "SSTORE" {
			t.Fatalf("expected SSTORE write evidence: %v", executed)
		}
	}
	tx := executed["transaction"].(map[string]any)
	if tx["hash"] == "" || tx["type"] != "contract_call" {
		t.Fatalf("expected pending contract_call tx for transfer: %v", tx)
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 34, "method": "eth_call", "params": []any{map[string]any{"to": address, "data": balanceOfSelector + strings.Repeat("0", 24) + strings.TrimPrefix(deployer, "0x")}, "latest"}}, http.StatusOK, &out)
	if out["result"] != "0x00000000000000000000000000000000000000000000000000000000000f4146" {
		t.Fatalf("expected sender balance to decrease after bounded transfer: %v", out)
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 35, "method": "eth_call", "params": []any{map[string]any{"to": address, "data": balanceOfSelector + strings.Repeat("0", 24) + strings.TrimPrefix(recipient, "0x")}, "latest"}}, http.StatusOK, &out)
	if out["result"] != "0x00000000000000000000000000000000000000000000000000000000000000fa" {
		t.Fatalf("expected recipient balance to increase after bounded transfer: %v", out)
	}
	block := devnet.ProduceBlock()
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 36, "method": "eth_getLogs", "params": []any{map[string]any{"fromBlock": hexQuantityForTest(block.Height), "toBlock": "latest", "address": address, "topics": []any{transferTopic}}}}, http.StatusOK, &out)
	logs := out["result"].([]any)
	if len(logs) != 1 || logs[0].(map[string]any)["transactionHash"] != tx["hash"] {
		t.Fatalf("expected filterable bounded transfer log: %v", out)
	}
}

func TestIDEExecuteSupportsGenericPinnedWriteCallSubset(t *testing.T) {
	root := testRepoRoot(t)
	if _, err := os.Stat(root + "/artifacts/contracts/devtools/SampleEVMWriteCounter.sol/SampleEVMWriteCounter.json"); err != nil {
		t.Skip("hardhat artifact not built")
	}
	sourceBytes, err := os.ReadFile(root + "/contracts/devtools/SampleEVMWriteCounter.sol")
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()

	deployer := "0x3333333333333333333333333333333333333333"
	if _, err := devnet.Faucet(deployer, 100); err != nil {
		t.Fatal(err)
	}
	var deployed map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/deploy", map[string]any{"deployer": deployer, "name": "SampleEVMWriteCounter", "source": string(sourceBytes), "constructorArgs": []string{"7"}}, http.StatusCreated, &deployed)
	contract := deployed["contract"].(map[string]any)
	address := contract["address"].(string)
	if contract["artifactKind"] != "pinned-solc-bytecode-artifact" {
		t.Fatalf("expected pinned counter artifact: %v", contract)
	}
	var countSelector string
	var incrementSelector string
	for _, entry := range contract["functions"].([]any) {
		fn := entry.(map[string]any)
		switch fn["signature"] {
		case "count()":
			countSelector = fn["selector"].(string)
		case "increment(uint256)":
			incrementSelector = fn["selector"].(string)
		}
	}
	if countSelector != "0x06661abd" || incrementSelector != "0x7cf5dab0" {
		t.Fatalf("expected counter selectors from hardhat metadata: count=%s increment=%s contract=%v", countSelector, incrementSelector, contract)
	}
	var countChangedTopic string
	for _, entry := range contract["events"].([]any) {
		event := entry.(map[string]any)
		if event["signature"] == "CountChanged(address,uint256)" {
			countChangedTopic = event["topic"].(string)
		}
	}
	if countChangedTopic == "" {
		t.Fatalf("expected CountChanged event metadata: %v", contract)
	}
	callerTopic := "0x" + strings.Repeat("0", 24) + strings.TrimPrefix(deployer, "0x")
	var out map[string]any
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 41, "method": "eth_call", "params": []any{map[string]any{"to": address, "data": countSelector}, "latest"}}, http.StatusOK, &out)
	if out["result"] != "0x0000000000000000000000000000000000000000000000000000000000000007" {
		t.Fatalf("expected constructor-seeded counter value: %v", out)
	}
	incrementByFive := incrementSelector + strings.Repeat("0", 63) + "5"
	var executed map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/execute", map[string]any{"caller": deployer, "address": address, "calldata": incrementByFive}, http.StatusOK, &executed)
	result := executed["result"].(map[string]any)
	if result["signature"] != "increment(uint256)" || result["returnValue"] != "12" || result["encodedResult"] != "0x000000000000000000000000000000000000000000000000000000000000000c" {
		t.Fatalf("expected generic increment return evidence: %v", executed)
	}
	if result["executionStatus"] != "bounded_local_evm_sstore_state_transition_subset" || result["executionEngine"] != "local-bounded-evm-sstore-transition-interpreter" || result["opcodeStepCount"].(float64) <= 0 || result["logCount"].(float64) != 1 {
		t.Fatalf("expected generic bounded write-call state transition evidence: %v", executed)
	}
	executionLogs := result["executionLogs"].([]any)
	if len(executionLogs) != 1 || executionLogs[0].(map[string]any)["opcode"] != "LOG2" || executionLogs[0].(map[string]any)["address"] != address {
		t.Fatalf("expected captured generic execution log: %v", executed)
	}
	logTopics := executionLogs[0].(map[string]any)["topics"].([]any)
	if len(logTopics) != 2 || logTopics[0] != countChangedTopic || logTopics[1] != callerTopic || executionLogs[0].(map[string]any)["data"] != "0x000000000000000000000000000000000000000000000000000000000000000c" {
		t.Fatalf("expected CountChanged execution log topics/data: %v", executed)
	}
	writes := result["storageWrites"].([]any)
	if len(writes) != 1 || writes[0].(map[string]any)["opcode"] != "SSTORE" || writes[0].(map[string]any)["newValue"] != "0x000000000000000000000000000000000000000000000000000000000000000c" {
		t.Fatalf("expected one counter SSTORE write to 12: %v", executed)
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 42, "method": "eth_call", "params": []any{map[string]any{"to": address, "data": countSelector}, "latest"}}, http.StatusOK, &out)
	if out["result"] != "0x000000000000000000000000000000000000000000000000000000000000000c" {
		t.Fatalf("expected counter value after /ide/execute: %v", out)
	}
	tx := executed["transaction"].(map[string]any)
	block := devnet.ProduceBlock()
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 43, "method": "eth_getLogs", "params": []any{map[string]any{"fromBlock": hexQuantityForTest(block.Height), "toBlock": "latest", "address": address, "topics": []any{countChangedTopic, callerTopic}}}}, http.StatusOK, &out)
	logs := out["result"].([]any)
	if len(logs) != 1 || logs[0].(map[string]any)["transactionHash"] != tx["hash"] || logs[0].(map[string]any)["data"] != "0x000000000000000000000000000000000000000000000000000000000000000c" {
		t.Fatalf("expected filterable CountChanged log after /ide/execute block production: %v", out)
	}
	incrementByThree := incrementSelector + strings.Repeat("0", 63) + "3"
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 43, "method": "eth_sendTransaction", "params": []any{map[string]any{"from": deployer, "to": address, "data": incrementByThree}}}, http.StatusOK, &out)
	if out["result"] == "" {
		t.Fatalf("expected eth_sendTransaction tx hash for generic bounded write call: %v", out)
	}
	genericTxHash := out["result"].(string)
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 44, "method": "eth_call", "params": []any{map[string]any{"to": address, "data": countSelector}, "latest"}}, http.StatusOK, &out)
	if out["result"] != "0x000000000000000000000000000000000000000000000000000000000000000f" {
		t.Fatalf("expected counter value after eth_sendTransaction: %v", out)
	}
	doJSON(t, http.MethodPost, server.URL+"/evm", map[string]any{"jsonrpc": "2.0", "id": 45, "method": "eth_getTransactionReceipt", "params": []any{genericTxHash}}, http.StatusOK, &out)
	receiptLogs := out["result"].(map[string]any)["logs"].([]any)
	foundCountChanged := false
	for _, entry := range receiptLogs {
		log := entry.(map[string]any)
		topics := log["topics"].([]any)
		if len(topics) == 2 && topics[0] == countChangedTopic && topics[1] == callerTopic && log["data"] == "0x000000000000000000000000000000000000000000000000000000000000000f" {
			foundCountChanged = true
		}
	}
	if !foundCountChanged {
		t.Fatalf("expected generic CountChanged log in eth_sendTransaction receipt: %v", out)
	}
}

func hexQuantityForTest(height uint64) string {
	const digits = "0123456789abcdef"
	if height == 0 {
		return "0x0"
	}
	out := make([]byte, 0, 16)
	for height > 0 {
		out = append([]byte{digits[height&0xf]}, out...)
		height >>= 4
	}
	return "0x" + string(out)
}

func testRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(dir + "/hardhat.config.ts"); err == nil {
			return dir
		}
		next := dir[:strings.LastIndex(dir, "/")]
		if next == "" || next == dir {
			t.Fatal("repo root not found")
		}
		dir = next
	}
}

func TestGovernanceAppealAndTransparencyAPI(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()

	var illegal map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "agency_case_api",
		"subject":     "ynx_api_subject",
		"action":      "ask to directly transfer user native YNXT",
		"assetType":   "YNXT",
		"scope":       "ynx_api_subject",
		"description": "transfer user native YNXT without user signature",
	}, http.StatusCreated, &illegal)
	if illegal["classification"] != "ILLEGAL_OR_ABUSIVE" || illegal["status"] != "rejected" {
		t.Fatalf("expected illegal rejected request: %v", illegal)
	}
	if !stringSliceContains(illegal["ruleIds"].([]any), "protect-private-secrets") && !stringSliceContains(illegal["ruleIds"].([]any), "native-ynxt-no-direct-freeze") {
		t.Fatalf("expected illegal request rule id: %v", illegal)
	}
	requestID := illegal["id"].(string)
	doJSON(t, http.MethodGet, server.URL+"/governance/requests/"+requestID, nil, http.StatusOK, &illegal)

	var rules map[string]any
	doJSON(t, http.MethodGet, server.URL+"/governance/request-validity-rules", nil, http.StatusOK, &rules)
	if !rulesContain(rules["rules"].([]any), "native-ynxt-no-direct-freeze") || !rulesContain(rules["rules"].([]any), "governance-review-user-rights") || !rulesContain(rules["rules"].([]any), "asset-type-boundary") || !rulesContain(rules["rules"].([]any), "user-notice-required") {
		t.Fatalf("expected inspectable request validity rules: %v", rules)
	}

	var review map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "merchant_case_api",
		"subject":     "ynx_api_subject",
		"action":      "risk label review",
		"assetType":   "stablecoin",
		"scope":       "single transfer",
		"description": "review scoped label",
		"evidence":    []string{"case:api", "tx:0xabc"},
	}, http.StatusCreated, &review)
	if review["classification"] != "REQUIRES_GOVERNANCE_REVIEW" {
		t.Fatalf("expected review classification: %v", review)
	}
	if !stringSliceContains(review["ruleIds"].([]any), "governance-review-user-rights") {
		t.Fatalf("expected governance review rule id: %v", review)
	}
	reviewID := review["id"].(string)
	doJSON(t, http.MethodPost, server.URL+"/governance/requests/"+reviewID+"/review", nil, http.StatusOK, &review)

	var manualReject map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "merchant_case_api",
		"subject":     "ynx_api_subject",
		"action":      "metadata correction",
		"assetType":   "evidence",
		"scope":       "single evidence packet",
		"description": "correct one evidence packet record with reviewer evidence",
		"evidence":    []string{"case:reject", "packet:1"},
	}, http.StatusCreated, &manualReject)
	rejectID := manualReject["id"].(string)
	doJSON(t, http.MethodPost, server.URL+"/governance/requests/"+rejectID+"/reject", map[string]any{"reason": "reviewer found the request outside the approved case scope"}, http.StatusOK, &manualReject)
	rejectedAt, ok := manualReject["rejectedAt"].(string)
	if manualReject["classification"] != "REJECTED" || manualReject["status"] != "rejected" || !ok || rejectedAt == "" {
		t.Fatalf("expected manual request rejection with rejectedAt: %v", manualReject)
	}
	if !stringSliceContains(manualReject["reasons"].([]any), "reviewer found the request outside the approved case scope") {
		t.Fatalf("expected manual rejection reason: %v", manualReject)
	}
	doJSON(t, http.MethodGet, server.URL+"/governance/requests/"+rejectID, nil, http.StatusOK, &manualReject)

	var notice map[string]any
	doJSON(t, http.MethodPost, server.URL+"/governance/requests", map[string]any{
		"requester":   "merchant_case_api",
		"subject":     "ynx_api_subject",
		"action":      "notify user about appeal notice",
		"assetType":   "trust_label",
		"scope":       "single address",
		"description": "create user notice and transparency notice",
		"evidence":    []string{"case:notice"},
	}, http.StatusCreated, &notice)
	if notice["classification"] != "REQUIRES_USER_NOTICE" || notice["status"] != "notice_required" {
		t.Fatalf("expected user notice classification: %v", notice)
	}
	if !stringSliceContains(notice["ruleIds"].([]any), "user-notice-required") {
		t.Fatalf("expected user notice rule id: %v", notice)
	}

	var appeal map[string]any
	doJSON(t, http.MethodPost, server.URL+"/trust/appeals", map[string]any{"requestId": reviewID, "subject": "ynx_api_subject", "appellant": "ynx_api_subject", "reason": "false positive", "evidence": []string{"owner proof"}}, http.StatusCreated, &appeal)
	if appeal["status"] != "SUBMITTED" {
		t.Fatalf("expected open appeal: %v", appeal)
	}
	appealID := appeal["id"].(string)
	doJSON(t, http.MethodGet, server.URL+"/trust/appeals/"+appealID, nil, http.StatusOK, &appeal)
	doJSON(t, http.MethodPost, server.URL+"/trust/appeals/"+appealID+"/resolve", map[string]any{"reviewer": "api_reviewer", "decision": "LABEL_REDUCED", "resolutionReason": "evidence reduced the confidence of the prior label"}, http.StatusOK, &appeal)
	if appeal["status"] != "LABEL_REDUCED" || appeal["reviewer"] != "api_reviewer" {
		t.Fatalf("expected resolved appeal: %v", appeal)
	}

	var tracking map[string]any
	doJSON(t, http.MethodPost, server.URL+"/trust/tracking-reviews", map[string]any{"requester": "merchant_api", "subject": "ynx_api_subject", "purpose": "single transaction screening", "queryType": "trace", "scope": "single transfer", "description": "purpose limited review", "evidence": []string{"case:api"}, "minimumNecessary": true, "confidenceBps": 7600, "expiryHours": 24}, http.StatusCreated, &tracking)
	if tracking["classification"] != "VALID_UNDER_YNX_CHAIN_LAW" || tracking["appealPath"] == "" {
		t.Fatalf("expected valid tracking review: %v", tracking)
	}
	if !stringSliceContains(tracking["ruleIds"].([]any), "tracking-purpose-limited-valid") {
		t.Fatalf("expected tracking rule id: %v", tracking)
	}
	doJSON(t, http.MethodGet, server.URL+"/trust/tracking-reviews/"+tracking["id"].(string), nil, http.StatusOK, &tracking)
	var blockedTracking map[string]any
	doJSON(t, http.MethodPost, server.URL+"/trust/tracking-reviews", map[string]any{"requester": "merchant_api", "subject": "ynx_api_subject", "purpose": "bulk profile all wallets", "queryType": "batch", "scope": "all wallets", "description": "mass tracking", "evidence": []string{"case:api"}, "minimumNecessary": false}, http.StatusCreated, &blockedTracking)
	if blockedTracking["classification"] != "OVERBROAD" || blockedTracking["status"] != "rejected" {
		t.Fatalf("expected overbroad tracking rejection: %v", blockedTracking)
	}

	var report map[string]any
	doJSON(t, http.MethodGet, server.URL+"/governance/transparency", nil, http.StatusOK, &report)
	if report["entryCount"].(float64) < 10 || report["rejectedCount"].(float64) < 3 || report["appealCount"].(float64) != 1 {
		t.Fatalf("expected transparency report counts: %v", report)
	}
}

func TestAIStreamIsSessionScoped(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()
	resp, err := http.Get(server.URL + "/ai/stream?session=session_a&q=hello")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(resp.Body)
	body := buf.String()
	if !strings.Contains(body, "session session_a") || !strings.Contains(body, "event: done") {
		t.Fatalf("bad stream: %s", body)
	}
}

func TestAIPermissionAndActionAuditFlow(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()

	var proposal map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ai/actions", map[string]any{"sessionId": "ai-api-session", "requester": "merchant_ops", "scope": "trust_label", "actionType": "risk label", "description": "Create a Trust label for a user"}, http.StatusCreated, &proposal)
	actionID := proposal["id"].(string)
	if proposal["executable"] != false || proposal["requiresApproval"] != true || proposal["auditHash"] == "" {
		t.Fatalf("expected non-executable audited AI action: %v", proposal)
	}
	var approvalError map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ai/actions/"+actionID+"/approve", map[string]any{"approver": "reviewer_1", "permissionId": "missing"}, http.StatusBadRequest, &approvalError)
	if approvalError["error"] == "" {
		t.Fatalf("expected approval error: %v", approvalError)
	}
	var permission map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ai/permissions", map[string]any{"sessionId": "ai-api-session", "requester": "merchant_ops", "scope": "trust_label", "purpose": "review scoped label action", "expiryHours": 2}, http.StatusCreated, &permission)
	if permission["auditHash"] == "" || permission["status"] != "active" {
		t.Fatalf("expected active AI permission: %v", permission)
	}
	doJSON(t, http.MethodGet, server.URL+"/ai/permissions/"+permission["id"].(string), nil, http.StatusOK, &permission)
	var approved map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ai/actions/"+actionID+"/approve", map[string]any{"approver": "reviewer_1", "permissionId": permission["id"]}, http.StatusOK, &approved)
	if approved["status"] != "approved" || approved["executable"] != true || approved["permissionId"] != permission["id"] {
		t.Fatalf("expected approved executable AI action: %v", approved)
	}
	var actions map[string]any
	doJSON(t, http.MethodGet, server.URL+"/ai/actions?sessionId=ai-api-session", nil, http.StatusOK, &actions)
	if len(actions["actions"].([]any)) != 1 {
		t.Fatalf("expected one AI action: %v", actions)
	}
	doJSON(t, http.MethodGet, server.URL+"/ai/actions/"+actionID, nil, http.StatusOK, &approved)
}

func TestIDEPreflightTruthfulFailure(t *testing.T) {
	result := preflightContract("Bad", "function nope() public {}")
	if result.OK {
		t.Fatal("expected preflight failure")
	}
	if !strings.Contains(result.TruthfulNote, "preflight") {
		t.Fatalf("missing truthful note: %s", result.TruthfulNote)
	}
}

func doJSON(t *testing.T, method, url string, body any, expected int, out any) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		t.Fatalf("expected status %d, got %d", expected, resp.StatusCode)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}

func stringSliceContains(values []any, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func rulesContain(values []any, expectedID string) bool {
	for _, value := range values {
		rule, ok := value.(map[string]any)
		if !ok {
			continue
		}
		if rule["id"] == expectedID {
			return true
		}
	}
	return false
}

func validatorJSONByAddress(validators []any, address string) map[string]any {
	for _, value := range validators {
		validator, ok := value.(map[string]any)
		if ok && validator["address"] == address {
			return validator
		}
	}
	return nil
}

func entriesContainTypeStatus(values []any, expectedType, expectedStatus string) bool {
	for _, value := range values {
		entry, ok := value.(map[string]any)
		if !ok {
			continue
		}
		if entry["type"] == expectedType && entry["status"] == expectedStatus {
			return true
		}
	}
	return false
}
