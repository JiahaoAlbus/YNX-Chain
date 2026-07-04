package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	doJSON(t, http.MethodPost, server.URL+"/trust/labels", map[string]any{"subject": "ynx_bob", "label": "reviewed", "riskWeightBps": 250, "source": "unit-test"}, http.StatusCreated, &label)
	var evidence map[string]any
	doJSON(t, http.MethodPost, server.URL+"/trust/evidence", map[string]any{"subject": "ynx_bob"}, http.StatusCreated, &evidence)
	if evidence["jsonHash"] == "" {
		t.Fatalf("expected evidence hash: %v", evidence)
	}
	doJSON(t, http.MethodGet, server.URL+"/trust/evidence/"+evidence["id"].(string), nil, http.StatusOK, &evidence)
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
	doJSON(t, http.MethodPost, server.URL+"/pay/intents", map[string]any{"merchant": "merchant_unit", "amount": 50}, http.StatusCreated, &intent)
	intentID := intent["id"].(string)
	var invoice map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/invoices", map[string]any{"intentId": intentID, "dueInHours": 12}, http.StatusCreated, &invoice)
	doJSON(t, http.MethodGet, server.URL+"/pay/invoices/"+invoice["id"].(string), nil, http.StatusOK, &invoice)
	var webhook map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/webhook-signatures", map[string]any{"intentId": intentID, "eventType": "payment_intent.created", "signingKey": "unit-test-key"}, http.StatusCreated, &webhook)
	if webhook["algorithm"] != "hmac-sha256" {
		t.Fatalf("unexpected webhook signature: %v", webhook)
	}
	var refund map[string]any
	doJSON(t, http.MethodPost, server.URL+"/pay/refunds", map[string]any{"intentId": intentID, "amount": 10, "reason": "unit"}, http.StatusCreated, &refund)

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

	source := "pragma solidity ^0.8.24; contract Demo { function ping() public pure returns (uint256) { return 1; } }"
	var deployed map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/deploy", map[string]any{"deployer": "ynx_builder", "name": "Demo", "source": source}, http.StatusCreated, &deployed)
	contract := deployed["contract"].(map[string]any)
	address := contract["address"].(string)
	var verified map[string]any
	doJSON(t, http.MethodPost, server.URL+"/ide/verify", map[string]any{"address": address, "source": source}, http.StatusOK, &verified)
	if verified["verified"] != true {
		t.Fatalf("expected verified contract: %v", verified)
	}
	doJSON(t, http.MethodGet, server.URL+"/contracts/"+address, nil, http.StatusOK, &verified)
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
	requestID := illegal["id"].(string)
	doJSON(t, http.MethodGet, server.URL+"/governance/requests/"+requestID, nil, http.StatusOK, &illegal)

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
	reviewID := review["id"].(string)
	doJSON(t, http.MethodPost, server.URL+"/governance/requests/"+reviewID+"/review", nil, http.StatusOK, &review)

	var appeal map[string]any
	doJSON(t, http.MethodPost, server.URL+"/trust/appeals", map[string]any{"requestId": reviewID, "subject": "ynx_api_subject", "appellant": "ynx_api_subject", "reason": "false positive", "evidence": []string{"owner proof"}}, http.StatusCreated, &appeal)
	if appeal["status"] != "open" {
		t.Fatalf("expected open appeal: %v", appeal)
	}
	doJSON(t, http.MethodGet, server.URL+"/trust/appeals/"+appeal["id"].(string), nil, http.StatusOK, &appeal)

	var report map[string]any
	doJSON(t, http.MethodGet, server.URL+"/governance/transparency", nil, http.StatusOK, &report)
	if report["entryCount"].(float64) < 4 || report["rejectedCount"].(float64) < 1 || report["appealCount"].(float64) != 1 {
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
