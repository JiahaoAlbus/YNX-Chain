package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

// All accounts and keys below are freshly generated research fixtures. Only a
// temporary local ledger is funded. No real Wallet, external RPC or secret is read.
type pqLedgerFixture struct {
	d         *Devnet
	classic   *secp256k1.PrivateKey
	key       *ynxbatch.PrivateKey
	public    ynxbatch.PublicKey
	owner, to string
	network   []byte
}

func pqMust(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func newPQLedger(t *testing.T) *pqLedgerFixture {
	t.Helper()
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	pqMust(t, err)
	classic, err := secp256k1.GeneratePrivateKey()
	pqMust(t, err)
	t.Cleanup(classic.Zero)
	owner, err := nativeResourceAddress(classic.PubKey().SerializeCompressed())
	pqMust(t, err)
	k, public, err := ynxbatch.KeyGen()
	pqMust(t, err)
	t.Cleanup(k.Destroy)
	_, err = d.Faucet(owner, 1000)
	pqMust(t, err)
	// Admission height 1 is scheduled while only the original genesis exists.
	pqMust(t, d.EnableAccountPQ(1))
	state, _ := d.AccountAuthorization(owner)
	if state == nil {
		t.Fatal("missing scheduled account policy")
	}
	return &pqLedgerFixture{d: d, classic: classic, key: k, public: public, owner: owner, to: "0x3535353535353535353535353535353535353535", network: bytes.Clone(state.NetworkID)}
}
func (f *pqLedgerFixture) migration(t *testing.T, activate, nonce uint64) []byte {
	t.Helper()
	intent := ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: f.public.PKA, PKB: f.public.PKB, NewRevision: 1, LedgerNonce: nonce, ActivateAt: activate}
	return pqClassicMigration(t, f.classic, f.key, intent)
}
func pqClassicMigration(t *testing.T, classic *secp256k1.PrivateKey, key *ynxbatch.PrivateKey, intent ynxauth.RegistrationIntent) []byte {
	t.Helper()
	message, err := intent.SigningBytes()
	pqMust(t, err)
	b, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: intent.ChainID, Owner: intent.Owner, Purpose: ynxauth.MigrationPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
	pqMust(t, err)
	defer b.Discard()
	whole, err := b.WholeWire()
	pqMust(t, err)
	digest := sha256.Sum256(message)
	m := ynxauth.Migration{Intent: intent, ClassicPublicKey: classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classic, digest[:]).Serialize(), NewKeyProof: whole}
	wire, err := m.Encode()
	pqMust(t, err)
	return wire
}
func (f *pqLedgerFixture) member(t *testing.T, nonce, amount uint64) []byte {
	t.Helper()
	return f.batchMember(t, nonce, amount, 1)
}
func (f *pqLedgerFixture) batchMember(t *testing.T, nonce, amount uint64, n int) []byte {
	t.Helper()
	message, err := (ynxauth.Transfer{ChainID: f.network, NativeChainID: uint64(f.d.cfg.ChainID), From: f.owner, To: f.to, Amount: amount, Fee: 1, Nonce: nonce}).SigningBytes()
	pqMust(t, err)
	messages := make([][]byte, n)
	for i := range messages {
		messages[i] = message
	}
	b, err := ynxbatch.BatchSign(f.key, ynxbatch.Metadata{ChainID: f.network, Owner: f.owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	pqMust(t, err)
	defer b.Discard()
	m, err := ynxbatch.Extract(b, 0)
	pqMust(t, err)
	wire, err := ynxbatch.EncodeMember(m)
	pqMust(t, err)
	return wire
}
func (f *pqLedgerFixture) activate(t *testing.T) []byte {
	t.Helper()
	wire := f.migration(t, 2, 1)
	tx, replayed, err := f.d.SubmitAccountMigration(wire)
	pqMust(t, err)
	if tx.Hash == "" || replayed {
		t.Fatal("migration did not create one durable transaction")
	}
	f.d.ProduceBlock()
	s, height := f.d.AccountAuthorization(f.owner)
	if _, ok := s.PolicyAt(f.owner, height); !ok {
		t.Fatal("account did not activate at next execution height")
	}
	return wire
}

func TestPQAccountMigrationActivationTransferAndRestart(t *testing.T) {
	f := newPQLedger(t)
	originalGenesis := f.d.blocks[0].Hash
	wire := f.member(t, 2, 7)
	before := moduleBusinessState(t, f.d)
	if _, _, err := f.d.SubmitPQTransfer(wire); err == nil {
		t.Fatal("unregistered double keys became account authority")
	}
	assertModuleState(t, f.d, before)
	migration := f.migration(t, 2, 1)
	if _, _, err := f.d.SubmitAccountMigration(f.migration(t, 2, 2)); err == nil {
		t.Fatal("migration did not require next ledger nonce")
	}
	assertModuleState(t, f.d, before)
	// A legitimate classic signature alone cannot replace either possession proof.
	for _, which := range []string{"classic", "A", "B"} {
		bad, err := ynxauth.DecodeMigration(migration)
		pqMust(t, err)
		if which == "classic" {
			bad.ClassicSignature[0] ^= 1
		} else {
			w, err := ynxbatch.DecodeWhole(bad.NewKeyProof)
			pqMust(t, err)
			if which == "A" {
				w.Certificate.SigmaA[10] ^= 1
			} else {
				w.Certificate.SigmaB[10] ^= 1
			}
			bad.NewKeyProof, err = ynxbatch.EncodeWhole(w)
			pqMust(t, err)
		}
		encoded, err := bad.Encode()
		pqMust(t, err)
		if _, _, err = f.d.SubmitAccountMigration(encoded); err == nil {
			t.Fatalf("missing %s authority accepted", which)
		}
		assertModuleState(t, f.d, before)
	}
	mtx, replayed, err := f.d.SubmitAccountMigration(migration)
	pqMust(t, err)
	if replayed || mtx.Nonce != 1 || mtx.Fee != 1 {
		t.Fatal("migration nonce/fee")
	}
	account, _ := f.d.Account(f.owner)
	if account.Balance != 999 || account.Nonce != 1 {
		t.Fatal("migration did not atomically consume one fee and nonce")
	}
	policy, height := f.d.AccountAuthorization(f.owner)
	if height != 1 || len(policy.Records) != 1 {
		t.Fatal("pending registration height")
	}
	if _, active := policy.PolicyAt(f.owner, height); active {
		t.Fatal("registration activated early")
	}
	if !bytes.Equal(policy.Records[0].PKA, f.public.PKA) || !bytes.Equal(policy.Records[0].PKB, f.public.PKB) {
		t.Fatal("registration lost complete public keys")
	}
	before = moduleBusinessState(t, f.d)
	if _, _, err = f.d.SubmitPQTransfer(wire); err == nil {
		t.Fatal("PQ accepted before account activation")
	}
	assertModuleState(t, f.d, before)
	f.d.ProduceBlock()
	tx, replayed, err := f.d.SubmitPQTransfer(wire)
	pqMust(t, err)
	if replayed || tx.Nonce != 2 || tx.Fee != 1 || tx.From != f.owner || tx.To != f.to {
		t.Fatal("PQ transfer execution identity")
	}
	account, _ = f.d.Account(f.owner)
	recipient, _ := f.d.Account(f.to)
	if account.Balance != 991 || account.Nonce != 2 || recipient.Balance != 7 {
		t.Fatal("PQ-only transfer balances/nonce differ")
	}
	before = moduleBusinessState(t, f.d)
	if retry, done, err := f.d.SubmitPQTransfer(wire); err != nil || !done || retry.Hash != tx.Hash {
		t.Fatal("exact-byte idempotent retry failed")
	}
	assertModuleState(t, f.d, before)
	// Fresh batch ID/signatures yield a different hash but the same consumed nonce.
	if _, _, err = f.d.SubmitPQTransfer(f.member(t, 2, 7)); err == nil {
		t.Fatal("new certificate replayed a consumed nonce")
	}
	assertModuleState(t, f.d, before)
	// A larger certificate remains valid cryptographically; business replay
	// protection is independent of the certificate's batch size.
	multi := f.batchMember(t, 2, 1, 2)
	validMulti, err := ynxbatch.DecodeMember(multi)
	pqMust(t, err)
	policy, height = f.d.AccountAuthorization(f.owner)
	pqMust(t, policy.VerifyMember(f.owner, ynxauth.TransactionPurpose, validMulti.Message, multi, height))
	if _, _, err = f.d.SubmitPQTransfer(multi); err == nil || !strings.Contains(err.Error(), "nonce") {
		t.Fatalf("standalone endpoint must reject an already consumed nonce: %v", err)
	}
	assertModuleState(t, f.d, before)
	validNext := f.member(t, 3, 1)
	for _, branch := range []string{"signature A", "signature B", "message"} {
		bad, err := ynxbatch.DecodeMember(validNext)
		pqMust(t, err)
		switch branch {
		case "signature A":
			bad.Certificate.SigmaA[10] ^= 1
		case "signature B":
			bad.Certificate.SigmaB[10] ^= 1
		case "message":
			changed, err := ynxauth.DecodeTransfer(bad.Message)
			pqMust(t, err)
			changed.Amount++
			bad.Message, err = changed.SigningBytes()
			pqMust(t, err)
		}
		badWire, err := ynxbatch.EncodeMember(bad)
		pqMust(t, err)
		if _, _, err = f.d.SubmitPQTransfer(badWire); err == nil {
			t.Fatalf("corrupt member %s accepted", branch)
		}
		assertModuleState(t, f.d, before)
	}
	// N=1 must have empty paths. Inject an extra node through the raw E grammar
	// because EncodeMember correctly refuses to manufacture invalid proof depth.
	for _, branch := range []int{1, 2} {
		fields, err := ynxbatch.DecodeFields(validNext, 4, ynxbatch.MaxMemberBytes)
		pqMust(t, err)
		proof, err := ynxbatch.DecodeFields(fields[3], 3, ynxbatch.MaxProofBytes)
		pqMust(t, err)
		proof[branch], err = ynxbatch.EncodeFields(make([]byte, 64))
		pqMust(t, err)
		fields[3], err = ynxbatch.EncodeFields(proof...)
		pqMust(t, err)
		badWire, err := ynxbatch.EncodeFields(fields...)
		pqMust(t, err)
		if _, _, err = f.d.SubmitPQTransfer(badWire); err == nil {
			t.Fatalf("extra node in membership path %d accepted", branch)
		}
		assertModuleState(t, f.d, before)
	}
	f.d.ProduceBlock()
	before = moduleBusinessState(t, f.d)
	restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, before)
	if restored.blocks[0].Hash != originalGenesis {
		t.Fatal("migration replaced original chain identity")
	}
	if err = restored.EnableAccountPQ(1); err != nil {
		t.Fatal(err)
	}
	if err = restored.EnableAccountPQ(2); err == nil {
		t.Fatal("restart rewrote protocol activation")
	}
	state, h := restored.AccountAuthorization(f.owner)
	record, ok := state.PolicyAt(f.owner, h)
	if !ok || record.Revision != 1 || !bytes.Equal(record.PKB, f.public.PKB) {
		t.Fatal("cold restart lost active double-key policy")
	}
	if _, _, err = restored.SubmitSignedTransfer(SignedTransferInput{Hash: "0x" + strings.Repeat("7", 64), From: f.owner, To: f.to, Amount: 1, Fee: 1, Nonce: 3}); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatalf("cold classic fallback: %v", err)
	}
	// Cold lookup/old exact replay must retain identity without charging again.
	if old, done, err := restored.SubmitAccountMigration(migration); err != nil || !done || old.Hash != mtx.Hash {
		t.Fatal("migration reconciliation identity changed")
	}
	assertModuleState(t, restored, before)
}

func TestPQEnableSameHeightMustReconfirmUnknownDurability(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	pqMust(t, err)
	unblock := blockSnapshotWrite(t, d.snapshotIntegrityMarkerPath()+".tmp")
	if err = d.EnableAccountPQ(1); !errors.Is(err, ErrSnapshotDurabilityUncertain) {
		t.Fatalf("schedule rename without marker acknowledgement must be UNKNOWN: %v", err)
	}
	state, height := d.AccountAuthorization("")
	if state == nil || state.EnableAt != 1 || height != 1 {
		t.Fatal("UNKNOWN schedule intent was lost")
	}
	retained := moduleBusinessState(t, d)
	if err = d.EnableAccountPQ(1); !errors.Is(err, ErrSnapshotDurabilityUncertain) {
		t.Fatalf("same in-memory height falsely proved durability: %v", err)
	}
	assertModuleState(t, d, retained)
	unblock()
	pqMust(t, d.EnableAccountPQ(1))
	assertModuleState(t, d, retained)
	restored, err := NewPersistentDevnet(d.cfg, d.dataDir)
	pqMust(t, err)
	assertModuleState(t, restored, retained)
	if err = restored.EnableAccountPQ(2); err == nil {
		t.Fatal("confirmed schedule could be rewritten after restart")
	}
	assertModuleState(t, restored, retained)
}

func TestPQActiveAccountRejectsLegacyMutationEntrypoints(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	pqMust(t, f.d.SetEthereumNativeTransfers(true))
	before := moduleBusinessState(t, f.d)
	// A freshly generated proposed pair and valid classic signature still cannot
	// recover/rotate an active PQ account through its old classic credential.
	rotationKey, rotationPublic, err := ynxbatch.KeyGen()
	pqMust(t, err)
	defer rotationKey.Destroy()
	rotation := pqClassicMigration(t, f.classic, rotationKey, ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: rotationPublic.PKA, PKB: rotationPublic.PKB, PriorRevision: 1, NewRevision: 2, LedgerNonce: 2, ActivateAt: 3})
	if _, _, err = f.d.SubmitAccountMigration(rotation); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatalf("classic recovery became fallback: %v", err)
	}
	assertModuleState(t, f.d, before)
	legacy := SignedTransferInput{Hash: "0x" + strings.Repeat("8", 64), From: f.owner, To: f.to, Amount: 2, Fee: 1, Nonce: 2}
	raw, eth := pqEthereumTransfer(t, f.classic, f.d.cfg.ChainID, f.to, 1)
	dexPayload, err := json.Marshal(NativeDexAssetCreatePayload{AssetID: "pq-guard-token", Symbol: "PQT", Name: "PQ guard token", Decimals: 6, MaxSupply: 1000, InitialSupply: 100})
	pqMust(t, err)
	resource := resourcePoolCreateFixture(f.to, "merchant", "PQ policy gate", time.Now().UTC().Add(time.Hour), "pq-policy-resource")
	resource.Authorization = mustResourceAuthorization(t, f.classic, f.d.cfg.ChainID, ResourcePoolCreateAction, resource, 2)
	cases := []struct {
		name string
		run  func() error
	}{
		{"unsigned", func() error { _, e := f.d.Transfer(f.owner, f.to, 2); return e }},
		{"native normalized admission", func() error { _, _, e := f.d.SubmitSignedTransfer(legacy); return e }},
		{"Ethereum actual signed envelope", func() error { _, _, e := f.d.SubmitSignedTransfer(ethereumInput(raw, eth)); return e }},
		{"stake", func() error { _, _, e := f.d.Stake(f.owner, 2); return e }},
		{"delegation", func() error { _, _, _, e := f.d.DelegateResources(f.owner, f.to, 2); return e }},
		{"rental", func() error { _, _, e := f.d.RentResources(f.owner, "ynx_resource_provider", 1, 0, 0, 0); return e }},
		{"DEX normalized admission", func() error {
			_, _, _, e := f.d.SubmitNativeDexAction(NativeDexSignedActionInput{Hash: "0x" + strings.Repeat("9", 64), Signer: f.owner, Action: NativeDexActionAssetCreate, Nonce: 2, Fee: 1, Payload: dexPayload})
			return e
		}},
		{"resource actual classic authorization", func() error { _, _, e := f.d.CreateResourcePool(resource); return e }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if e := c.run(); !errors.Is(e, ynxauth.ErrPolicy) {
				t.Fatalf("expected account-policy rejection, got %v", e)
			}
			assertModuleState(t, f.d, before)
		})
	}
}

func TestPQMutationDurabilityUnknownRetainsOriginalIntent(t *testing.T) {
	for _, kind := range []string{"migration", "transfer"} {
		for _, afterRename := range []bool{false, true} {
			name := kind + "/before-rename"
			if afterRename {
				name = kind + "/after-rename"
			}
			t.Run(name, func(t *testing.T) {
				f := newPQLedger(t)
				var wire []byte
				var submit func(*Devnet) (Transaction, bool, error)
				if kind == "migration" {
					wire = f.migration(t, 2, 1)
					submit = func(d *Devnet) (Transaction, bool, error) { return d.SubmitAccountMigration(wire) }
				} else {
					f.activate(t)
					wire = f.member(t, 2, 3)
					submit = func(d *Devnet) (Transaction, bool, error) { return d.SubmitPQTransfer(wire) }
				}
				before := moduleBusinessState(t, f.d)
				target := f.d.snapshotPath() + ".tmp"
				if afterRename {
					target = f.d.snapshotIntegrityMarkerPath() + ".tmp"
				}
				unblock := blockSnapshotWrite(t, target)
				tx, replayed, err := submit(f.d)
				if err == nil || replayed {
					t.Fatal("persistence failure reported acceptance")
				}
				if !afterRename {
					if errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash != "" {
						t.Fatal("pre-rename error was not rolled back")
					}
					assertModuleState(t, f.d, before)
				} else {
					if !errors.Is(err, ErrSnapshotDurabilityUncertain) || tx.Hash == "" {
						t.Fatal("lost ack did not preserve UNKNOWN identity")
					}
					accepted := moduleBusinessState(t, f.d)
					old, proof, found := f.d.TransactionWithDurability(tx.Hash)
					if !found || old.Hash != tx.Hash || proof.Status != "uncertain" {
						t.Fatal("uncertain transaction cannot be reconciled")
					}
					if retry, done, e := submit(f.d); !errors.Is(e, ErrSnapshotDurabilityUncertain) || done || retry.Hash != tx.Hash {
						t.Fatal("retry fabricated success or a new identity")
					}
					assertModuleState(t, f.d, accepted)
					cold := readTransferSnapshot(t, f.d)
					assertModuleState(t, cold, accepted)
				}
				unblock()
				accepted, replayed, err := submit(f.d)
				pqMust(t, err)
				if accepted.Hash == "" || replayed != afterRename {
					t.Fatal("repaired retry changed admission semantics")
				}
				if afterRename && accepted.Hash != tx.Hash {
					t.Fatal("UNKNOWN retry changed transaction hash")
				}
				a, _ := f.d.Account(f.owner)
				wantBalance, wantNonce := int64(999), uint64(1)
				if kind == "transfer" {
					wantBalance, wantNonce = 995, 2
				}
				if a.Balance != wantBalance || a.Nonce != wantNonce {
					t.Fatalf("retry double-applied charge: %d/%d", a.Balance, a.Nonce)
				}
				state := moduleBusinessState(t, f.d)
				restored, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
				pqMust(t, err)
				assertModuleState(t, restored, state)
			})
		}
	}
}

// Minimal test-only EIP-155 envelope construction, independently checked by the
// actual ethnative verifier before it reaches the ledger policy gate.
func pqRLPBytes(b []byte) []byte {
	if len(b) == 1 && b[0] < 128 {
		return bytes.Clone(b)
	}
	return pqRLPFrame(b, 0x80, 0xb7)
}
func pqRLPFrame(b []byte, short, long byte) []byte {
	if len(b) <= 55 {
		return append([]byte{short + byte(len(b))}, b...)
	}
	n := big.NewInt(int64(len(b))).Bytes()
	return append(append([]byte{long + byte(len(n))}, n...), b...)
}
func pqRLPList(fields [][]byte) []byte {
	var b []byte
	for _, f := range fields {
		b = append(b, pqRLPBytes(f)...)
	}
	return pqRLPFrame(b, 0xc0, 0xf7)
}
func pqEthereumTransfer(t *testing.T, key *secp256k1.PrivateKey, chainID int64, to string, nonce uint64) ([]byte, ethnative.Transfer) {
	t.Helper()
	recipient, err := hex.DecodeString(strings.TrimPrefix(to, "0x"))
	pqMust(t, err)
	fields := [][]byte{new(big.Int).SetUint64(nonce).Bytes(), big.NewInt(ethnative.GasPriceWei).Bytes(), new(big.Int).SetUint64(ethnative.TransferGas).Bytes(), recipient, ethnative.Wei(2).Bytes(), nil}
	signing := append(append([][]byte(nil), fields...), big.NewInt(chainID).Bytes(), nil, nil)
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(pqRLPList(signing))
	sig := ecdsa.SignCompact(key, h.Sum(nil), false)
	v := big.NewInt(chainID*2 + 35 + int64(sig[0]-27))
	raw := pqRLPList(append(fields, v.Bytes(), new(big.Int).SetBytes(sig[1:33]).Bytes(), new(big.Int).SetBytes(sig[33:]).Bytes()))
	decoded, err := ethnative.Verify(raw, chainID)
	pqMust(t, err)
	owner, err := nativeResourceAddress(key.PubKey().SerializeCompressed())
	pqMust(t, err)
	if decoded.From != owner || decoded.Nonce != nonce {
		t.Fatal("test Ethereum signer mismatch")
	}
	return raw, decoded
}
