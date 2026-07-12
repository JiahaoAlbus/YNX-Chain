package resourcegateway

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestBFTResourceGatewaySignsSerializesAndReplaysDelegations(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 101))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	fixture := newBFTResourceFixture(t, signer)
	upstream := httptest.NewServer(fixture)
	defer upstream.Close()
	service, err := New(Config{ChainURL: upstream.URL, APIKey: testAPIKey, UpstreamMode: UpstreamBFT, SignerKey: hex.EncodeToString(key.Serialize()), SignerAddress: signer, ChainID: 6423, AuditLog: t.TempDir() + "/audit.jsonl"})
	if err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"provider":"` + signer + `","beneficiary":"` + signer + `","amount":10,"idempotencyKey":"delegate-once"}`)
	response, err := service.Proxy(context.Background(), http.MethodPost, "/resource-market/delegations", "", body, "resource-bft-1")
	if err != nil || response.Status != http.StatusCreated {
		t.Fatalf("BFT delegation failed: %+v %v", response, err)
	}
	var wrapped struct {
		Delegation consensus.BFTResourceDelegation `json:"delegation"`
		Resources  chain.ResourceBalance           `json:"resources"`
	}
	if json.Unmarshal(response.Body, &wrapped) != nil || wrapped.Delegation.Provider != signer || wrapped.Resources.Address != signer {
		t.Fatalf("bad wrapped delegation: %s", response.Body)
	}

	replay, err := service.Proxy(context.Background(), http.MethodPost, "/resource-market/delegations", "", body, "resource-bft-2")
	if err != nil || replay.Status != http.StatusOK || fixture.currentNonce() != 1 {
		t.Fatalf("exact replay was not idempotent: %+v %v nonce=%d", replay, err, fixture.currentNonce())
	}
	changed := []byte(`{"beneficiary":"` + signer + `","amount":11,"idempotencyKey":"delegate-once"}`)
	conflict, err := service.Proxy(context.Background(), http.MethodPost, "/resource-market/delegations", "", changed, "resource-bft-3")
	if err != nil || conflict.Status != http.StatusConflict || fixture.currentNonce() != 1 {
		t.Fatalf("changed replay was not rejected: %+v %v", conflict, err)
	}
	malicious := []byte(`{"provider":"ynx_other","beneficiary":"` + signer + `","amount":1,"idempotencyKey":"bad-provider"}`)
	if _, err := service.Proxy(context.Background(), http.MethodPost, "/resource-market/delegations", "", malicious, "resource-bft-4"); err == nil {
		t.Fatal("BFT Resource gateway accepted caller-controlled provider")
	}

	const workers = 8
	var wg sync.WaitGroup
	errorsCh := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			payload := []byte(fmt.Sprintf(`{"beneficiary":"%s","amount":1,"idempotencyKey":"parallel-%d"}`, signer, i))
			result, err := service.Proxy(context.Background(), http.MethodPost, "/resource-market/delegations", "", payload, fmt.Sprintf("parallel-%d", i))
			if err != nil || result.Status != http.StatusCreated {
				errorsCh <- fmt.Errorf("worker %d: status=%d err=%v", i, result.Status, err)
			}
		}(i)
	}
	wg.Wait()
	close(errorsCh)
	for err := range errorsCh {
		t.Error(err)
	}
	if fixture.currentNonce() != workers+1 {
		t.Fatalf("serialized BFT nonce = %d, want %d", fixture.currentNonce(), workers+1)
	}
	rentalBody := []byte(`{"provider":"` + chain.ProtocolResourceProvider + `","bandwidth":100,"compute":10,"aiCredits":1,"trustCredits":1,"idempotencyKey":"rent-once"}`)
	rentalResponse, err := service.Proxy(context.Background(), http.MethodPost, "/resource-market/rent", "", rentalBody, "resource-rent-1")
	if err != nil || rentalResponse.Status != http.StatusCreated {
		t.Fatalf("BFT rental failed: status=%d err=%v body=%s", rentalResponse.Status, err, rentalResponse.Body)
	}
	var rentalWrapped struct {
		Rental    consensus.BFTResourceRental `json:"rental"`
		Resources chain.ResourceBalance       `json:"resources"`
	}
	if json.Unmarshal(rentalResponse.Body, &rentalWrapped) != nil || rentalWrapped.Rental.Address != signer || rentalWrapped.Rental.QuoteID == "" || rentalWrapped.Rental.PriceYNXT <= 0 {
		t.Fatalf("bad wrapped rental: %s", rentalResponse.Body)
	}
	nonceAfterRental := fixture.currentNonce()
	rentalReplay, err := service.Proxy(context.Background(), http.MethodPost, "/resource-market/rent", "", rentalBody, "resource-rent-2")
	if err != nil || rentalReplay.Status != http.StatusOK || fixture.currentNonce() != nonceAfterRental {
		t.Fatalf("exact rental replay was not idempotent: %+v %v", rentalReplay, err)
	}
	rentalChanged := []byte(`{"provider":"` + chain.ProtocolResourceProvider + `","bandwidth":101,"compute":10,"aiCredits":1,"trustCredits":1,"idempotencyKey":"rent-once"}`)
	rentalConflict, err := service.Proxy(context.Background(), http.MethodPost, "/resource-market/rent", "", rentalChanged, "resource-rent-3")
	if err != nil || rentalConflict.Status != http.StatusConflict || fixture.currentNonce() != nonceAfterRental {
		t.Fatalf("changed rental replay was not rejected: %+v %v", rentalConflict, err)
	}
	health := service.snapshotHealth(buildinfoForTest())
	if health.UpstreamMode != UpstreamBFT || health.SignerAddress != signer || health.TruthfulStatus != "signed-bft-resource-market-state-transition-gateway" {
		t.Fatalf("bad BFT health: %+v", health)
	}
}

func TestBFTResourceGatewayRequiresSecureMatchingSigner(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 102))
	signer, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	base := Config{ChainURL: "http://127.0.0.1:6420", APIKey: testAPIKey, UpstreamMode: UpstreamBFT, SignerAddress: signer}
	if _, err := New(base); err == nil {
		t.Fatal("BFT mode accepted missing signer key")
	}
	base.SignerKey = hex.EncodeToString(key.Serialize())
	base.SignerAddress = mustDifferentAddress(t, signer)
	if _, err := New(base); err == nil {
		t.Fatal("BFT mode accepted mismatched signer address")
	}
	path := t.TempDir() + "/signer.key"
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key.Serialize())), 0o644); err != nil {
		t.Fatal(err)
	}
	base.SignerKey, base.SignerKeyPath, base.SignerAddress = "", path, signer
	if _, err := New(base); err == nil {
		t.Fatal("BFT mode accepted group/world-readable signer file")
	}
}

type bftResourceFixture struct {
	t           *testing.T
	mu          sync.Mutex
	signer      string
	nonce       uint64
	policy      chain.ResourceMarketPolicy
	delegations []consensus.BFTResourceDelegation
	idempotency map[string]consensus.BFTResourceIdempotency
	rentals     map[string]consensus.BFTResourceRental
}

func newBFTResourceFixture(t *testing.T, signer string) *bftResourceFixture {
	return &bftResourceFixture{t: t, signer: signer, policy: chain.DefaultResourceMarketPolicy(), idempotency: map[string]consensus.BFTResourceIdempotency{}, rentals: map[string]consensus.BFTResourceRental{}}
}

func (f *bftResourceFixture) currentNonce() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return int(f.nonce)
}

func (f *bftResourceFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.URL.Path == "/status":
		_ = json.NewEncoder(w).Encode(map[string]any{"chainId": 6423, "height": 10 + f.nonce, "network": "YNX Testnet", "nativeCurrencySymbol": "YNXT"})
	case r.URL.Path == "/resource-market/policy":
		_ = json.NewEncoder(w).Encode(f.policy)
	case r.URL.Path == "/resource-market/quote":
		bandwidth, _ := strconv.ParseInt(r.URL.Query().Get("bandwidth"), 10, 64)
		compute, _ := strconv.ParseInt(r.URL.Query().Get("compute"), 10, 64)
		aiCredits, _ := strconv.ParseInt(r.URL.Query().Get("aiCredits"), 10, 64)
		trustCredits, _ := strconv.ParseInt(r.URL.Query().Get("trustCredits"), 10, 64)
		quote, err := chain.ResourceQuoteForPolicy(f.policy, r.URL.Query().Get("address"), bandwidth, compute, aiCredits, trustCredits, time.Date(2026, 7, 12, 16, 15, 0, 0, time.UTC))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(quote)
	case strings.HasPrefix(r.URL.Path, "/accounts/"):
		_ = json.NewEncoder(w).Encode(chain.ConsensusAccount{Address: f.signer, Balance: 1000, Nonce: f.nonce, Lots: map[string]int64{}})
	case strings.HasPrefix(r.URL.Path, "/resources/"):
		_ = json.NewEncoder(w).Encode(chain.ResourceBalance{Address: strings.TrimPrefix(r.URL.Path, "/resources/"), BandwidthLimit: 1000, ComputeLimit: 100, AICreditsLimit: 10, TrustLimit: 10, Staked: int64(f.nonce)})
	case r.URL.Path == "/resource-market/idempotency":
		record, ok := f.idempotency[r.URL.Query().Get("key")]
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(record)
	case strings.HasPrefix(r.URL.Path, "/resource-market/delegations/") && r.Method == http.MethodGet:
		_ = json.NewEncoder(w).Encode(f.delegations)
	case strings.HasPrefix(r.URL.Path, "/resource-market/rentals/") && r.Method == http.MethodGet:
		value, ok := f.rentals[strings.TrimPrefix(r.URL.Path, "/resource-market/rentals/")]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(value)
	case r.URL.Path == "/resource-market/delegations" && r.Method == http.MethodPost:
		raw, _ := io.ReadAll(r.Body)
		tx, err := consensus.DecodeSignedApplicationAction(raw)
		if err != nil || tx.Verify(6423) != nil || tx.Signer != f.signer || tx.Nonce != f.nonce+1 || tx.Action != consensus.ActionResourceDelegate {
			http.Error(w, "bad signed action", http.StatusUnprocessableEntity)
			return
		}
		var input consensus.ResourceDelegationPayload
		_ = json.Unmarshal(tx.Payload, &input)
		txHash := consensus.ApplicationActionHash(raw)
		record := consensus.BFTResourceDelegation{ResourceDelegation: chain.ResourceDelegation{ID: consensus.ApplicationActionRecordID("resource-delegation", txHash), Provider: f.signer, Beneficiary: input.Beneficiary, AmountYNXT: input.AmountYNXT, PolicyID: f.policy.ID, PolicyVersion: f.policy.Version, PolicyHash: f.policy.PolicyHash, Status: "active", CreatedAt: time.Now().UTC()}, Signer: f.signer, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: int64(11 + f.nonce), TxHash: txHash}
		f.nonce++
		f.delegations = append(f.delegations, record)
		f.idempotency[input.IdempotencyKey] = consensus.BFTResourceIdempotency{ID: consensus.ResourceIdempotencyID(f.signer, input.IdempotencyKey), Signer: f.signer, IdempotencyKey: input.IdempotencyKey, Action: tx.Action, RequestHash: input.RequestHash, ObjectType: "delegation", ObjectID: record.ID, TxHash: txHash}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(record)
	case r.URL.Path == "/resource-market/rent" && r.Method == http.MethodPost:
		raw, _ := io.ReadAll(r.Body)
		tx, err := consensus.DecodeSignedApplicationAction(raw)
		if err != nil || tx.Verify(6423) != nil || tx.Signer != f.signer || tx.Nonce != f.nonce+1 || tx.Action != consensus.ActionResourceRent {
			http.Error(w, "bad signed action", http.StatusUnprocessableEntity)
			return
		}
		var input consensus.ResourceRentalPayload
		_ = json.Unmarshal(tx.Payload, &input)
		quote, err := chain.ResourceQuoteForPolicy(f.policy, input.Address, input.Bandwidth, input.Compute, input.AICredits, input.TrustCredits, input.QuoteExpiresAt)
		if err != nil || quote.ID != input.QuoteID || quote.PriceYNXT > input.MaxPriceYNXT {
			http.Error(w, "bad quote", http.StatusUnprocessableEntity)
			return
		}
		txHash := consensus.ApplicationActionHash(raw)
		providerIncome := int64(0)
		protocolFee := quote.PriceYNXT
		record := consensus.BFTResourceRental{ResourceRental: chain.ResourceRental{ID: consensus.ApplicationActionRecordID("resource-rental", txHash), QuoteID: quote.ID, Address: f.signer, Provider: input.Provider, PriceYNXT: quote.PriceYNXT, ProviderIncomeYNXT: providerIncome, ProtocolFeeYNXT: protocolFee, PolicyID: f.policy.ID, PolicyVersion: f.policy.Version, PolicyHash: f.policy.PolicyHash, GovernanceStatus: f.policy.GovernanceStatus, Status: "active", CreatedAt: time.Now().UTC(), Bandwidth: input.Bandwidth, Compute: input.Compute, AICredits: input.AICredits, TrustCredits: input.TrustCredits}, Signer: f.signer, IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, BlockHeight: int64(11 + f.nonce), TxHash: txHash}
		f.nonce++
		f.rentals[record.ID] = record
		f.idempotency[input.IdempotencyKey] = consensus.BFTResourceIdempotency{ID: consensus.ResourceIdempotencyID(f.signer, input.IdempotencyKey), Signer: f.signer, IdempotencyKey: input.IdempotencyKey, Action: tx.Action, RequestHash: input.RequestHash, ObjectType: "rental", ObjectID: record.ID, TxHash: txHash}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(record)
	default:
		http.NotFound(w, r)
	}
}

func mustDifferentAddress(t *testing.T, value string) string {
	t.Helper()
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 103))
	address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if address == value {
		t.Fatal("test address collision")
	}
	return address
}

func buildinfoForTest() buildinfo.Info {
	return buildinfo.Info{Commit: "test", Release: "test", BuildTime: "test"}
}
