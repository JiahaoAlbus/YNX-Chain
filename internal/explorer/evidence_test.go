package explorer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestPublicEvidenceEnvelopeIsSourceBoundAndStable(t *testing.T) {
	blockTime := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	block := chain.Block{Height: 41, Hash: "0xblock41", ParentHash: "0xblock40", Time: blockTime, Validator: "ynx1validator"}

	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			writeJSON(w, http.StatusOK, Status{Network: "YNX Testnet", Slug: "testnet", ChainID: 6423, NativeCoinName: "YNX Token", NativeCurrencySymbol: "YNXT", Decimals: 18, Height: 42, LatestBlockHash: "0xblock42", LatestBlockTime: blockTime.Add(time.Second), TruthfulStatus: "rpc-backed"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer rpc.Close()

	indexerHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			writeJSON(w, http.StatusOK, IndexerHealth{OK: true, Service: "ynx-indexerd", Network: "YNX Testnet", ChainID: 6423, NativeSymbol: "YNXT", LastIndexedHeight: 41, LastSourceHeight: 42, IndexedBlockCount: 41, IndexedTxCount: 7, TruthfulStatus: "local-indexer"})
		case "/blocks/41":
			writeJSON(w, http.StatusOK, block)
		default:
			http.NotFound(w, r)
		}
	}))
	defer indexerHTTP.Close()

	svc, err := New(Config{RPCURL: rpc.URL, IndexerURL: indexerHTTP.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServerWithBuild(svc, buildinfo.Info{Commit: "source-sha", Release: "explorer-local-proof"}).Handler())
	defer server.Close()

	first := readEvidenceEnvelope(t, server.URL+"/api/evidence/block/41", http.StatusOK)
	second := readEvidenceEnvelope(t, server.URL+"/api/evidence/block/41", http.StatusOK)

	if first.SchemaVersion != publicEvidenceSchemaVersion || first.Kind != "block" || first.Subject != "41" {
		t.Fatalf("unexpected evidence identity: %+v", first)
	}
	if first.Source.Authority != "01-chain-core" || first.Source.TransportOwner != "12-explorer" || first.Source.Transport != "ynx-indexer" || first.Source.Path != "/api/blocks/41" || first.Source.Version != "not-declared-by-source" {
		t.Fatalf("source authority and transport are not separated: %+v", first.Source)
	}
	if first.Source.TransportVersion != "explorer-local-proof" || first.AsOfBasis != "source-event-time" || !first.AsOf.Equal(blockTime) {
		t.Fatalf("source timing/version metadata is incorrect: source=%+v asOf=%s basis=%s", first.Source, first.AsOf, first.AsOfBasis)
	}
	if first.Freshness.State != "partial" || !first.Freshness.Partial || first.Freshness.Offline || first.Freshness.LagBlocks != 1 || first.Coverage.Status != "partial" {
		t.Fatalf("indexer lag was not represented as partial evidence: freshness=%+v coverage=%+v", first.Freshness, first.Coverage)
	}
	if first.Correction.Status != "not-declared-by-source" || first.Integrity == nil || first.Integrity.Algorithm != "sha256" || len(first.Integrity.Digest) != 64 || !strings.HasSuffix(first.EvidenceID, first.Integrity.Digest) {
		t.Fatalf("correction/integrity metadata is incomplete: correction=%+v integrity=%+v id=%s", first.Correction, first.Integrity, first.EvidenceID)
	}
	if second.Integrity == nil || first.Integrity.Digest != second.Integrity.Digest || first.EvidenceID != second.EvidenceID {
		t.Fatalf("same source payload produced unstable integrity: first=%s second=%s", first.Integrity.Digest, second.Integrity.Digest)
	}
	payload, ok := first.Payload.(map[string]any)
	if !ok || payload["hash"] != block.Hash || payload["height"] != float64(block.Height) {
		t.Fatalf("evidence payload was not preserved: %#v", first.Payload)
	}
}

func TestPublicEvidencePreservesPayloadWhenFreshnessProbeFails(t *testing.T) {
	block := chain.Block{Height: 9, Hash: "0xblock9", Time: time.Date(2026, time.July, 27, 13, 0, 0, 0, time.UTC)}
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "rpc unavailable"})
	}))
	defer rpc.Close()
	indexerHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/blocks/9" {
			writeJSON(w, http.StatusOK, block)
			return
		}
		http.NotFound(w, r)
	}))
	defer indexerHTTP.Close()

	svc, err := New(Config{RPCURL: rpc.URL, IndexerURL: indexerHTTP.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(svc).Handler())
	defer server.Close()

	envelope := readEvidenceEnvelope(t, server.URL+"/api/evidence/block/9", http.StatusOK)
	if envelope.Payload == nil || envelope.Freshness.State != "unknown" || !envelope.Freshness.Partial || envelope.Freshness.Offline || envelope.Coverage.Status != "partial" {
		t.Fatalf("successful source payload was discarded or overstated after freshness failure: %+v", envelope)
	}
}

func TestPublicEvidenceFailsClosedWithVersionedErrors(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/txs/0xdead":
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "indexer unavailable"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	svc, err := New(Config{RPCURL: upstream.URL, IndexerURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(svc).Handler())
	defer server.Close()

	outage := readEvidenceEnvelope(t, server.URL+"/api/evidence/transaction/0xdead", http.StatusBadGateway)
	if outage.Error == nil || outage.Error.Code != "evidence_source_unavailable" || !outage.Error.Retryable || outage.Payload != nil || outage.Integrity != nil || outage.Freshness.State != "offline" || !outage.Freshness.Offline || outage.Coverage.Status != "unavailable" {
		t.Fatalf("upstream outage did not fail closed: %+v", outage)
	}
	if strings.Contains(outage.Error.Message, upstream.URL) {
		t.Fatalf("public error leaked internal upstream URL: %+v", outage.Error)
	}

	unsupported := readEvidenceEnvelope(t, server.URL+"/api/evidence/private-strategy/secret", http.StatusBadRequest)
	if unsupported.Error == nil || unsupported.Error.Code != "unsupported_evidence_kind" || unsupported.Error.Retryable || unsupported.Source.Authority != "unassigned" {
		t.Fatalf("unsupported evidence kind was not rejected safely: %+v", unsupported)
	}
}

func readEvidenceEnvelope(t *testing.T, endpoint string, expectedStatus int) PublicEvidenceEnvelope {
	t.Helper()
	response, err := http.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != expectedStatus {
		t.Fatalf("%s returned %d, expected %d", endpoint, response.StatusCode, expectedStatus)
	}
	if !strings.Contains(response.Header.Get("Cache-Control"), "no-store") {
		t.Fatalf("evidence response permits stale intermediary caching: %q", response.Header.Get("Cache-Control"))
	}
	var envelope PublicEvidenceEnvelope
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return envelope
}
