package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestModuleHTTPReportsUncertainTransactionAndExactRetry(t *testing.T) {
	for _, action := range []string{"DEX", "create", "fund", "policy", "status", "sponsor"} {
		t.Run(action, func(t *testing.T) {
			dir := t.TempDir()
			d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
			if err != nil {
				t.Fatal(err)
			}
			ownerKey, userKey := apiResourceKey(93), apiResourceKey(94)
			owner, _ := consensus.NativeAddress(ownerKey.PubKey().SerializeCompressed())
			user, _ := consensus.NativeAddress(userKey.PubKey().SerializeCompressed())
			if _, err := d.Faucet(owner, 100); err != nil {
				t.Fatal(err)
			}
			if _, err := d.Faucet(user, 100); err != nil {
				t.Fatal(err)
			}
			create := chain.ResourcePoolCreateInput{PoolType: "merchant", Name: "durability fixture", AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 10}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 40}, ExpiresAt: time.Now().UTC().Add(time.Hour), IdempotencyKey: "durability-pool"}
			create.Authorization = apiResourceAuthorization(t, ownerKey, chain.ResourcePoolCreateAction, create, 1)
			var pool chain.ResourcePool
			if action != "DEX" && action != "create" {
				pool, _, err = d.CreateResourcePool(create)
				if err != nil {
					t.Fatal(err)
				}
			}
			d.ProduceBlock()
			var input any
			var payload []byte
			path := "/resource-market/pools"
			status := http.StatusOK
			switch action {
			case "DEX":
				path = "/dex/assets"
				payload = signedDexAction(t, ownerKey, consensus.ActionDexAssetCreate, consensus.DexAssetCreatePayload{AssetID: "uncertain-asset", Symbol: "UCA", Name: "Uncertain asset", MaxSupply: 1000, InitialSupply: 100}, 1)
			case "create":
				input = create
				status = http.StatusCreated
			case "fund":
				in := chain.ResourcePoolFundInput{PoolID: pool.ID, Additional: chain.ResourceUnits{Bandwidth: 5}, ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "durability-fund"}
				in.Authorization = apiResourceAuthorization(t, ownerKey, chain.ResourcePoolFundAction, in, 2)
				input = in
				path += "/" + pool.ID + "/fund"
			case "policy":
				in := chain.ResourcePoolPolicyInput{PoolID: pool.ID, AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"dapp_action", "pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 8}, ExpiresAt: time.Now().UTC().Add(2 * time.Hour), ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "durability-policy"}
				in.Authorization = apiResourceAuthorization(t, ownerKey, chain.ResourcePoolPolicyAction, in, 2)
				input = in
				path += "/" + pool.ID + "/policy"
			case "status":
				in := chain.ResourcePoolStatusInput{PoolID: pool.ID, Status: "revoked", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "durability-status"}
				in.Authorization = apiResourceAuthorization(t, ownerKey, chain.ResourcePoolStatusAction, in, 2)
				input = in
				path += "/" + pool.ID + "/status"
			case "sponsor":
				in := chain.ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 5, ActionReference: "durability-http", IdempotencyKey: "durability-sponsor"}
				in.Authorization = apiResourceAuthorization(t, userKey, chain.ResourceSponsorAction, in, 1)
				input = in
				path = "/resource-market/sponsorships"
				status = http.StatusCreated
			}
			if payload == nil {
				payload, err = json.Marshal(input)
				if err != nil {
					t.Fatal(err)
				}
			}
			marker := filepath.Join(dir, "devnet-state.integrity-version.tmp")
			if err := os.Mkdir(marker, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(marker, "blocker"), []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
			handler := NewServer(d)
			request := func() *httptest.ResponseRecorder {
				r := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
				r.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, r)
				return w
			}
			var hash string
			for i := 0; i < 2; i++ {
				response := request()
				var body map[string]any
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if response.Code != http.StatusServiceUnavailable || response.Header().Get("Cache-Control") != "no-store" || body["status"] != "transaction_durability_uncertain" || strings.Contains(response.Body.String(), dir) {
					t.Fatalf("bad uncertain response: %d %s", response.Code, response.Body)
				}
				current, ok := body["transactionHash"].(string)
				if !ok || len(current) != 66 {
					t.Fatal("missing transaction identity")
				}
				if hash != "" && current != hash {
					t.Fatal("retry changed transaction hash")
				}
				hash = current
				if _, ok := d.Transaction(hash); !ok {
					t.Fatal("uncertain transaction is unavailable for reconciliation")
				}
			}
			ownerBefore, _ := d.Account(owner)
			userBefore, _ := d.Account(user)
			pendingBefore := d.Status()["pendingTxCount"]
			if err := os.RemoveAll(marker); err != nil {
				t.Fatal(err)
			}
			response := request()
			var body struct {
				Transaction chain.Transaction `json:"transaction"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != status || body.Transaction.Hash != hash {
				t.Fatalf("repaired exact retry failed: %d %s", response.Code, response.Body)
			}
			ownerAfter, _ := d.Account(owner)
			userAfter, _ := d.Account(user)
			if !reflect.DeepEqual(ownerBefore, ownerAfter) || !reflect.DeepEqual(userBefore, userAfter) || d.Status()["pendingTxCount"] != pendingBefore {
				t.Fatal("exact retry repeated the mutation")
			}
		})
	}
}
