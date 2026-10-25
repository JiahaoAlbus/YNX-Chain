package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// This public interoperability export runs the real Application and Gateway.
// Only the configured Comet RPC transport/index is the existing test adapter;
// it does not run a Comet node, establish independent finality, or qualify any
// deployed source. Normal tests export nothing. Set YNX_PQ_WALLET_FIXTURE_OUT to
// one NEW absolute JSON file to export after all assertions pass. Existing files
// and partial outputs are never overwritten or silently removed.
type pqWalletPublicFixture struct {
	Version                     string                    `json:"version"`
	SourceKind                  string                    `json:"sourceKind"`
	SourceTest                  string                    `json:"sourceTest"`
	ApplicationExecution        string                    `json:"applicationExecution"`
	ActualCometNode             bool                      `json:"actualCometNode"`
	IndependentFinality         bool                      `json:"independentFinality"`
	DeployedSourceQualification bool                      `json:"deployedSourceQualification"`
	SyntheticOnly               bool                      `json:"syntheticOnly"`
	ProtocolVersion             string                    `json:"protocolVersion"`
	Suite                       string                    `json:"suite"`
	NativeChainID               string                    `json:"nativeChainId"`
	NetworkID                   string                    `json:"networkId"`
	Owner                       string                    `json:"owner"`
	Recipient                   string                    `json:"recipient"`
	RevocationIngress           string                    `json:"revocationIngress"`
	RevocationExecution         *pqWalletPublicRevocation `json:"revocationExecution,omitempty"`
	Originals                   []pqWalletPublicOriginal  `json:"originals"`
	HTTP                        []pqWalletPublicHTTP      `json:"http"`
}

type pqWalletPublicOriginal struct {
	Name                string          `json:"name"`
	Kind                string          `json:"kind"`
	NativeWireHash      string          `json:"nativeWireHash"`
	ABCITransactionHash string          `json:"abciTransactionHash"`
	Wire                []byte          `json:"wire"`     // JSON base64, byte-exact original
	ABCIWire            []byte          `json:"abciWire"` // canonical JSON bytes as base64, not pretty JSON
	ABCIEnvelope        json.RawMessage `json:"abciEnvelope"`
}

type pqWalletPublicHTTP struct {
	Name         string          `json:"name"`
	Method       string          `json:"method"`
	Path         string          `json:"path"` // relative route; no test-server URL
	Original     string          `json:"original,omitempty"`
	StatusCode   int             `json:"statusCode"`
	ContentType  string          `json:"contentType"`
	CacheControl string          `json:"cacheControl"`
	BodyWire     []byte          `json:"bodyWire"` // exact HTTP response bytes, JSON base64
	Body         json.RawMessage `json:"body"`     // actual gateway response, never synthesized
}

// These projections come from actual committed Application queries around the
// revoke POST. They are execution observations, not additional HTTP responses or
// independently authenticated state proofs. Every ledger integer stays exact.
type pqWalletPublicAccountState struct {
	Address       string            `json:"address"`
	Balance       string            `json:"balance"`
	Staked        string            `json:"staked"`
	Nonce         string            `json:"nonce"`
	ResourceUsage map[string]string `json:"resourceUsage"`
	Lots          map[string]string `json:"lots"`
}

// A presentation-only alias avoids applying the RPC's compact canonical JSON
// decoder to this export's indented JSON. No field or integer encoding changes.
type pqWalletPublicRevocationEffects consensus.PQWalletRevocationEffects

type pqWalletPublicRevocation struct {
	Source              string                          `json:"source"`
	NativeWireHash      string                          `json:"nativeWireHash"`
	ABCITransactionHash string                          `json:"abciTransactionHash"`
	OwnerBefore         pqWalletPublicAccountState      `json:"ownerBefore"`
	OwnerAfter          pqWalletPublicAccountState      `json:"ownerAfter"`
	FeeRecipientBefore  pqWalletPublicAccountState      `json:"feeRecipientBefore"`
	FeeRecipientAfter   pqWalletPublicAccountState      `json:"feeRecipientAfter"`
	Effects             pqWalletPublicRevocationEffects `json:"effects"`
}

func pqWalletFixtureAccountState(a chain.ConsensusAccount) pqWalletPublicAccountState {
	lots := make(map[string]string, len(a.Lots))
	for id, amount := range a.Lots {
		lots[id] = strconv.FormatInt(amount, 10)
	}
	u := a.ResourceUsage
	return pqWalletPublicAccountState{Address: a.Address, Balance: strconv.FormatInt(a.Balance, 10), Staked: strconv.FormatInt(a.Staked, 10), Nonce: strconv.FormatUint(a.Nonce, 10), Lots: lots, ResourceUsage: map[string]string{"bandwidthUsed": strconv.FormatInt(u.BandwidthUsed, 10), "computeUsed": strconv.FormatInt(u.ComputeUsed, 10), "aiCreditsUsed": strconv.FormatInt(u.AICreditsUsed, 10), "trustUsed": strconv.FormatInt(u.TrustUsed, 10), "payCreditsUsed": strconv.FormatInt(u.PayCreditsUsed, 10)}}
}

func pqWalletFixtureRevocationExecution(t *testing.T, a *consensus.Application, view PQMemberView, before, feeBefore chain.ConsensusAccount) *pqWalletPublicRevocation {
	t.Helper()
	assertGatewayPQPolicyFee(t, a, before, feeBefore, consensus.PQRevocationType, view.ABCITransactionHash, 6, 5)
	if view.Type != consensus.PQRevocationType || view.Transaction == nil || len(view.Transaction.LotFlows) != 1 {
		t.Fatal("revoke POST lost its exact executed fee flow")
	}
	flow := view.Transaction.LotFlows[0]
	after, feeAfter := queryPQGatewayAccount(t, a, before.Address), queryPQGatewayAccount(t, a, feeBefore.Address)
	if flow.From != before.Address || flow.To != feeBefore.Address || flow.Amount != 1 || before.Lots[flow.LotID]-after.Lots[flow.LotID] != 1 || feeAfter.Lots[flow.LotID]-feeBefore.Lots[flow.LotID] != 1 {
		t.Fatal("revoke POST fee flow differs from actual owner and recipient lot deltas")
	}
	// Compare the complete account shape too: the exact fee, nonce and bandwidth
	// changes cannot conceal changes to stake, other resources or unrelated lots.
	ownerExpected, recipientExpected := before, feeBefore
	ownerExpected.Lots, recipientExpected.Lots = make(map[string]int64, len(before.Lots)), make(map[string]int64, len(feeBefore.Lots))
	for id, amount := range before.Lots {
		ownerExpected.Lots[id] = amount
	}
	for id, amount := range feeBefore.Lots {
		recipientExpected.Lots[id] = amount
	}
	ownerExpected.Lots[flow.LotID]--
	recipientExpected.Lots[flow.LotID]++
	ownerExpected.Balance--
	recipientExpected.Balance++
	ownerExpected.Nonce++
	ownerExpected.ResourceUsage.BandwidthUsed++
	if !reflect.DeepEqual(ownerExpected, after) || !reflect.DeepEqual(recipientExpected, feeAfter) {
		t.Fatal("revoke POST changed state beyond its exact fee, nonce and bandwidth")
	}
	response, err := a.Query(context.Background(), &abcitypes.RequestQuery{Path: consensus.PQWalletHistoryPath + view.NativeTransactionHash})
	if err != nil || response == nil || response.Code != 0 || response.Height != 6 {
		t.Fatalf("actual revocation history query failed: %v", err)
	}
	var history consensus.PQWalletHistoryView
	if err := json.Unmarshal(response.Value, &history); err != nil {
		t.Fatal(err)
	}
	if history.Authorization.CommittedHeight != response.Height || history.ExecutionHeight != 6 || history.ABCITransactionHash != view.ABCITransactionHash || !reflect.DeepEqual(history.Transaction, *view.Transaction) {
		t.Fatal("revocation fee evidence detached from the actual HTTP original")
	}
	if err := consensus.ValidatePQWalletRevocationEffects(history); err != nil {
		t.Fatal(err)
	}
	return &pqWalletPublicRevocation{Source: "real-application-committed-query", NativeWireHash: view.NativeTransactionHash, ABCITransactionHash: view.ABCITransactionHash, OwnerBefore: pqWalletFixtureAccountState(before), OwnerAfter: pqWalletFixtureAccountState(after), FeeRecipientBefore: pqWalletFixtureAccountState(feeBefore), FeeRecipientAfter: pqWalletFixtureAccountState(feeAfter), Effects: pqWalletPublicRevocationEffects(*history.RevocationEffects)}
}

func (f *pqWalletPublicFixture) original(t *testing.T, name, kind string, wire []byte) pqWalletPublicOriginal {
	t.Helper()
	payload, err := consensus.EncodePQTransaction(kind, wire)
	if err != nil {
		t.Fatal(err)
	}
	o := pqWalletPublicOriginal{Name: name, Kind: kind, NativeWireHash: consensus.SignedTransactionHash(wire), ABCITransactionHash: consensus.SignedTransactionHash(payload), Wire: bytes.Clone(wire), ABCIWire: bytes.Clone(payload), ABCIEnvelope: bytes.Clone(payload)}
	if o.NativeWireHash == o.ABCITransactionHash {
		t.Fatal("native and ABCI identities unexpectedly coincide")
	}
	f.Originals = append(f.Originals, o)
	return o
}

func (f *pqWalletPublicFixture) capture(t *testing.T, endpoint, name, method, route, original string, wire []byte, expected int) json.RawMessage {
	t.Helper()
	request, err := http.NewRequest(method, endpoint+route, bytes.NewReader(wire))
	if err != nil {
		t.Fatal(err)
	}
	if method == http.MethodPost {
		request.Header.Set("Content-Type", "application/octet-stream")
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || len(body) > 2<<20 || !json.Valid(body) {
		t.Fatalf("%s invalid bounded HTTP JSON: %v", name, err)
	}
	if response.StatusCode != expected || response.Header.Get("Cache-Control") != "no-store" || !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
		t.Fatalf("%s: HTTP %d, expected %d, cache=%q", name, response.StatusCode, expected, response.Header.Get("Cache-Control"))
	}
	f.HTTP = append(f.HTTP, pqWalletPublicHTTP{Name: name, Method: method, Path: route, Original: original, StatusCode: response.StatusCode, ContentType: response.Header.Get("Content-Type"), CacheControl: response.Header.Get("Cache-Control"), BodyWire: bytes.Clone(body), Body: bytes.Clone(body)})
	return body
}

func pqWalletFixtureStrings(t *testing.T, body []byte, expected map[string]string) {
	t.Helper()
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		t.Fatal(err)
	}
	for key, want := range expected {
		var got string
		if err := json.Unmarshal(fields[key], &got); err != nil || got != want {
			t.Fatalf("%s must remain exact JSON string %q: %s", key, want, fields[key])
		}
	}
}

func pqWalletFixtureMember(t *testing.T, body []byte, original pqWalletPublicOriginal, height uint64, amount int64, nonce uint64, owner, recipient string) PQMemberView {
	t.Helper()
	var view PQMemberView
	if err := json.Unmarshal(body, &view); err != nil {
		t.Fatal(err)
	}
	assertGatewayMemberCommit(t, view, original.Wire, original.ABCIWire, height, owner, recipient, amount, nonce)
	pqWalletFixtureStrings(t, body, map[string]string{"amount": strconv.FormatInt(amount, 10), "fee": "1", "nonce": strconv.FormatUint(nonce, 10), "executionHeight": strconv.FormatUint(height, 10)})
	return view
}

func pqWalletFixtureAuthorization(t *testing.T, body []byte, owner, nextStatus, committedStatus string, height int64, nonce uint64, records, revocations int) consensus.PQWalletAccountView {
	t.Helper()
	var view consensus.PQWalletAccountView
	if err := json.Unmarshal(body, &view); err != nil {
		t.Fatal(err)
	}
	if err := consensus.ValidatePQWalletAccountView(view, owner); err != nil {
		t.Fatal(err)
	}
	if view.Source != "comet-rpc" || view.RecordsView != "committed" || view.PolicyView != "next_execution" || view.AuthorizationStatus != nextStatus || view.CommittedAuthorizationStatus != committedStatus || view.CommittedHeight != height || view.LedgerNonce != nonce || view.Policy == nil || len(view.Policy.Records) != records || len(view.Policy.Revocations) != revocations {
		t.Fatalf("unexpected real authorization projection at H=%d: status=%s committed=%s", height, view.AuthorizationStatus, view.CommittedAuthorizationStatus)
	}
	pqWalletFixtureStrings(t, body, map[string]string{"nativeChainId": "6423", "committedHeight": strconv.FormatInt(height, 10), "executionHeight": strconv.FormatInt(height+1, 10), "ledgerNonce": strconv.FormatUint(nonce, 10)})
	var envelope struct {
		Policy struct {
			EnableAt    json.RawMessage   `json:"enableAt"`
			Records     []json.RawMessage `json:"records"`
			Revocations []json.RawMessage `json:"revocations"`
		} `json:"policy"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatal(err)
	}
	var enable string
	if err := json.Unmarshal(envelope.Policy.EnableAt, &enable); err != nil || enable != "2" {
		t.Fatal("policy activation lost decimal-string representation")
	}
	for i, raw := range envelope.Policy.Records {
		r := view.Policy.Records[i]
		pqWalletFixtureStrings(t, raw, map[string]string{"revision": strconv.FormatUint(r.Revision, 10), "registeredAt": strconv.FormatUint(r.RegisteredAt, 10), "activeFrom": strconv.FormatUint(r.ActiveFrom, 10), "ledgerNonce": strconv.FormatUint(r.LedgerNonce, 10)})
	}
	for i, raw := range envelope.Policy.Revocations {
		r := view.Policy.Revocations[i]
		pqWalletFixtureStrings(t, raw, map[string]string{"authorizingRevision": strconv.FormatUint(r.AuthorizingRevision, 10), "throughRevision": strconv.FormatUint(r.ThroughRevision, 10), "registeredAt": strconv.FormatUint(r.RegisteredAt, 10), "revokedFrom": strconv.FormatUint(r.RevokedFrom, 10), "ledgerNonce": strconv.FormatUint(r.LedgerNonce, 10)})
	}
	return view
}

func TestGatewayPQWalletPublicHTTPFixture(t *testing.T) {
	f, statePath, _ := newGatewayMigrationFixture(t)
	m := newPQMock(t, f)
	m.height = 2
	server := gatewayPQServer(t, m)
	fixture := pqWalletPublicFixture{Version: "YNX-PQ-WALLET-HTTP-FIXTURE/v2", SourceKind: "application-backed-test-rpc", SourceTest: "TestGatewayPQWalletPublicHTTPFixture", ApplicationExecution: "real CheckTx/FinalizeBlock/Commit/Query via Gateway transfer, migration and revocation HTTP POST and original GET handlers; test Comet RPC transport/index", SyntheticOnly: true, ProtocolVersion: ynxbatch.Version, Suite: ynxbatch.Suite, NativeChainID: "6423", NetworkID: hex.EncodeToString(f.network), Owner: f.owner, Recipient: f.recipient, RevocationIngress: "Gateway POST /accounts/{address}/authorization/revoke; native-wire-hash and ABCI-hash GET after actual Application Commit and cold restart"}
	authRoute := "/accounts/" + f.owner + "/authorization"
	migrateRoute := authRoute + "/migrate"
	transferRoute := "/transactions/pq/broadcast"
	initial := fixture.original(t, "initial-migration", consensus.PQMigrationType, f.wire)
	initialBalance := queryPQGatewayAccount(t, f.a, f.owner).Balance
	body := fixture.capture(t, server.URL, "authorization-before-migration", http.MethodGet, authRoute, "", nil, 200)
	pqWalletFixtureAuthorization(t, body, f.owner, "legacy", "legacy", 1, 0, 0, 0)
	body = fixture.capture(t, server.URL, "migration-committed", http.MethodPost, migrateRoute, initial.Name, initial.Wire, 200)
	initialView := pqWalletFixtureMember(t, body, initial, 2, 0, 1, f.owner, f.owner)
	body = fixture.capture(t, server.URL, "authorization-first-activation-boundary", http.MethodGet, authRoute, "", nil, 200)
	pqWalletFixtureAuthorization(t, body, f.owner, "active", "pending_activation", 2, 1, 1, 0)

	wire := signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 2, 7))
	transfer := fixture.original(t, "first-transfer", consensus.PQTransferType, wire)
	setGatewayMemberOriginal(t, m, transfer.Kind, wire, 3)
	body = fixture.capture(t, server.URL, "transfer-committed", http.MethodPost, transferRoute, transfer.Name, wire, 200)
	transferView := pqWalletFixtureMember(t, body, transfer, 3, 7, 2, f.owner, f.recipient)
	body = fixture.capture(t, server.URL, "transfer-abci-hash-readback", http.MethodGet, "/txs/"+transfer.ABCITransactionHash, transfer.Name, nil, 200)
	if got := pqWalletFixtureMember(t, body, transfer, 3, 7, 2, f.owner, f.recipient); !reflect.DeepEqual(got, transferView) {
		t.Fatal("ABCI readback changed original transfer")
	}

	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	intent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 3, ActivateAt: 5}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	wire, err = (ynxauth.Migration{Intent: intent, CurrentPQProof: signGatewayMember(t, f.key, f.network, f.owner, ynxauth.MigrationPurpose, message), NewKeyProof: signGatewayWhole(t, key, f.network, f.owner, ynxauth.MigrationPurpose, [][]byte{message})}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	rotation := fixture.original(t, "rotation", consensus.PQMigrationType, wire)
	setGatewayMemberOriginal(t, m, rotation.Kind, wire, 4)
	body = fixture.capture(t, server.URL, "rotation-committed", http.MethodPost, migrateRoute, rotation.Name, wire, 200)
	pqWalletFixtureMember(t, body, rotation, 4, 0, 3, f.owner, f.owner)
	body = fixture.capture(t, server.URL, "authorization-pending-rotation", http.MethodGet, authRoute, "", nil, 200)
	view := pqWalletFixtureAuthorization(t, body, f.owner, "active", "active", 4, 3, 2, 0)
	if view.Policy.Records[1].ActiveFrom != 5 {
		t.Fatal("pending rotation boundary lost")
	}

	wire = signGatewayMember(t, key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 4, 1))
	recovered := fixture.original(t, "transfer-lost-response", consensus.PQTransferType, wire)
	setGatewayMemberOriginal(t, m, recovered.Kind, wire, 5)
	m.mu.Lock()
	m.mode = "lost-response"
	postsBefore := m.posts
	m.mu.Unlock()
	body = fixture.capture(t, server.URL, "transfer-outcome-unknown", http.MethodPost, transferRoute, recovered.Name, wire, 202)
	var unknown PQMemberView
	if err := json.Unmarshal(body, &unknown); err != nil {
		t.Fatal(err)
	}
	if unknown.Status != "unknown" || unknown.Committed || unknown.Transaction != nil || unknown.NativeTransactionHash != recovered.NativeWireHash || unknown.ABCITransactionHash != recovered.ABCITransactionHash || !bytes.Equal(unknown.Wire, wire) {
		t.Fatal("UNKNOWN lost exact original or fabricated execution")
	}
	body = fixture.capture(t, server.URL, "transfer-original-reconciled", http.MethodGet, unknown.ReadbackURL, recovered.Name, nil, 200)
	pqWalletFixtureMember(t, body, recovered, 5, 1, 4, f.owner, f.recipient)
	m.mu.Lock()
	postsAfter := m.posts
	m.mode = ""
	m.mu.Unlock()
	if postsAfter != postsBefore+1 {
		t.Fatal("UNKNOWN readback repeated the signed POST")
	}
	body = fixture.capture(t, server.URL, "authorization-after-rotation", http.MethodGet, authRoute, "", nil, 200)
	policyBeforeRevocation := pqWalletFixtureAuthorization(t, body, f.owner, "active", "active", 5, 4, 2, 0)

	revoke := ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, AuthorizingRevision: 2, ThroughRevision: 2, LedgerNonce: 5, ExecuteAt: 6, RevokeAt: 7}
	message, err = revoke.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	wire, err = (ynxauth.Revocation{Intent: revoke, CurrentPQProof: signGatewayMember(t, key, f.network, f.owner, ynxauth.RevocationPurpose, message)}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	revocation := fixture.original(t, "terminal-revocation", consensus.PQRevocationType, wire)
	feeRecipient := ""
	for _, validator := range f.migration.Validators {
		if validator.Active {
			feeRecipient = validator.Address
			break
		}
	}
	if feeRecipient != "ynx_validator_0" || feeRecipient == f.owner {
		t.Fatal("fixture must retain its real distinct non-0x validator fee recipient")
	}
	ownerBefore, feeBefore := queryPQGatewayAccount(t, f.a, f.owner), queryPQGatewayAccount(t, f.a, feeRecipient)
	setGatewayMemberOriginal(t, m, revocation.Kind, wire, 6)
	m.mu.Lock()
	revokePostsBefore := m.posts
	m.mu.Unlock()
	body = fixture.capture(t, server.URL, "revocation-committed", http.MethodPost, authRoute+"/revoke", revocation.Name, wire, 200)
	revocationView := pqWalletFixtureMember(t, body, revocation, 6, 0, 5, f.owner, f.owner)
	fixture.RevocationExecution = pqWalletFixtureRevocationExecution(t, f.a, revocationView, ownerBefore, feeBefore)
	m.mu.Lock()
	revokePostsAfter := m.posts
	m.mu.Unlock()
	if revokePostsAfter != revokePostsBefore+1 {
		t.Fatal("revocation did not use exactly one original HTTP broadcast")
	}
	body = fixture.capture(t, server.URL, "authorization-revocation-boundary", http.MethodGet, authRoute, "", nil, 200)
	policyAfterRevocation := pqWalletFixtureAuthorization(t, body, f.owner, "revoked", "revocation_pending", 6, 5, 2, 1)
	tombstone := policyAfterRevocation.Policy.Revocations[0]
	if !reflect.DeepEqual(policyBeforeRevocation.Policy.Records, policyAfterRevocation.Policy.Records) || tombstone.AuthorizingRevision != 2 || tombstone.ThroughRevision != 2 || tombstone.RegisteredAt != 6 || tombstone.RevokedFrom != 7 || tombstone.LedgerNonce != 5 {
		t.Fatal("revoke POST changed retained registration history or terminal execution boundary")
	}
	// Only the following empty block is direct: it advances the terminal policy
	// boundary, and is deliberately not recorded as a gateway transaction.
	commitGatewayRevocationBlock(t, f, 7)
	restarted, err := consensus.NewPersistentApplication(f.migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	f.a = restarted
	m.mu.Unlock()
	body = fixture.capture(t, server.URL, "authorization-revoked-after-restart", http.MethodGet, authRoute, "", nil, 200)
	view = pqWalletFixtureAuthorization(t, body, f.owner, "revoked", "revoked", 7, 5, 2, 1)
	if view.PQSigningEnabled || view.CommittedPQSigningEnabled {
		t.Fatal("revoked owner regained signing")
	}
	for _, old := range []struct {
		original pqWalletPublicOriginal
		view     PQMemberView
	}{{initial, initialView}, {transfer, transferView}, {revocation, revocationView}} {
		body = fixture.capture(t, server.URL, old.original.Name+"-history-after-revocation", http.MethodGet, old.view.ReadbackURL, old.original.Name, nil, 200)
		var got PQMemberView
		if err := json.Unmarshal(body, &got); err != nil || !reflect.DeepEqual(got, old.view) {
			t.Fatal("revocation/restart reinterpreted original committed history")
		}
	}
	body = fixture.capture(t, server.URL, "revocation-abci-hash-readback", http.MethodGet, "/txs/"+revocation.ABCITransactionHash, revocation.Name, nil, 200)
	if got := pqWalletFixtureMember(t, body, revocation, 6, 0, 5, f.owner, f.owner); !reflect.DeepEqual(got, revocationView) {
		t.Fatal("ABCI readback changed original revocation after restart")
	}
	m.mu.Lock()
	readbackPosts := m.posts
	m.mu.Unlock()
	if readbackPosts != revokePostsAfter {
		t.Fatal("revocation/history readback repeated a signed POST")
	}
	if !reflect.DeepEqual(fixture.RevocationExecution.OwnerAfter, pqWalletFixtureAccountState(queryPQGatewayAccount(t, f.a, f.owner))) || !reflect.DeepEqual(fixture.RevocationExecution.FeeRecipientAfter, pqWalletFixtureAccountState(queryPQGatewayAccount(t, f.a, feeRecipient))) {
		t.Fatal("activation/restart/readback changed committed revocation account effects")
	}
	account := queryPQGatewayAccount(t, f.a, f.owner)
	if account.Nonce != 5 || account.Balance != initialBalance-13 {
		t.Fatal("fixture duplicated/lost exact fees, transfers or nonce")
	}
	wire = signGatewayMember(t, key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 6, 1))
	rejectedOriginal := fixture.original(t, "transfer-after-revocation", consensus.PQTransferType, wire)
	setGatewayMemberOriginal(t, m, rejectedOriginal.Kind, wire, 8)
	body = fixture.capture(t, server.URL, "transfer-rejected-after-revocation", http.MethodPost, transferRoute, rejectedOriginal.Name, wire, 422)
	var rejected PQMemberView
	if err := json.Unmarshal(body, &rejected); err != nil || rejected.Status != "rejected" || rejected.Committed || rejected.Transaction != nil || rejected.NativeTransactionHash != rejectedOriginal.NativeWireHash || rejected.ABCITransactionHash != rejectedOriginal.ABCITransactionHash || !bytes.Equal(rejected.Wire, wire) {
		t.Fatal("revoked current-key request did not fail closed with its original identity")
	}
	if !reflect.DeepEqual(account, queryPQGatewayAccount(t, f.a, f.owner)) {
		t.Fatal("rejected revoked request mutated committed account")
	}
	if len(fixture.Originals) != 6 || len(fixture.HTTP) != 18 || fixture.ActualCometNode || fixture.IndependentFinality || fixture.DeployedSourceQualification || !fixture.SyntheticOnly {
		t.Fatal("fixture lost original observations or overstated its execution source")
	}
	fixture.export(t)
}

func (f pqWalletPublicFixture) export(t *testing.T) {
	t.Helper()
	if t.Failed() {
		t.Fatal("refusing to export observations from a failed fixture")
	}
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if len(data) > 8<<20 {
		t.Fatal("public fixture exceeds bounded export")
	}
	for _, forbidden := range []string{"/Users/", "/home/runner/", "http://127.0.0.1:", `"privateKey"`, `"secretKey"`, `"recoveryCredential"`, `"password"`, `"seed"`} {
		if bytes.Contains(data, []byte(forbidden)) {
			t.Fatalf("public fixture contains a private path/material field: %s", forbidden)
		}
	}
	// A marshal/unmarshal roundtrip must retain every original byte and hash.
	var decoded pqWalletPublicFixture
	if err := json.Unmarshal(data, &decoded); err != nil || len(decoded.Originals) != len(f.Originals) {
		t.Fatal("public export roundtrip failed")
	}
	if f.RevocationExecution == nil || !reflect.DeepEqual(decoded.RevocationExecution, f.RevocationExecution) {
		t.Fatal("public export altered actual revocation fee, lot or account observations")
	}
	for i, o := range decoded.Originals {
		if !bytes.Equal(o.Wire, f.Originals[i].Wire) || consensus.SignedTransactionHash(o.Wire) != o.NativeWireHash {
			t.Fatal("export altered original native wire")
		}
		// RawMessage indentation is JSON presentation only; the canonical ABCI
		// envelope is regenerated by the existing encoder, never hashed as pretty JSON.
		canonical, err := consensus.EncodePQTransaction(o.Kind, o.Wire)
		if err != nil || !bytes.Equal(canonical, o.ABCIWire) || !bytes.Equal(o.ABCIWire, f.Originals[i].ABCIWire) || consensus.SignedTransactionHash(o.ABCIWire) != o.ABCITransactionHash {
			t.Fatal("export altered canonical ABCI identity")
		}
	}
	if len(decoded.HTTP) != len(f.HTTP) {
		t.Fatal("public export lost HTTP observations")
	}
	for i, response := range decoded.HTTP {
		if !bytes.Equal(response.BodyWire, f.HTTP[i].BodyWire) {
			t.Fatal("export changed actual HTTP bytes")
		}
		var raw, view any
		// UseNumber preserves legacy transaction integers too; the client-facing
		// amount/fee/nonce and policy fields were separately asserted as strings.
		rawDecoder := json.NewDecoder(bytes.NewReader(response.BodyWire))
		rawDecoder.UseNumber()
		viewDecoder := json.NewDecoder(bytes.NewReader(response.Body))
		viewDecoder.UseNumber()
		if rawDecoder.Decode(&raw) != nil || viewDecoder.Decode(&view) != nil || !reflect.DeepEqual(raw, view) {
			t.Fatal("HTTP body projection differs from original bytes")
		}
	}
	path := os.Getenv("YNX_PQ_WALLET_FIXTURE_OUT")
	if path == "" {
		return
	}
	if !filepath.IsAbs(path) || strings.TrimSpace(path) != path {
		t.Fatal("fixture output must be an explicit absolute new file")
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := file.Write(data); err != nil || n != len(data) {
		_ = file.Close()
		t.Fatalf("public fixture write incomplete: %v", err)
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	t.Logf("PQ_WALLET_PUBLIC_FIXTURE version=%s bytes=%d sha256=%x sourceKind=%s actualCometNode=false", f.Version, len(data), sum, f.SourceKind)
}
