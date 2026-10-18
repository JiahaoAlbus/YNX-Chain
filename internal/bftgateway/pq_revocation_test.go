package bftgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// These fixtures use the real Application, real dual signatures and persisted
// execution. pqMockComet supplies HTTP/index transport only; it never replaces
// CheckTx, FinalizeBlock, Commit, policy admission or historical verification.
func commitGatewayRevocationBlock(t *testing.T, f *pqGatewayFixture, height int64, txs ...[]byte) {
	t.Helper()
	out, err := f.a.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(height, 0).UTC(), Txs: txs})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.TxResults) != len(txs) {
		t.Fatal("missing real execution results")
	}
	for _, result := range out.TxResults {
		if result.Code != 0 {
			t.Fatalf("real fixture transaction rejected: %+v", result)
		}
	}
	if _, err := f.a.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
}

func gatewayRevocationPolicy(t *testing.T, f *pqGatewayFixture, owner string) consensus.PQWalletAccountView {
	t.Helper()
	out, err := f.a.Query(context.Background(), &abcitypes.RequestQuery{Path: consensus.PQWalletAuthorizationPath + owner})
	if err != nil {
		t.Fatal(err)
	}
	var view consensus.PQWalletAccountView
	if out.Code != 0 || json.Unmarshal(out.Value, &view) != nil || view.CommittedHeight != out.Height {
		t.Fatalf("invalid committed policy: %+v", out)
	}
	if err := consensus.ValidatePQWalletAccountView(view, owner); err != nil {
		t.Fatal(err)
	}
	return view
}

func signGatewayRevocation(t *testing.T, key *ynxbatch.PrivateKey, intent ynxauth.RevocationIntent) []byte {
	t.Helper()
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	wire, err := (ynxauth.Revocation{Intent: intent, CurrentPQProof: signGatewayMember(t, key, intent.ChainID, intent.Owner, ynxauth.RevocationPurpose, message)}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func newGatewayRevocationFixture(t *testing.T) (*pqGatewayFixture, string, *secp256k1.PrivateKey) {
	t.Helper()
	f, path, classic := newGatewayMigrationFixture(t)
	commitGatewayRevocationBlock(t, f, 2, f.payload)
	policy := gatewayRevocationPolicy(t, f, f.owner)
	record := policy.Policy.Records[0]
	f.wire = signGatewayRevocation(t, f.key, ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: record.PKA, PKB: record.PKB, AuthorizingRevision: 1, ThroughRevision: 1, LedgerNonce: 2, ExecuteAt: 3, RevokeAt: 4})
	var err error
	f.payload, err = consensus.EncodePQTransaction(consensus.PQRevocationType, f.wire)
	if err != nil {
		t.Fatal(err)
	}
	return f, path, classic
}

func TestGatewayPQRevocationCurrentPairPendingRotationAndRestart(t *testing.T) {
	f, statePath, classic := newGatewayRevocationFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	route := "/accounts/" + f.owner + "/authorization/revoke"
	transferWire := signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 2, 2))
	setGatewayMemberOriginal(t, m, consensus.PQTransferType, transferWire, 3)
	code, transfer := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", transferWire)
	if code != http.StatusOK {
		t.Fatalf("real transfer before revocation: %d %+v", code, transfer)
	}
	newKey, newPublic, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer newKey.Destroy()
	rotationIntent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: newPublic.PKA, PKB: newPublic.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 3, ActivateAt: 7}
	message, err := rotationIntent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	rotationWire, err := (ynxauth.Migration{Intent: rotationIntent, CurrentPQProof: signGatewayMember(t, f.key, f.network, f.owner, ynxauth.MigrationPurpose, message), NewKeyProof: signGatewayWhole(t, newKey, f.network, f.owner, ynxauth.MigrationPurpose, [][]byte{message})}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	setGatewayMemberOriginal(t, m, consensus.PQMigrationType, rotationWire, 4)
	code, rotation := pqMemberPOST(t, server.URL, "/accounts/"+f.owner+"/authorization/migrate", rotationWire)
	if code != http.StatusOK {
		t.Fatalf("real pending rotation: %d %+v", code, rotation)
	}
	policy := gatewayRevocationPolicy(t, f, f.owner)
	current := policy.Policy.Records[0]
	intent := ynxauth.RevocationIntent{ChainID: f.network, Owner: f.owner, PKA: current.PKA, PKB: current.PKB, AuthorizingRevision: 1, ThroughRevision: 2, LedgerNonce: 4, ExecuteAt: 5, RevokeAt: 6}
	validWire := signGatewayRevocation(t, f.key, intent)
	before := queryPQGatewayAccount(t, f.a, f.owner)
	diskBefore, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"A", "B", "pending-pair", "omitted-pending", "nonce", "height"} {
		t.Run(name, func(t *testing.T) {
			badIntent, signer := intent, f.key
			switch name {
			case "pending-pair":
				badIntent.PKA, badIntent.PKB, badIntent.AuthorizingRevision = newPublic.PKA, newPublic.PKB, 2
				signer = newKey
			case "omitted-pending":
				badIntent.ThroughRevision = 1
			case "nonce":
				badIntent.LedgerNonce++
			case "height":
				badIntent.ExecuteAt++
				badIntent.RevokeAt++
			}
			bad := signGatewayRevocation(t, signer, badIntent)
			if name == "A" || name == "B" {
				revoke, err := ynxauth.DecodeRevocation(bad)
				if err != nil {
					t.Fatal(err)
				}
				member, err := ynxbatch.DecodeMember(revoke.CurrentPQProof)
				if err != nil {
					t.Fatal(err)
				}
				if name == "A" {
					member.Certificate.SigmaA[0] ^= 1
				} else {
					member.Certificate.SigmaB[0] ^= 1
				}
				revoke.CurrentPQProof, err = ynxbatch.EncodeMember(member)
				if err != nil {
					t.Fatal(err)
				}
				bad, err = revoke.Encode()
				if err != nil {
					t.Fatal(err)
				}
			}
			setGatewayMemberOriginal(t, m, consensus.PQRevocationType, bad, 5)
			code, rejected := pqMemberPOST(t, server.URL, route, bad)
			if code != http.StatusUnprocessableEntity || rejected.Status != "rejected" || rejected.Committed {
				t.Fatalf("invalid revocation became authority: %d %+v", code, rejected)
			}
			diskAfter, err := os.ReadFile(statePath)
			if err != nil || !bytes.Equal(diskBefore, diskAfter) || !reflect.DeepEqual(before, queryPQGatewayAccount(t, f.a, f.owner)) || !reflect.DeepEqual(policy, gatewayRevocationPolicy(t, f, f.owner)) {
				t.Fatal("rejected revocation changed balance, nonce, policy or persistent history")
			}
		})
	}
	setGatewayMemberOriginal(t, m, consensus.PQRevocationType, validWire, 5)
	code, revoked := pqMemberPOST(t, server.URL, route, validWire)
	if code != http.StatusOK {
		t.Fatalf("current pair could not revoke pending schedule: %d %+v", code, revoked)
	}
	assertGatewayMemberCommit(t, revoked, validWire, f.payload, 5, f.owner, f.owner, 0, 4)
	if revoked.Type != consensus.PQRevocationType || len(revoked.Transaction.LotFlows) != 1 {
		t.Fatal("revocation receipt lost actual fee flow")
	}
	after := queryPQGatewayAccount(t, f.a, f.owner)
	flow := revoked.Transaction.LotFlows[0]
	feeRecipient := ""
	for _, validator := range f.migration.Validators {
		if validator.Active {
			feeRecipient = validator.Address
			break
		}
	}
	if feeRecipient != "ynx_validator_0" {
		t.Fatal("positive fixture must preserve the original non-0x validator fee identity")
	}
	if after.Balance != before.Balance-1 || after.Nonce != 4 || after.ResourceUsage.BandwidthUsed != before.ResourceUsage.BandwidthUsed+1 || flow.From != f.owner || flow.To != feeRecipient || flow.Amount != 1 || before.Lots[flow.LotID]-after.Lots[flow.LotID] != 1 {
		t.Fatal("revocation fee, original lot, nonce or bandwidth was not executed exactly once")
	}
	view := gatewayRevocationPolicy(t, f, f.owner)
	if view.CommittedHeight != 5 || view.ExecutionHeight != 6 || view.CommittedAuthorizationStatus != "revocation_pending" || !view.CommittedPQSigningEnabled || view.AuthorizationStatus != "revoked" || view.PQSigningEnabled || len(view.Policy.Records) != 2 || len(view.Policy.Revocations) != 1 || view.Policy.Revocations[0].ThroughRevision != 2 {
		t.Fatalf("H registration/H+1 terminal boundary or retained schedule lost: %+v", view)
	}
	// No current, pending, classic or rotation fallback gains authority at H+1.
	for _, signer := range []*ynxbatch.PrivateKey{f.key, newKey} {
		wire := signGatewayMember(t, signer, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 5, 1))
		setGatewayMemberOriginal(t, m, consensus.PQTransferType, wire, 6)
		code, rejected := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", wire)
		if code != http.StatusUnprocessableEntity || rejected.Committed {
			t.Fatal("revoked current or pending key authorized H+1 transfer")
		}
	}
	whole := signGatewayWhole(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, [][]byte{f.message(t, 5, 1)})
	wholePayload, err := consensus.EncodePQTransaction(consensus.PQWholeType, whole)
	if err != nil {
		t.Fatal(err)
	}
	wholeCheck, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: wholePayload})
	if err != nil || wholeCheck.Code == 0 {
		t.Fatal("Whole bypassed terminal H+1 account authorization")
	}
	classicTx, err := consensus.NewSignedTransfer(classic, f.migration.Network.ChainID, f.recipient, 1, 5)
	if err != nil {
		t.Fatal(err)
	}
	classicPayload, err := consensus.EncodeSignedTransaction(classicTx)
	if err != nil {
		t.Fatal(err)
	}
	check, err := f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: classicPayload})
	if err != nil || check.Code == 0 {
		t.Fatal("classic authority reopened after terminal revocation")
	}
	rotationIntent.LedgerNonce, rotationIntent.ActivateAt = 5, 8
	message, err = rotationIntent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	postRevokeRotation, err := (ynxauth.Migration{Intent: rotationIntent, CurrentPQProof: signGatewayMember(t, f.key, f.network, f.owner, ynxauth.MigrationPurpose, message), NewKeyProof: signGatewayWhole(t, newKey, f.network, f.owner, ynxauth.MigrationPurpose, [][]byte{message})}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	setGatewayMemberOriginal(t, m, consensus.PQMigrationType, postRevokeRotation, 6)
	code, rejected := pqMemberPOST(t, server.URL, "/accounts/"+f.owner+"/authorization/migrate", postRevokeRotation)
	if code != http.StatusUnprocessableEntity || rejected.Committed || !reflect.DeepEqual(after, queryPQGatewayAccount(t, f.a, f.owner)) {
		t.Fatal("terminal revocation allowed rotation or consumed rejected state")
	}
	other := gatewayRevocationPolicy(t, f, f.recipient)
	if other.GlobalPolicyVersion != ynxauth.PolicyRevocationVersion || other.Policy.Version != ynxauth.PolicyVersion || len(other.Policy.Revocations) != 0 || other.AuthorizationStatus != "legacy" {
		t.Fatal("global v2 polluted another owner's complete projection")
	}
	otherKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), byte(216)))
	otherTx, err := consensus.NewSignedTransfer(otherKey, f.migration.Network.ChainID, f.owner, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	otherPayload, err := consensus.EncodeSignedTransaction(otherTx)
	if err != nil {
		t.Fatal(err)
	}
	check, err = f.a.CheckTx(context.Background(), &abcitypes.RequestCheckTx{Tx: otherPayload})
	if err != nil || check.Code != 0 {
		t.Fatalf("unrelated owner frozen by global v2: %+v %v", check, err)
	}
	commitGatewayRevocationBlock(t, f, 6, otherPayload)
	commitGatewayRevocationBlock(t, f, 7)
	stateBeforeRestart, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := consensus.NewPersistentApplication(f.migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	f.a = restarted
	m.mu.Unlock()
	stateAfterRestart, err := os.ReadFile(statePath)
	if err != nil || !bytes.Equal(stateBeforeRestart, stateAfterRestart) {
		t.Fatal("cold restore rewrote committed revocation state")
	}
	for _, original := range []PQMemberView{transfer, rotation, revoked} {
		for _, path := range []string{original.ReadbackURL, "/txs/" + original.ABCITransactionHash} {
			code, read := pqMemberGET(t, server.URL+path)
			if code != http.StatusOK || !reflect.DeepEqual(original, read) {
				t.Fatalf("cold original-height history changed: %s HTTP %d %+v", path, code, read)
			}
		}
	}
	view = gatewayRevocationPolicy(t, f, f.owner)
	if view.CommittedHeight != 7 || view.PQSigningEnabled || view.CommittedPQSigningEnabled || view.Policy.Records[1].ActiveFrom != 7 || len(view.Policy.Records) != 2 || len(view.Policy.Revocations) != 1 {
		t.Fatal("pending rotation resurrected revoked account after restart")
	}
	currentAfterRestart := queryPQGatewayAccount(t, f.a, f.owner)
	wire := signGatewayMember(t, newKey, f.network, f.owner, ynxauth.TransactionPurpose, f.message(t, 5, 1))
	setGatewayMemberOriginal(t, m, consensus.PQTransferType, wire, 8)
	code, rejected = pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", wire)
	if code != http.StatusUnprocessableEntity || rejected.Committed {
		t.Fatal("cancelled pending pair authorized after its original activation height")
	}
	// An explicit client replay is rejected by the existing execution history;
	// only GET resolves the original. No second fee or replacement proof is made.
	setGatewayMemberOriginal(t, m, consensus.PQRevocationType, validWire, 8)
	code, rejected = pqMemberPOST(t, server.URL, route, validWire)
	if code != http.StatusUnprocessableEntity || rejected.Committed || !reflect.DeepEqual(currentAfterRestart, queryPQGatewayAccount(t, f.a, f.owner)) {
		t.Fatal("exact original replay consumed revoked state")
	}
	stateAfterReplay, err := os.ReadFile(statePath)
	if err != nil || !bytes.Equal(stateBeforeRestart, stateAfterReplay) {
		t.Fatal("rejected post-restart signatures rewrote persisted history")
	}
}

func TestGatewayPQRevocationUnknownOriginalReadbackAndRestart(t *testing.T) {
	for _, mode := range []string{"connection-loss", "lost-response", "wrong-hash", "missing-data", "wrong-height", "wrong-id", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			f, path, _ := newGatewayRevocationFixture(t)
			m := newPQMock(t, f)
			m.mode = mode
			server := gatewayPQServer(t, m)
			code, view := pqMemberPOST(t, server.URL, "/accounts/"+f.owner+"/authorization/revoke", f.wire)
			if code != http.StatusAccepted || view.Status != "unknown" || view.Committed || view.Transaction != nil || view.Fee != 0 || view.Nonce != 0 || view.NativeTransactionHash != consensus.SignedTransactionHash(f.wire) || view.ABCITransactionHash != consensus.SignedTransactionHash(f.payload) || !bytes.Equal(view.Wire, f.wire) {
				t.Fatalf("uncertain revoke lost original or fabricated success: %d %+v", code, view)
			}
			restarted, err := consensus.NewPersistentApplication(f.migration, path)
			if err != nil {
				t.Fatal(err)
			}
			m.mu.Lock()
			f.a = restarted
			m.mu.Unlock()
			code, read := pqMemberGET(t, server.URL+view.ReadbackURL)
			if mode == "redirect" {
				if code != http.StatusAccepted || read.Committed || queryPQGatewayAccount(t, f.a, f.owner).Nonce != 1 {
					t.Fatal("unsubmitted revocation became committed")
				}
			} else {
				if code != http.StatusOK {
					t.Fatalf("committed UNKNOWN original not recoverable: %d %+v", code, read)
				}
				assertGatewayMemberCommit(t, read, f.wire, f.payload, 3, f.owner, f.owner, 0, 2)
				if queryPQGatewayAccount(t, f.a, f.owner).Balance != 98 {
					t.Fatal("UNKNOWN/restart duplicated fee")
				}
			}
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.posts != 1 {
				t.Fatal("UNKNOWN or original readback automatically resubmitted revocation")
			}
		})
	}
}

func TestGatewayPQRevocationRejectsRouteFramingAndBound(t *testing.T) {
	f, _, _ := newGatewayRevocationFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	route := "/accounts/" + f.owner + "/authorization/revoke"
	for _, path := range []string{"/accounts/" + f.recipient + "/authorization/revoke", "/accounts/" + strings.ToUpper(f.owner) + "/authorization/revoke", route + "?height=3"} {
		code, _ := pqMemberPOST(t, server.URL, path, f.wire)
		if code != http.StatusBadRequest {
			t.Fatalf("invalid revocation route accepted: %s HTTP %d", path, code)
		}
	}
	for _, wire := range [][]byte{nil, f.wire[:len(f.wire)-1], append(bytes.Clone(f.wire), 0)} {
		if code, _ := pqMemberPOST(t, server.URL, route, wire); code != http.StatusBadRequest {
			t.Fatalf("noncanonical revocation accepted: HTTP %d", code)
		}
	}
	if code, _ := pqMemberPOST(t, server.URL, route, make([]byte, ynxauth.MaxRevocationBytes+1)); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("protocol byte bound was enlarged: HTTP %d", code)
	}
	response, err := http.Post(server.URL+route, "application/json", bytes.NewReader(f.wire))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatal("non-wire content type accepted")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.posts != 0 {
		t.Fatal("invalid framing or route reached original broadcast")
	}
}

func TestGatewayPQRevocationReadbackRejectsMismatchedHistory(t *testing.T) {
	f, _, _ := newGatewayRevocationFixture(t)
	m := newPQMock(t, f)
	server := gatewayPQServer(t, m)
	code, original := pqMemberPOST(t, server.URL, "/accounts/"+f.owner+"/authorization/revoke", f.wire)
	if code != http.StatusOK {
		t.Fatalf("positive revocation: %d %+v", code, original)
	}
	for name, mutate := range map[string]func(*consensus.PQWalletHistoryView){
		"owner":        func(h *consensus.PQWalletHistoryView) { h.Transaction.From = f.recipient },
		"fee":          func(h *consensus.PQWalletHistoryView) { h.Transaction.Fee++ },
		"nonce":        func(h *consensus.PQWalletHistoryView) { h.Transaction.Nonce++ },
		"wire":         func(h *consensus.PQWalletHistoryView) { h.Transaction.Memo += "00" },
		"outer-hash":   func(h *consensus.PQWalletHistoryView) { h.ABCITransactionHash = h.Transaction.Hash },
		"import":       func(h *consensus.PQWalletHistoryView) { h.Source = "source_import" },
		"missing-flow": func(h *consensus.PQWalletHistoryView) { h.Transaction.LotFlows = nil },
		"duplicate-flow": func(h *consensus.PQWalletHistoryView) {
			h.Transaction.LotFlows = append(h.Transaction.LotFlows, h.Transaction.LotFlows[0])
		},
		"negative-flow":           func(h *consensus.PQWalletHistoryView) { h.Transaction.LotFlows[0].Amount = -1 },
		"foreign-payer":           func(h *consensus.PQWalletHistoryView) { h.Transaction.LotFlows[0].From = f.recipient },
		"invalid-payee":           func(h *consensus.PQWalletHistoryView) { h.Transaction.LotFlows[0].To = "not-an-account" },
		"wrong-canonical-payee":   func(h *consensus.PQWalletHistoryView) { h.Transaction.LotFlows[0].To = f.recipient },
		"missing-effects":         func(h *consensus.PQWalletHistoryView) { h.RevocationEffects = nil },
		"different-fee-recipient": func(h *consensus.PQWalletHistoryView) { h.RevocationEffects.FeeRecipient = f.recipient },
		"wrong-lot-identity":      func(h *consensus.PQWalletHistoryView) { h.RevocationEffects.FeeLot.LotID += "forged" },
		"rewritten-lot-origin":    func(h *consensus.PQWalletHistoryView) { h.RevocationEffects.FeeLot.Origin += "forged" },
		"rewritten-source-origin": func(h *consensus.PQWalletHistoryView) { h.RevocationEffects.SourceLot.Origin += "forged" },
		"rewritten-lot-risk":      func(h *consensus.PQWalletHistoryView) { h.RevocationEffects.FeeLot.RiskWeight++ },
		"rewritten-lot-amount":    func(h *consensus.PQWalletHistoryView) { h.RevocationEffects.FeeLot.Amount++ },
		"fee-event-outer-hash":    func(h *consensus.PQWalletHistoryView) { h.RevocationEffects.FeeEvent.TxHash = h.Transaction.Hash },
		"fee-event-recipient":     func(h *consensus.PQWalletHistoryView) { h.RevocationEffects.FeeEvent.Recipient = f.recipient },
		"fee-event-audit": func(h *consensus.PQWalletHistoryView) {
			h.RevocationEffects.FeeEvent.AuditHash = strings.Repeat("0", 64)
		},
		"missing-lot":     func(h *consensus.PQWalletHistoryView) { h.Transaction.LotFlows[0].LotID = "" },
		"sponsor":         func(h *consensus.PQWalletHistoryView) { h.Transaction.Sponsor = f.owner },
		"fake-log":        func(h *consensus.PQWalletHistoryView) { h.Transaction.Logs = []chain.EVMLog{{}} },
		"missing-history": func(h *consensus.PQWalletHistoryView) { h.Authorization.RecordsComplete = false },
		"erased-tombstone": func(h *consensus.PQWalletHistoryView) {
			h.Authorization.Policy.Revocations = nil
			h.Authorization.Policy.Version = ynxauth.PolicyVersion
			h.Authorization.GlobalPolicyVersion = ynxauth.PolicyVersion
			h.Authorization.AuthorizationStatus, h.Authorization.CommittedAuthorizationStatus = "active", "active"
			h.Authorization.PQSigningEnabled, h.Authorization.CommittedPQSigningEnabled = true, true
		},
		"tombstone":    func(h *consensus.PQWalletHistoryView) { h.Authorization.Policy.Revocations[0].ThroughRevision++ },
		"public-key":   func(h *consensus.PQWalletHistoryView) { h.Authorization.Policy.Records[0].PKB[0] ^= 1 },
		"query-height": func(h *consensus.PQWalletHistoryView) { h.Authorization.CommittedHeight++ },
	} {
		t.Run(name, func(t *testing.T) {
			m.mu.Lock()
			m.queryMutation = func(path string, data []byte) []byte {
				if strings.HasPrefix(path, consensus.PQWalletHistoryPath) {
					var history consensus.PQWalletHistoryView
					if err := json.Unmarshal(data, &history); err != nil {
						t.Error(err)
						return nil
					}
					mutate(&history)
					var err error
					data, err = json.Marshal(history)
					if err != nil {
						t.Error(err)
						return nil
					}
				}
				return data
			}
			m.mu.Unlock()
			code, read := pqMemberGET(t, server.URL+original.ReadbackURL)
			if code != http.StatusAccepted || read.Status != "unknown" || read.Committed || read.Transaction != nil || read.NativeTransactionHash != original.NativeTransactionHash {
				t.Fatalf("mismatched original became committed: %d %+v", code, read)
			}
		})
	}
	m.mu.Lock()
	m.queryMutation = nil
	posts := m.posts
	m.mu.Unlock()
	code, read := pqMemberGET(t, server.URL+original.ReadbackURL)
	if posts != 1 || code != http.StatusOK || !reflect.DeepEqual(read, original) {
		t.Fatal("mismatched readback retried or destroyed valid original")
	}
}
