package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

func consensusPQProof(t *testing.T, key *ynxbatch.PrivateKey, network []byte, owner, purpose string, message []byte) (whole, member []byte) {
	t.Helper()
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: purpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	whole, err = batch.WholeWire()
	if err != nil {
		t.Fatal(err)
	}
	m, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		t.Fatal(err)
	}
	member, err = ynxbatch.EncodeMember(m)
	if err != nil {
		t.Fatal(err)
	}
	return whole, member
}

func TestABCIAccountPolicyRealMigrationTransferAndRestart(t *testing.T) {
	ctx := context.Background()
	classic := deterministicPrivateKey(81)
	owner := mustNativeAddress(t, classic)
	receiver := mustNativeAddress(t, deterministicPrivateKey(82))
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(owner, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "abci-state.json")
	a, err := NewPersistentApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	network, err := hex.DecodeString(migration.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owner, PKA: public.PKA, PKB: public.PKB, PriorRevision: 0, NewRevision: 1, LedgerNonce: 1, ActivateAt: 3}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	whole, _ := consensusPQProof(t, key, network, owner, ynxauth.MigrationPurpose, message)
	digest := sha256.Sum256(message)
	registration := ynxauth.Migration{Intent: intent, ClassicPublicKey: classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classic, digest[:]).Serialize(), NewKeyProof: whole}
	wire, err := registration.Encode()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodePQTransaction(PQMigrationType, wire)
	if err != nil {
		t.Fatal(err)
	}
	check, err := a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || check.Code != abcitypes.CodeTypeOK || len(a.committed.AccountPolicy.Records) != 0 {
		t.Fatalf("CheckTx changed policy or rejected authentic migration: %+v %v", check, err)
	}
	finalize := func(height int64, payload []byte) {
		t.Helper()
		result, err := a.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(height, 0).UTC(), Txs: [][]byte{payload}})
		if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != abcitypes.CodeTypeOK {
			t.Fatalf("finalization failed: %+v %v", result, err)
		}
		if _, err := a.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	finalize(2, payload)
	legacy, err := NewSignedTransfer(classic, migration.Network.ChainID, receiver, 7, 2)
	if err != nil {
		t.Fatal(err)
	}
	legacyWire, err := EncodeSignedTransaction(legacy)
	if err != nil {
		t.Fatal(err)
	}
	check, err = a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: legacyWire})
	if err != nil || check.Code == abcitypes.CodeTypeOK {
		t.Fatal("CheckTx used height zero and allowed classic spend after activation")
	}
	call := IDEContractCallPayload{Address: receiver, Calldata: "0x60fe47b1" + strings.Repeat("0", 64), IdempotencyKey: "pq-policy-evm-gate"}
	call.RequestHash = IDECallRequestHash(call.Address, call.Calldata, call.IdempotencyKey)
	action, err := NewSignedApplicationAction(classic, migration.Network.ChainID, ActionIDEContractCall, call, 2)
	if err != nil {
		t.Fatal(err)
	}
	actionWire, err := EncodeSignedApplicationAction(action)
	if err != nil {
		t.Fatal(err)
	}
	check, err = a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: actionWire})
	if err != nil || check.Code == abcitypes.CodeTypeOK || !strings.Contains(check.Log, "post-quantum") {
		t.Fatalf("EVM action bypassed active policy: %+v %v", check, err)
	}
	transfer := ynxauth.Transfer{ChainID: network, NativeChainID: uint64(migration.Network.ChainID), From: owner, To: receiver, Amount: 7, Fee: 1, Nonce: 2}
	message, err = transfer.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, wire = consensusPQProof(t, key, network, owner, ynxauth.TransactionPurpose, message)
	payload, err = EncodePQTransaction(PQTransferType, wire)
	if err != nil {
		t.Fatal(err)
	}
	check, err = a.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || check.Code != abcitypes.CodeTypeOK {
		t.Fatalf("valid dual PQ transfer rejected: %+v %v", check, err)
	}
	finalize(3, payload)
	restarted, err := NewPersistentApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	if len(restarted.committed.AccountPolicy.Records) != 1 || len(restarted.committed.PQHistory) != 2 {
		t.Fatal("restart lost policy or original proofs")
	}
	index, ok := accountIndex(restarted.committed.Accounts, receiver)
	if !ok || restarted.committed.Accounts[index].Balance != 7 {
		t.Fatal("PQ transfer did not execute")
	}
	if _, active := restarted.committed.AccountPolicy.PolicyAt(owner, 3); !active {
		t.Fatal("active policy regressed on restart")
	}
	bad := restarted.committed
	bad.AccountPolicy = nil
	if err := bad.Validate(migration); err == nil {
		t.Fatal("policy omission passed committed state validation")
	}
	check, err = restarted.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: payload})
	if err != nil || check.Code == abcitypes.CodeTypeOK {
		t.Fatal("committed PQ proof replay accepted")
	}
}

func TestABCIPQEnvelopeStrictCanonicalBoundary(t *testing.T) {
	payload, err := EncodePQTransaction(PQTransferType, []byte{0xab})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := DecodePQTransaction(payload); err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	for _, bad := range [][]byte{
		append(append([]byte(nil), payload...), []byte(" ")...),
		bytes.Replace(payload, []byte(`"version":1`), []byte(`"version":1,"version":1`), 1),
		bytes.Replace(payload, []byte(`"ab"`), []byte(`"AB"`), 1),
		bytes.Replace(payload, []byte(`"version":1`), []byte(`"version":2`), 1),
		bytes.Replace(payload, []byte(`"type":"pq_transfer"`), []byte(`"type":"pq_transfer","extra":true`), 1),
	} {
		if _, _, err := DecodePQTransaction(bad); err == nil {
			t.Fatal("noncanonical PQ transport accepted")
		}
	}
}
