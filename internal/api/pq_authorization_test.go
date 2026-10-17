package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

type apiPQFixture struct {
	d         *chain.Devnet
	h         http.Handler
	dir       string
	classic   *secp256k1.PrivateKey
	key       *ynxbatch.PrivateKey
	public    ynxbatch.PublicKey
	owner, to string
	network   []byte
}

func apiPQMust(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func newAPIPQFixture(t *testing.T) *apiPQFixture {
	t.Helper()
	dir := t.TempDir()
	d, e := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	apiPQMust(t, e)
	classic, e := secp256k1.GeneratePrivateKey()
	apiPQMust(t, e)
	t.Cleanup(classic.Zero)
	owner, e := consensus.NativeAddress(classic.PubKey().SerializeCompressed())
	apiPQMust(t, e)
	k, public, e := ynxbatch.KeyGen()
	apiPQMust(t, e)
	t.Cleanup(k.Destroy)
	_, e = d.Faucet(owner, 1000)
	apiPQMust(t, e)
	apiPQMust(t, d.EnableAccountPQ(1))
	state, _ := d.AccountAuthorization(owner)
	return &apiPQFixture{d: d, h: NewServerWithConfig(d, ServerConfig{ResourceGatewayUpstreamKey: "pq-test-upstream"}), dir: dir, classic: classic, key: k, public: public, owner: owner, to: "0x3535353535353535353535353535353535353535", network: bytes.Clone(state.NetworkID)}
}
func (f *apiPQFixture) migration(t *testing.T) []byte {
	t.Helper()
	intent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: f.public.PKA, PKB: f.public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 2}
	message, e := intent.SigningBytes()
	apiPQMust(t, e)
	batch, e := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.MigrationPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	apiPQMust(t, e)
	defer batch.Discard()
	proof, e := batch.WholeWire()
	apiPQMust(t, e)
	digest := sha256.Sum256(message)
	wire, e := (ynxauth.Migration{Intent: intent, ClassicPublicKey: f.classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(f.classic, digest[:]).Serialize(), NewKeyProof: proof}).Encode()
	apiPQMust(t, e)
	return wire
}
func (f *apiPQFixture) member(t *testing.T, nonce uint64) []byte {
	t.Helper()
	message, e := (ynxauth.Transfer{ChainID: f.network, NativeChainID: uint64(f.d.Config().ChainID), From: f.owner, To: f.to, Amount: 2, Fee: 1, Nonce: nonce}).SigningBytes()
	apiPQMust(t, e)
	batch, e := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	apiPQMust(t, e)
	defer batch.Discard()
	m, e := ynxbatch.Extract(batch, 0)
	apiPQMust(t, e)
	wire, e := ynxbatch.EncodeMember(m)
	apiPQMust(t, e)
	return wire
}
func apiPQRequest(t *testing.T, h http.Handler, method, path, contentType string, body []byte, want int) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	r.Header.Set("X-YNX-Resource-Gateway-Upstream-Key", "pq-test-upstream")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != want {
		t.Fatalf("%s %s: status=%d want=%d body=%s", method, path, w.Code, want, w.Body.String())
	}
	return w
}
func apiPQJSON(t *testing.T, value any) []byte {
	t.Helper()
	b, e := json.Marshal(value)
	apiPQMust(t, e)
	return b
}
func apiPQDecode(t *testing.T, w *httptest.ResponseRecorder, out any) {
	t.Helper()
	apiPQMust(t, json.Unmarshal(w.Body.Bytes(), out))
}
func apiPQSnapshot(t *testing.T, d *chain.Devnet) []byte {
	t.Helper()
	raw, e := d.ReplicationSnapshotJSON()
	apiPQMust(t, e)
	var snapshot map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	apiPQMust(t, decoder.Decode(&snapshot))
	// Serialization time/integrity are not mutations. Everything else, including
	// account-policy history, lots, contracts and pending transactions, is compared.
	delete(snapshot, "savedAt")
	delete(snapshot, "stateIntegrity")
	return apiPQJSON(t, snapshot)
}
func apiPQUnchanged(t *testing.T, d *chain.Devnet, want []byte) {
	t.Helper()
	if !bytes.Equal(apiPQSnapshot(t, d), want) {
		t.Fatal("rejected API request changed authoritative ledger state")
	}
}

func TestPQHTTPMigrationTransferAndAllLegacyEntrypoints(t *testing.T) {
	f := newAPIPQFixture(t)
	route := "/accounts/" + f.owner + "/authorization"
	migration := f.migration(t)
	var registration struct {
		Owner, AlgorithmVersion string
		ExecutionHeight         uint64 `json:"executionHeight,string"`
		Records                 []struct{ PKA, PKB string }
	}
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodGet, route, "", nil, http.StatusOK), &registration)
	if registration.Owner != f.owner || registration.AlgorithmVersion != "legacy" || registration.ExecutionHeight != 1 {
		t.Fatal("incorrect pre-migration public policy")
	}
	before := apiPQSnapshot(t, f.d)
	apiPQRequest(t, f.h, http.MethodPost, route+"/migrate", "application/json", migration, http.StatusUnsupportedMediaType)
	apiPQRequest(t, f.h, http.MethodPost, route+"/migrate", "application/octet-stream", nil, http.StatusBadRequest)
	apiPQRequest(t, f.h, http.MethodPost, "/accounts/"+f.to+"/authorization/migrate", "application/octet-stream", migration, http.StatusBadRequest)
	apiPQRequest(t, f.h, http.MethodPost, "/transactions/pq/broadcast", "application/octet-stream", make([]byte, (128<<10)+1), http.StatusRequestEntityTooLarge)
	apiPQUnchanged(t, f.d, before)
	var admitted struct {
		Transaction      chain.Transaction
		Replayed         bool
		Status           string
		ActivationHeight uint64 `json:"activationHeight,string"`
		Revision         uint64 `json:"revision,string"`
		ExecutionHeight  uint64 `json:"executionHeight,string"`
	}
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, route+"/migrate", "application/octet-stream", migration, http.StatusOK), &admitted)
	if admitted.Replayed || admitted.Transaction.Hash == "" || admitted.Status != "registered_pending_activation" || admitted.ActivationHeight != 2 || admitted.Revision != 1 || admitted.ExecutionHeight != 1 {
		t.Fatal("migration response overstated activation or lost transaction")
	}
	migrationHash := admitted.Transaction.Hash
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodGet, route, "", nil, http.StatusOK), &registration)
	if registration.AlgorithmVersion != "legacy" || len(registration.Records) != 1 || registration.Records[0].PKA != hex.EncodeToString(f.public.PKA) || registration.Records[0].PKB != hex.EncodeToString(f.public.PKB) {
		t.Fatal("pending policy query lost full public keys or activated early")
	}
	wire := f.member(t, 2)
	before = apiPQSnapshot(t, f.d)
	apiPQRequest(t, f.h, http.MethodPost, "/transactions/pq/broadcast", "application/octet-stream", wire, http.StatusUnprocessableEntity)
	apiPQUnchanged(t, f.d, before)
	f.d.ProduceBlock()
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodGet, route, "", nil, http.StatusOK), &registration)
	if registration.AlgorithmVersion != ynxbatch.Version || registration.ExecutionHeight != 2 {
		t.Fatal("activation was not reflected by the public query")
	}
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, "/transactions/pq/broadcast", "application/octet-stream", wire, http.StatusOK), &admitted)
	if admitted.Replayed || admitted.Transaction.Nonce != 2 || admitted.Transaction.From != f.owner || admitted.Status != "accepted" {
		t.Fatal("PQ-only API transfer failed")
	}
	txHash := admitted.Transaction.Hash
	sender, _ := f.d.Account(f.owner)
	recipient, _ := f.d.Account(f.to)
	if sender.Balance != 996 || sender.Nonce != 2 || recipient.Balance != 2 {
		t.Fatal("HTTP PQ transfer amount/fee/nonce mismatch")
	}
	apiPQMust(t, f.d.SetEthereumNativeTransfers(true))
	before = apiPQSnapshot(t, f.d)
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, "/transactions/pq/broadcast", "application/octet-stream", wire, http.StatusOK), &admitted)
	if !admitted.Replayed || admitted.Transaction.Hash != txHash {
		t.Fatal("exact transfer retry was not idempotent")
	}
	apiPQUnchanged(t, f.d, before)
	// New certificate means a new request identity; consumed nonce must still fail.
	apiPQRequest(t, f.h, http.MethodPost, "/transactions/pq/broadcast", "application/octet-stream", f.member(t, 2), http.StatusUnprocessableEntity)
	apiPQUnchanged(t, f.d, before)
	native, e := consensus.NewSignedTransfer(f.classic, f.d.Config().ChainID, f.to, 2, 3)
	apiPQMust(t, e)
	apiPQMust(t, native.Verify(f.d.Config().ChainID))
	nativeWire, e := consensus.EncodeSignedTransaction(native)
	apiPQMust(t, e)
	w := apiPQRequest(t, f.h, http.MethodPost, "/transactions/broadcast", "application/json", nativeWire, http.StatusUnprocessableEntity)
	if !strings.Contains(w.Body.String(), ynxauth.ErrPolicy.Error()) {
		t.Fatal("valid native signature failed before account-policy gate")
	}
	apiPQUnchanged(t, f.d, before)
	ethWire := apiPQEthereum(t, f.classic, f.d.Config().ChainID, f.to, 2)
	for name, payload := range map[string][]byte{"old Wallet native RPC": nativeWire, "Ethereum legacy RPC": ethWire} {
		t.Run(name, func(t *testing.T) {
			rpc := apiPQJSON(t, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": []any{"0x" + hex.EncodeToString(payload)}})
			resp := apiPQRequest(t, f.h, http.MethodPost, "/", "application/json", rpc, http.StatusOK)
			var decoded struct {
				Result any
				Error  *struct {
					Code    int
					Message string
				}
			}
			apiPQDecode(t, resp, &decoded)
			if decoded.Result != nil || decoded.Error == nil || !strings.Contains(decoded.Error.Message, ynxauth.ErrPolicy.Error()) {
				t.Fatalf("legacy RPC bypassed account policy: %s", resp.Body.String())
			}
			apiPQUnchanged(t, f.d, before)
		})
	}
	apiPQRequest(t, f.h, http.MethodPost, "/transfer", "application/json", apiPQJSON(t, map[string]any{"from": f.owner, "to": f.to, "amount": 2}), http.StatusForbidden)
	apiPQUnchanged(t, f.d, before)
	w = apiPQRequest(t, f.h, http.MethodPost, "/resource-market/delegations", "application/json", apiPQJSON(t, map[string]any{"provider": f.owner, "beneficiary": f.to, "amount": 2}), http.StatusBadRequest)
	if !strings.Contains(w.Body.String(), ynxauth.ErrPolicy.Error()) {
		t.Fatal("delegation did not reach account-policy gate")
	}
	apiPQUnchanged(t, f.d, before)
	action, e := consensus.NewSignedApplicationAction(f.classic, f.d.Config().ChainID, consensus.ActionDexAssetCreate, consensus.DexAssetCreatePayload{AssetID: "pq-http-token", Symbol: "PQT", Name: "PQ HTTP token", Decimals: 6, MaxSupply: 1000, InitialSupply: 100}, 3)
	apiPQMust(t, e)
	apiPQMust(t, action.Verify(f.d.Config().ChainID))
	actionWire, e := consensus.EncodeSignedApplicationAction(action)
	apiPQMust(t, e)
	w = apiPQRequest(t, f.h, http.MethodPost, "/dex/assets", "application/json", actionWire, http.StatusUnprocessableEntity)
	if !strings.Contains(w.Body.String(), ynxauth.ErrPolicy.Error()) {
		t.Fatal("valid DEX signature bypassed account policy")
	}
	apiPQUnchanged(t, f.d, before)
	pool := chain.ResourcePoolCreateInput{PoolType: "merchant", Name: "PQ HTTP resource gate", AllowedBeneficiaries: []string{f.to}, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 1}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 2}, ExpiresAt: time.Now().UTC().Add(time.Hour), IdempotencyKey: "pq-http-resource-gate"}
	pool.Authorization, e = chain.SignResourceAuthorization(f.classic, f.d.Config().ChainID, chain.ResourcePoolCreateAction, pool, 3)
	apiPQMust(t, e)
	w = apiPQRequest(t, f.h, http.MethodPost, "/resource-market/pools", "application/json", apiPQJSON(t, pool), http.StatusBadRequest)
	if !strings.Contains(w.Body.String(), ynxauth.ErrPolicy.Error()) {
		t.Fatal("valid resource authorization bypassed account policy")
	}
	apiPQUnchanged(t, f.d, before)
	apiPQDecode(t, apiPQRequest(t, f.h, http.MethodPost, route+"/migrate", "application/octet-stream", migration, http.StatusOK), &admitted)
	if !admitted.Replayed || admitted.Transaction.Hash != migrationHash || admitted.Status != "active" || admitted.ExecutionHeight != 2 {
		t.Fatal("old migration reconciliation lost stable identity or current activation status")
	}
	apiPQUnchanged(t, f.d, before)
	apiPQRequest(t, f.h, http.MethodPost, "/transactions/pq/broadcast", "application/octet-stream", f.member(t, 3), http.StatusOK)
	sender, _ = f.d.Account(f.owner)
	if sender.Balance != 993 || sender.Nonce != 3 {
		t.Fatal("rejections consumed the next legitimate PQ transaction")
	}
}

func TestPQHTTPUnknownResponseDoesNotLoseOrRepeatMutation(t *testing.T) {
	for _, kind := range []string{"migration", "transfer"} {
		t.Run(kind, func(t *testing.T) {
			f := newAPIPQFixture(t)
			path := "/accounts/" + f.owner + "/authorization/migrate"
			wire := f.migration(t)
			if kind == "transfer" {
				apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusOK)
				f.d.ProduceBlock()
				path = "/transactions/pq/broadcast"
				wire = f.member(t, 2)
			}
			// Obstruct only this temporary fixture's marker temp file after state rename.
			marker := filepath.Join(f.dir, "devnet-state.integrity-version.tmp")
			apiPQMust(t, os.Mkdir(marker, 0700))
			apiPQMust(t, os.WriteFile(filepath.Join(marker, "blocked"), []byte("test"), 0600))
			w := apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusServiceUnavailable)
			var response struct {
				Status, TransactionHash string
				Accepted                bool
				YNXDurability           struct{ Status string }
			}
			apiPQDecode(t, w, &response)
			digest := sha256.Sum256(wire)
			expectedHash := "0x" + hex.EncodeToString(digest[:])
			if response.Status != "transaction_durability_uncertain" || response.TransactionHash != expectedHash || response.Accepted || response.YNXDurability.Status != "uncertain" || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("HTTP UNKNOWN omitted original stable request identity")
			}
			if strings.Contains(w.Body.String(), f.dir) {
				t.Fatal("uncertain response exposed local filesystem")
			}
			before := apiPQSnapshot(t, f.d)
			tx, proof, found := f.d.TransactionWithDurability(expectedHash)
			if !found || tx.Hash != expectedHash || proof.Status != "uncertain" {
				t.Fatal("UNKNOWN mutation was erased or claimed durable")
			}
			w = apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusServiceUnavailable)
			apiPQDecode(t, w, &response)
			if response.TransactionHash != expectedHash || response.Status != "transaction_durability_uncertain" || response.Accepted || response.YNXDurability.Status != "uncertain" {
				t.Fatal("HTTP retry changed UNKNOWN identity")
			}
			apiPQUnchanged(t, f.d, before)
			apiPQMust(t, os.RemoveAll(marker))
			w = apiPQRequest(t, f.h, http.MethodPost, path, "application/octet-stream", wire, http.StatusOK)
			var recovered struct {
				Transaction chain.Transaction
				Replayed    bool
			}
			apiPQDecode(t, w, &recovered)
			if !recovered.Replayed || recovered.Transaction.Hash != expectedHash {
				t.Fatal("recovery did not reconcile original mutation")
			}
			apiPQUnchanged(t, f.d, before)
			account, _ := f.d.Account(f.owner)
			wantBalance, wantNonce := int64(999), uint64(1)
			if kind == "transfer" {
				wantBalance, wantNonce = 996, 2
			}
			if account.Balance != wantBalance || account.Nonce != wantNonce {
				t.Fatal("HTTP retry double-applied fee/nonce")
			}
			restarted, e := chain.NewPersistentDevnet(f.d.Config(), f.dir)
			apiPQMust(t, e)
			if !bytes.Equal(apiPQSnapshot(t, restarted), before) {
				t.Fatal("restart lost reconciled PQ ledger state")
			}
		})
	}
}

func apiPQRLPFrame(b []byte, short, long byte) []byte {
	if len(b) <= 55 {
		return append([]byte{short + byte(len(b))}, b...)
	}
	n := big.NewInt(int64(len(b))).Bytes()
	return append(append([]byte{long + byte(len(n))}, n...), b...)
}
func apiPQRLPList(fields [][]byte) []byte {
	var out []byte
	for _, b := range fields {
		if len(b) == 1 && b[0] < 128 {
			out = append(out, b...)
		} else {
			out = append(out, apiPQRLPFrame(b, 0x80, 0xb7)...)
		}
	}
	return apiPQRLPFrame(out, 0xc0, 0xf7)
}
func apiPQEthereum(t *testing.T, key *secp256k1.PrivateKey, chainID int64, to string, nonce uint64) []byte {
	t.Helper()
	recipient, e := hex.DecodeString(strings.TrimPrefix(to, "0x"))
	apiPQMust(t, e)
	fields := [][]byte{new(big.Int).SetUint64(nonce).Bytes(), big.NewInt(ethnative.GasPriceWei).Bytes(), new(big.Int).SetUint64(ethnative.TransferGas).Bytes(), recipient, ethnative.Wei(2).Bytes(), nil}
	signing := append(append([][]byte(nil), fields...), big.NewInt(chainID).Bytes(), nil, nil)
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(apiPQRLPList(signing))
	sig := ecdsa.SignCompact(key, h.Sum(nil), false)
	v := big.NewInt(chainID*2 + 35 + int64(sig[0]-27))
	raw := apiPQRLPList(append(fields, v.Bytes(), new(big.Int).SetBytes(sig[1:33]).Bytes(), new(big.Int).SetBytes(sig[33:]).Bytes()))
	decoded, e := ethnative.Verify(raw, chainID)
	apiPQMust(t, e)
	owner, e := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	apiPQMust(t, e)
	if decoded.From != owner || decoded.Nonce != nonce {
		t.Fatal("test Ethereum envelope signer mismatch")
	}
	return raw
}
