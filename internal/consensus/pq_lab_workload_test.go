package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

func pqLabWorkloadTemp(t *testing.T) string {
	t.Helper()
	path, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func pqLabSenderTestCheckpoint(t *testing.T, app *Application, m chain.ConsensusMigrationState) *PQLabSenderCheckpoint {
	t.Helper()
	if err := app.committed.Validate(m); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(app.committed)
	if err != nil {
		t.Fatal(err)
	}
	var state CommittedState
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	network, err := hex.DecodeString(m.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	return &PQLabSenderCheckpoint{state: state, network: network, migrationHash: m.StateHash, current: func() error {
		if app.committed.Height != state.Height || app.committed.AppHash != state.AppHash {
			return errors.New("actual checkpoint advanced")
		}
		return nil
	}}
}

func TestPQLabMultiOwnerOriginalExecutionAndBounds(t *testing.T) {
	for _, owners := range []int{100, 500, 1000} {
		if _, err := validatePQLabWorkloadOptions(PQLabWorkloadOptions{Owners: owners, Transfers: 10, BatchSize: 2, Online: true}); err != nil {
			t.Fatal("declared capacity invalid", err)
		}
	}
	for _, options := range []PQLabWorkloadOptions{{Owners: 1001, Transfers: 1, BatchSize: 1, Online: true}, {Owners: 1000, Transfers: 11, BatchSize: 1, Online: true}, {Owners: 1000, Transfers: 2, BatchSize: 1}, {Owners: 2, Transfers: 3, BatchSize: 3}} {
		if _, err := validatePQLabWorkloadOptions(options); err == nil {
			t.Fatal("unbounded or illegal capacity accepted")
		}
	}
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 3, Transfers: 3, BatchSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	f := pqLabBoundFixture(t, source.Migration)
	dir := filepath.Join(pqLabWorkloadTemp(t), "corpus")
	m, err := source.WriteCorpus(dir, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	if m.Mode != "pre-signed" || len(m.Owners) != 3 || len(m.Transactions) != 6 || m.TotalMemberCapacity != "9" || m.OutstandingPerOwner != "1" || m.BatchWaitNanoseconds != "0" {
		t.Fatal("multi-owner map/capacity missing")
	}
	seen := map[string]bool{}
	for _, owner := range m.Owners {
		if seen[owner.Owner] || owner.InitialNonce != "1" || owner.InitialBalance != "7" {
			t.Fatal("independent source owners collapsed")
		}
		seen[owner.Owner] = true
	}
	app, err := NewPersistentApplication(f.migration, filepath.Join(pqLabWorkloadTemp(t), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	manifestRaw, _ := os.ReadFile(filepath.Join(dir, "PUBLIC-WORKLOAD.json"))
	pin := pqLabFile("", manifestRaw).SHA256
	for i, tx := range m.Transactions {
		checkpoint := pqLabSenderTestCheckpoint(t, app, f.migration)
		read, err := ReadPQLabPreSigned(dir, pin, i, checkpoint)
		if err != nil || read.Transaction.ABCIHash != tx.ABCIHash || read.AuthorityGranted {
			t.Fatal("normal original readback", err)
		}
		raw, err := os.ReadFile(filepath.Join(dir, tx.Envelope.Path))
		if err != nil {
			t.Fatal(err)
		}
		r, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: app.committed.Height + 1, Time: time.Unix(app.committed.Height+1, 0).UTC(), Txs: [][]byte{raw}})
		if err != nil || len(r.TxResults) != 1 || r.TxResults[0].Code != 0 {
			t.Fatal("original independent execution", r, err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		if _, err = ReadPQLabPreSigned(dir, pin, i, checkpoint); err == nil {
			t.Fatal("stale checkpoint admitted")
		}
	}
	cold, err := NewPersistentApplication(f.migration, app.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if cold.committed.AppHash != app.committed.AppHash || cold.committed.Validate(f.migration) != nil {
		t.Fatal("full cold history lost")
	}
	for _, owner := range m.Owners {
		at, ok := accountIndex(cold.committed.Accounts, owner.Owner)
		if !ok || cold.committed.Accounts[at].Nonce != 4 || cold.committed.Accounts[at].Balance != 1 {
			t.Fatal("independent nonce/fee/balance lost")
		}
		to, ok := accountIndex(cold.committed.Accounts, owner.Recipient)
		if !ok || cold.committed.Accounts[to].Balance != 3 {
			t.Fatal("independent recipient lost")
		}
	}
}

func TestPQLabOnlineSenderRevocationAndPartialIntentPreserved(t *testing.T) {
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 2, Transfers: 2, BatchSize: 1, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	secret := bytes.Clone(source.materials[0].PKCS8A)
	defer clear(secret)
	f := pqLabBoundFixture(t, source.Migration)
	dir := filepath.Join(pqLabWorkloadTemp(t), "workload")
	_, err = source.WriteCorpus(dir, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	manifestRaw, _ := os.ReadFile(filepath.Join(dir, "PUBLIC-WORKLOAD.json"))
	pin := pqLabFile("", manifestRaw).SHA256
	credential, err := os.ReadFile(filepath.Join(dir, "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	vault, err := os.ReadFile(filepath.Join(dir, "private-senders", "keys.vault"))
	if err != nil || bytes.Contains(vault, secret) || bytes.Contains(manifestRaw, secret) {
		t.Fatal("plaintext private material escaped encrypted custody")
	}
	for _, path := range []string{filepath.Join(dir, "private-senders", "keys.vault"), filepath.Join(dir, "private-senders", "recovery.raw")} {
		info, err := os.Lstat(path)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("private mode", err)
		}
	}
	sender, err := OpenPQLabSender(dir, pin, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	defer sender.Close()
	revoked, err := OpenPQLabSender(dir, pin, 1, credential)
	if err != nil {
		t.Fatal(err)
	}
	defer revoked.Close()
	app, err := NewPersistentApplication(f.migration, filepath.Join(pqLabWorkloadTemp(t), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	network, _ := hex.DecodeString(f.migration.OriginalGenesisHash)
	height := uint64(app.committed.Height + 1)
	intent := ynxauth.RevocationIntent{ChainID: network, Owner: revoked.owner.Owner, PKA: revoked.public.PKA, PKB: revoked.public.PKB, AuthorizingRevision: 1, ThroughRevision: 1, LedgerNonce: 2, ExecuteAt: height, RevokeAt: height + 1}
	message, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	_, proof := consensusPQProof(t, revoked.key, network, revoked.owner.Owner, ynxauth.RevocationPurpose, message)
	wire, err := (ynxauth.Revocation{Intent: intent, CurrentPQProof: proof}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := EncodePQTransaction(PQRevocationType, wire)
	if err != nil {
		t.Fatal(err)
	}
	result, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(height), Time: time.Unix(int64(height), 0).UTC(), Txs: [][]byte{envelope}})
	if err != nil || result.TxResults[0].Code != 0 {
		t.Fatal("real revoke", result, err)
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	request := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("f", 64), OwnerIndex: 1, FirstNonce: 3, Members: 1}
	checkpoint := pqLabSenderTestCheckpoint(t, app, f.migration)
	if _, err = revoked.Sign(request, checkpoint); err == nil {
		t.Fatal("actual terminal revocation did not stop new online signing")
	}
	path, _ := revoked.operation(request.OperationID)
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("revoked owner acquired new signing intent")
	}
	request.OwnerIndex = 0
	request.FirstNonce = 2
	checks := 0
	originalCheck := checkpoint.current
	checkpoint.current = func() error {
		checks++
		if checks > 1 {
			return errors.New("actual source changed before original publication")
		}
		return originalCheck()
	}
	if _, err = sender.Sign(request, checkpoint); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("post-sign uncertainty hidden", err)
	}
	path, _ = sender.operation(request.OperationID)
	original, err := os.ReadFile(filepath.Join(path, "transaction.abci"))
	if err != nil {
		t.Fatal("signed original lost", err)
	}
	if _, err = os.Stat(filepath.Join(path, "RESULT.json")); !os.IsNotExist(err) {
		t.Fatal("uncertain result acknowledged")
	}
	if err = sender.Close(); err != nil {
		t.Fatal(err)
	}
	sender, err = OpenPQLabSender(dir, pin, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	defer sender.Close()
	// Complete signed originals plus the MAC-bound PRE-sign policy checkpoint
	// permit durable re-confirmation, without using the now-current key policy
	// as a reason to generate a replacement signature.
	recovered, err := sender.Recover(request)
	if err != nil || recovered.Status != "signed-original" || recovered.AuthorityGranted || recovered.CheckpointHeight != int64(height) {
		t.Fatal("complete original failed cold re-confirmation", err)
	}
	if retried, err := sender.Sign(request, nil); err != nil || retried.Transaction != recovered.Transaction {
		t.Fatal("UNKNOWN silently re-signed", err)
	}
	after, err := os.ReadFile(filepath.Join(path, "transaction.abci"))
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("UNKNOWN original changed")
	}
	next := request
	next.OperationID = strings.Repeat("9", 64)
	if _, err = sender.Sign(next, pqLabSenderTestCheckpoint(t, app, f.migration)); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("new id escaped unresolved original", err)
	}
	// A request-only partial write has no authenticated signature and cannot be
	// recovered by key import or by retrying under a new current checkpoint.
	partial := request
	partial.OperationID = strings.Repeat("8", 64)
	partialDir, _ := sender.operation(partial.OperationID)
	if err = pqLabFreshDirectory(partialDir); err != nil {
		t.Fatal(err)
	}
	partialRaw, _ := json.Marshal(partial)
	if err = pqLabWriteExclusive(filepath.Join(partialDir, "request.json"), partialRaw); err != nil {
		t.Fatal(err)
	}
	if _, err = sender.Recover(partial); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("request-only intent fabricated a signature", err)
	}
	if _, err = sender.Sign(partial, pqLabSenderTestCheckpoint(t, app, f.migration)); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("request-only original was re-signed", err)
	}
}

func TestPQLabOnlineSenderOriginalRecoveryAndFullProof(t *testing.T) {
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 2, Transfers: 3, BatchSize: 2, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	var sender *PQLabSender
	var directory, pin string
	var credential []byte
	var request PQLabSenderRequest
	var saved PQLabSenderResult
	m, proof, h := pqLabProofFixtureSource(t, source, func(h *engineWiringHarness) (PQLabWorkloadTransaction, []byte, []byte) {
		directory = filepath.Join(pqLabWorkloadTemp(t), "workload")
		manifest, err := source.WriteCorpus(directory, h.f.migration)
		if err != nil {
			t.Fatal(err)
		}
		if len(source.materials) != 0 || len(manifest.Transactions) != 0 || manifest.Mode != "online" {
			t.Fatal("online source leaked pre-sign/material")
		}
		raw, _ := os.ReadFile(filepath.Join(directory, "PUBLIC-WORKLOAD.json"))
		pin = pqLabFile("", raw).SHA256
		credential, err = os.ReadFile(filepath.Join(directory, "private-senders", "recovery.raw"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { clear(credential) })
		if _, err = OpenPQLabSender(directory, pin, 0, make([]byte, 32)); err == nil {
			t.Fatal("wrong credential accepted")
		}
		sender, err = OpenPQLabSender(directory, pin, 0, credential)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = sender.Close() })
		if _, err = OpenPQLabSender(directory, pin, 0, credential); err == nil {
			t.Fatal("same owner concurrent lease accepted")
		}
		other, err := OpenPQLabSender(directory, pin, 1, credential)
		if err != nil {
			t.Fatal("independent owner blocked", err)
		}
		defer other.Close()
		if bytes.Equal(sender.public.PKA, other.public.PKA) || bytes.Equal(sender.public.PKB, other.public.PKB) {
			t.Fatal("owners share keys")
		}
		checkpoint := pqLabSenderTestCheckpoint(t, h.app, h.f.migration)
		request = PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("a", 64), OwnerIndex: 0, FirstNonce: 2, Members: 2}
		wrong := *checkpoint
		wrong.network = make([]byte, 32)
		if _, err = sender.Sign(request, &wrong); err == nil {
			t.Fatal("wrong network signed")
		}
		wrong = *checkpoint
		wrong.state = checkpoint.state
		wrong.state.AccountPolicy = new(ynxauth.State)
		raw, _ = json.Marshal(checkpoint.state.AccountPolicy)
		if json.Unmarshal(raw, &wrong.state.AccountPolicy) != nil {
			t.Fatal("clone")
		}
		// Actual pair mismatch is rejected before any original signing intent.
		for i := range wrong.state.AccountPolicy.Records {
			if wrong.state.AccountPolicy.Records[i].Owner == sender.owner.Owner {
				wrong.state.AccountPolicy.Records[i].PKA = bytes.Clone(other.public.PKA)
			}
		}
		if _, err = sender.Sign(request, &wrong); err == nil {
			t.Fatal("wrong current full pair signed")
		}
		operation, _ := sender.operation(request.OperationID)
		if _, err = os.Stat(operation); !os.IsNotExist(err) {
			t.Fatal("preflight rejection created an intent")
		}
		saved, err = sender.Sign(request, checkpoint)
		if err != nil {
			t.Fatal("normal online sign", err)
		}
		wire, err := os.ReadFile(filepath.Join(operation, "transaction.wire"))
		if err != nil {
			t.Fatal(err)
		}
		envelope, err := os.ReadFile(filepath.Join(operation, "transaction.abci"))
		if err != nil {
			t.Fatal(err)
		}
		whole, err := ynxbatch.DecodeWhole(wire)
		if err != nil {
			t.Fatal(err)
		}
		for _, branch := range []string{"A", "B"} {
			cert := whole.Certificate
			if branch == "A" {
				cert.SigmaA = bytes.Clone(cert.SigmaA)
				cert.SigmaA[0] ^= 1
			} else {
				cert.SigmaB = bytes.Clone(cert.SigmaB)
				cert.SigmaB[0] ^= 1
			}
			bad, err := ynxbatch.EncodeWhole(ynxbatch.Whole{Certificate: cert, Messages: whole.Messages})
			if err != nil {
				t.Fatal(err)
			}
			badEnvelope, err := EncodePQTransaction(PQWholeType, bad)
			if err != nil {
				t.Fatal(err)
			}
			check, e := h.app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: badEnvelope})
			if e != nil || check.Code == 0 {
				t.Fatal("independent bad branch accepted", branch, e)
			}
		}
		next := request
		next.OperationID = strings.Repeat("b", 64)
		if _, err = sender.Sign(next, checkpoint); !errors.Is(err, ErrPQLabSenderUnknown) {
			t.Fatal("unconfirmed operation did not stop re-sign", err)
		}
		if err = sender.Close(); err != nil {
			t.Fatal(err)
		}
		sender, err = OpenPQLabSender(directory, pin, 0, credential)
		if err != nil {
			t.Fatal(err)
		}
		recovered, err := sender.Recover(request)
		if err != nil || recovered.Transaction != saved.Transaction {
			t.Fatal("cold exact original recovery", err)
		}
		changed := request
		changed.Members = 1
		if _, err = sender.Recover(changed); err == nil {
			t.Fatal("operation body replaced")
		}
		if again, err := sender.Sign(request, nil); err != nil || again.Transaction != saved.Transaction {
			t.Fatal("exact retry must recover without re-sign", err)
		}
		return saved.Transaction, wire, envelope
	})
	bad := proof
	bad.ExecutionResult = bytes.Clone(proof.ExecutionResult)
	bad.ExecutionResult[len(bad.ExecutionResult)-1] ^= 1
	if _, err = sender.Confirm(request, m, bad, time.Now().UTC()); err == nil {
		t.Fatal("bad proof released outstanding operation")
	}
	// A failed verification retains exact checkpoint originals, without a success
	// record. Resumption revalidates those same bytes and never replaces them.
	operation, _ := sender.operation(request.OperationID)
	if _, err = os.Stat(filepath.Join(operation, "confirmation-proof", "PUBLIC-PROOF-INPUTS.json")); !os.IsNotExist(err) {
		t.Fatal("bad proof published success")
	}
	confirmed, err := sender.Confirm(request, m, proof, time.Now().UTC())
	if err != nil {
		t.Fatal("normal H/H+1 confirmation", err)
	}
	if !confirmed.Result.Finalized || !confirmed.Result.ExecutionSuccessful || confirmed.Result.NativeGrant || confirmed.AuthorityGranted {
		t.Fatal("incorrect proof classification")
	}
	if again, err := sender.Confirm(request, m, proof, time.Now().UTC()); err != nil || again.Context != confirmed.Context {
		t.Fatal("confirmed lost acknowledgement recovery", err)
	}
	next := request
	next.OperationID = strings.Repeat("c", 64)
	next.FirstNonce = 4
	next.Members = 1
	checkpoint := pqLabSenderTestCheckpoint(t, h.app, h.f.migration)
	last, err := sender.Sign(next, checkpoint)
	if err != nil {
		t.Fatal("actual next owner nonce after proof", err)
	}
	lastDir, _ := sender.operation(next.OperationID)
	envelope, err := os.ReadFile(filepath.Join(lastDir, last.Transaction.Envelope.Path))
	if err != nil {
		t.Fatal(err)
	}
	h.apply(t, cmttypes.Txs{envelope})
	cold, err := NewPersistentApplicationWithEngineAuthorization(h.f.migration, h.path, h.f.bootstrap, h.app.pqEngineAuthorization)
	if err != nil {
		t.Fatal(err)
	}
	at, ok := accountIndex(cold.committed.Accounts, sender.owner.Owner)
	if !ok || cold.committed.Accounts[at].Nonce != 4 || cold.committed.Accounts[at].Balance != 1 {
		t.Fatal("online final money/nonce loop incomplete")
	}
	otherAt, ok := accountIndex(cold.committed.Accounts, source.manifest.Owners[1].Owner)
	if !ok || cold.committed.Accounts[otherAt].Nonce != 1 || cold.committed.Accounts[otherAt].Balance != 7 {
		t.Fatal("owner isolation failed")
	}
}

func pqLabBoundFixture(t *testing.T, m chain.ConsensusMigrationState) *validatorRegistryFixture {
	t.Helper()
	f := &validatorRegistryFixture{legacy: map[string]ed25519.PrivateKey{}}
	bindings := make([]chain.ConsensusValidatorKeyBinding, len(m.Validators))
	for i, v := range m.Validators {
		pub, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		h := sha256.Sum256(pub)
		f.legacy[string(h[:20])] = key
		bindings[i] = chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(pub), ConsensusAddress: strings.ToUpper(hex.EncodeToString(h[:20]))}
	}
	var err error
	f.migration, err = m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	f.doc, err = BuildCometGenesis(f.migration, time.Now().UTC().Add(-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	f.raw, err = cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(f.raw)
	f.pins = ConsensusBootstrapPins{hex.EncodeToString(h[:]), f.migration.OriginalGenesisHash, f.migration.StateHash}
	f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestPQLabWorkloadRealSourceCorpusExecutionAndRestart(t *testing.T) {
	for _, batchSize := range []int{1, 4} {
		t.Run(strconv.Itoa(batchSize), func(t *testing.T) {
			s, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 7, BatchSize: batchSize})
			if err != nil {
				t.Fatal(err)
			}
			public := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
			public.ProduceBlock()
			publicMigration, err := public.ExportConsensusMigrationState()
			if err != nil {
				t.Fatal(err)
			}
			if s.Migration.Network.ChainID != 642399 || s.Migration.Network.IsPublicNet || !strings.HasPrefix(s.Migration.Network.Slug, "pq-lab-") || s.Migration.OriginalGenesisHash == publicMigration.OriginalGenesisHash {
				t.Fatal("synthetic identity reused public network")
			}
			if s.Migration.Height != 3 || s.Migration.Runtime == nil || len(s.Migration.AccountPolicy.Records) != 1 || len(s.Migration.Runtime.Pending) != 0 {
				t.Fatal("source did not mine actual approved migration")
			}
			f := pqLabBoundFixture(t, s.Migration)
			dir := filepath.Join(pqLabWorkloadTemp(t), "corpus")
			manifest, err := s.WriteCorpus(dir, f.migration)
			if err != nil {
				t.Fatal(err)
			}
			original, _ := os.ReadFile(filepath.Join(dir, "PUBLIC-WORKLOAD.json"))
			if _, err = s.WriteCorpus(dir, f.migration); err == nil {
				t.Fatal("existing UNKNOWN corpus overwritten")
			}
			after, _ := os.ReadFile(filepath.Join(dir, "PUBLIC-WORKLOAD.json"))
			if !bytes.Equal(original, after) {
				t.Fatal("existing corpus changed")
			}
			if manifest.NetworkStarted || manifest.AuthorityGranted || manifest.DeployedSourceQualification || !manifest.SyntheticOnly {
				t.Fatal("public manifest grants authority")
			}
			app, err := NewPersistentApplication(f.migration, filepath.Join(pqLabWorkloadTemp(t), "state.json"))
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			before := app.committed.AppHash
			for _, bad := range manifest.InvalidSignatureEnvelopes {
				raw, err := os.ReadFile(filepath.Join(dir, bad.Path))
				if err != nil {
					t.Fatal(err)
				}
				check, e := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: raw})
				if e != nil || check.Code == 0 || app.committed.AppHash != before {
					t.Fatal("independent bad signature admitted or mutated state", check, e)
				}
			}
			for _, tx := range manifest.Transactions {
				raw, err := os.ReadFile(filepath.Join(dir, tx.Envelope.Path))
				if err != nil {
					t.Fatal(err)
				}
				if pqLabFile(tx.Envelope.Path, raw) != tx.Envelope || SignedTransactionHash(raw) != tx.ABCIHash {
					t.Fatal("public exact raw/hash mismatch")
				}
				check, e := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: raw})
				if e != nil || check.Code != 0 {
					t.Fatal("normal original CheckTx rejected", check, e)
				}
				h := app.committed.Height + 1
				res, e := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: [][]byte{raw}})
				if e != nil || len(res.TxResults) != 1 || res.TxResults[0].Code != 0 {
					t.Fatal("normal execution rejected", res, e)
				}
				if _, e = app.Commit(ctx, &abci.RequestCommit{}); e != nil {
					t.Fatal(e)
				}
			}
			cold, err := NewPersistentApplication(f.migration, app.statePath)
			if err != nil {
				t.Fatal(err)
			}
			if cold.committed.AppHash != app.committed.AppHash {
				t.Fatal("cold state lost original result")
			}
			owner, ok := accountIndex(cold.committed.Accounts, manifest.Owner)
			if !ok || cold.committed.Accounts[owner].Balance != 1 || cold.committed.Accounts[owner].Nonce != 8 {
				t.Fatal("full nonce/fee/balance corpus not executed")
			}
			receiver, ok := accountIndex(cold.committed.Accounts, manifest.Recipient)
			if !ok || cold.committed.Accounts[receiver].Balance != 7 {
				t.Fatal("actual recipient balance mismatch")
			}
			if err = cold.committed.Validate(f.migration); err != nil {
				t.Fatal("full cold history invalid", err)
			}
		})
	}
}

func TestPQLabWorkloadBoundsAliasesAndExactSource(t *testing.T) {
	for _, o := range []PQLabWorkloadOptions{{Transfers: 0, BatchSize: 1}, {Transfers: 1, BatchSize: 0}, {Transfers: 1025, BatchSize: 1}, {Transfers: 2, BatchSize: 3}, {Transfers: 6, BatchSize: 3}} {
		if _, err := NewPQLabWorkloadSource(o); err == nil {
			t.Fatal("invalid bound admitted", o)
		}
	}
	s, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 1, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	f := pqLabBoundFixture(t, s.Migration)
	altered := f.migration
	altered.Accounts = append([]chain.ConsensusAccount(nil), altered.Accounts...)
	altered.Accounts[0].Nonce++
	target := filepath.Join(pqLabWorkloadTemp(t), "bad")
	if _, err = s.WriteCorpus(target, altered); err == nil {
		t.Fatal("changed original source admitted")
	}
	if _, err = os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("bad source mutated output")
	}
	parent := pqLabWorkloadTemp(t)
	alias := filepath.Join(parent, "alias")
	if err = os.Symlink(parent, alias); err != nil {
		t.Fatal(err)
	}
	if _, err = s.WriteCorpus(filepath.Join(alias, "out"), f.migration); err == nil {
		t.Fatal("aliased parent accepted")
	}
	// A second fresh synthetic identity must not be a shared public/testnet root.
	other, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 1, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	if other.Migration.Network.Slug == s.Migration.Network.Slug || other.Migration.OriginalGenesisHash == s.Migration.OriginalGenesisHash {
		t.Fatal("fresh lab genesis identity reused")
	}
}

// Actual BlockExecutor/Comet types only, no Node.Start or HTTP/network. The
// production exporter itself never uses this test harness or signs a block.
func pqLabProofFixture(t *testing.T) (PQLabProofMaterials, PQTransactionProofRequest) {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 1, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	m, proof, _ := pqLabProofFixtureSource(t, source, nil)
	return m, proof
}

// The test callback only supplies a transaction to the existing real engine
// harness; production sender APIs expose no signer callback/verified flag.
func pqLabProofFixtureSource(t *testing.T, source *PQLabWorkloadSource, choose func(*engineWiringHarness) (PQLabWorkloadTransaction, []byte, []byte)) (PQLabProofMaterials, PQTransactionProofRequest, *engineWiringHarness) {
	t.Helper()
	f := pqLabBoundFixture(t, source.Migration)
	app, err := NewPersistentApplicationWithBootstrap(f.migration, filepath.Join(pqLabWorkloadTemp(t), "state.json"), f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	db, blocks := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blocks.Close() })
	h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(db, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocks), path: app.statePath}
	h.proxy = startEngineTestProxy(t, app)
	initial, err := sm.MakeGenesisState(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	initial.AppHash = nil
	if err = h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(h.raw, initial, h.blocks, f.doc)
	handshake.SetConsensusAuthoritySource(h.source)
	if err = handshake.Handshake(h.proxy); err != nil {
		t.Fatal(err)
	}
	if _, err = h.wrapped().Load(); err != nil {
		t.Fatal(err)
	}
	var registrations cmttypes.Txs
	for i := range f.bootstrap.record.Members {
		key, wire := engineRegistration(t, f, i, f.doc.InitialHeight)
		h.keys = append(h.keys, key)
		tx, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		registrations = append(registrations, tx)
	}
	h.apply(t, registrations)
	schedule, err := NewPQEngineSchedule(f.bootstrap, h.app.committed.ValidatorRegistry, h.app.committed.Height, h.app.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	scheduleRaw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewPQEngineAuthorization(scheduleRaw, scheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	app, err = NewPersistentApplicationWithEngineAuthorization(f.migration, h.path, f.bootstrap, auth)
	if err != nil {
		t.Fatal(err)
	}
	h.app = app
	h.source.app = app
	h.proxy = startEngineTestProxy(t, app)
	for app.committed.Height < schedule.ActivationHeight+1 {
		h.apply(t, nil)
	}
	var tx PQLabWorkloadTransaction
	var wire, envelope []byte
	if choose == nil {
		tx = source.manifest.Transactions[0]
		wire, envelope = source.files[tx.Wire.Path], source.files[tx.Envelope.Path]
	} else {
		tx, wire, envelope = choose(h)
	}
	height := app.committed.Height + 1
	h.apply(t, cmttypes.Txs{envelope})
	h.apply(t, nil)
	l := &pqLightProofFixture{harness: h, schedule: schedule, authorization: auth}
	block, successor := l.block(t, height), l.block(t, height+1)
	statement := func(b *cmttypes.LightBlock) PQLightProofExpectation {
		return PQLightProofExpectation{ChainID: b.ChainID, HeaderHeight: b.Height, BlockHash: bytes.Clone(b.Hash()), StateHeight: b.Height - 1, StateAppHash: bytes.Clone(b.AppHash)}
	}
	outer, native := sha256.Sum256(envelope), sha256.Sum256(wire)
	expected := PQTransactionProofExpectation{Block: statement(block), Successor: statement(successor), TransactionType: tx.Type, Envelope: envelope, NativeWire: wire, TransactionHash: outer[:], NativeWireHash: native[:], Index: 0}
	rawTx, err := cmtjson.Marshal(h.blocks.LoadBlock(height).Data.Txs.Proof(0))
	if err != nil {
		t.Fatal(err)
	}
	response, err := h.raw.LoadFinalizeBlockResponse(height)
	if err != nil {
		t.Fatal(err)
	}
	if response.TxResults[0].Code != 0 {
		t.Fatal("actual corpus execution failed", response.TxResults[0])
	}
	result, proof, err := EncodePQTransactionExecutionProof(response.TxResults, 0)
	if err != nil {
		t.Fatal(err)
	}
	request := PQTransactionProofRequest{Version: PQTransactionProofVersion, Block: l.encode(t, block), Successor: l.encode(t, successor), TransactionProof: rawTx, ExecutionResult: result, ExecutionProof: proof}
	migrationRaw, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	stateRaw, err := os.ReadFile(h.path)
	if err != nil {
		t.Fatal(err)
	}
	trusted, err := cmtjson.Marshal(l.block(t, schedule.ActivationHeight))
	if err != nil {
		t.Fatal(err)
	}
	engine, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	return PQLabProofMaterials{Version: PQLabProofMaterialsVersion, Migration: migrationRaw, Genesis: f.raw, CommittedState: stateRaw, Schedule: scheduleRaw, TrustedLightBlock: trusted, Pins: f.pins, ScheduleHash: scheduleHash, EngineHeight: engine.LastBlockHeight, EngineAppHash: bytes.Clone(engine.AppHash), TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustNumerator: 1, TrustDenominator: 3, Expected: expected}, request, h
}

func TestPQLabWorkloadProofOriginalCLIInputsAndNegatives(t *testing.T) {
	m, proof := pqLabProofFixture(t)
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = DecodePQLabProofMaterials(raw, pqLabFile("", raw).SHA256); err != nil {
		t.Fatal(err)
	}
	if _, err = DecodePQLabProofMaterials(raw, strings.Repeat("0", 64)); err == nil {
		t.Fatal("unapproved proof context accepted")
	}
	dir := filepath.Join(pqLabWorkloadTemp(t), "proof")
	out, err := WritePQLabProofInputs(dir, m, proof, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if !out.Result.Finalized || !out.Result.ExecutionSuccessful || out.AuthorityGranted || out.ActualNetworkExecutionClaim || !out.SyntheticOnly {
		t.Fatal("wrong proof/authority result", out)
	}
	contextRaw, err := os.ReadFile(filepath.Join(dir, out.Context.Path))
	if err != nil {
		t.Fatal(err)
	}
	if pqLabFile(out.Context.Path, contextRaw) != out.Context {
		t.Fatal("normal CLI context pin differs")
	}
	var c struct {
		Version    string                     `json:"version"`
		LightTrust map[string]string          `json:"lightTrust"`
		Expected   map[string]json.RawMessage `json:"expectedTransaction"`
	}
	if err = json.Unmarshal(contextRaw, &c); err != nil || len(c.LightTrust) != 24 || c.Version != "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1" {
		t.Fatal("normal CLI context schema drift", err)
	}
	if _, err = WritePQLabProofInputs(dir, m, proof, time.Now().UTC()); err == nil {
		t.Fatal("UNKNOWN proof originals overwritten")
	}
	for _, name := range []string{"wrong engine checkpoint", "wrong original envelope", "wrong result proof", "expired trust", "wrong source genesis"} {
		t.Run(name, func(t *testing.T) {
			bad := m
			p := proof
			switch name {
			case "wrong engine checkpoint":
				bad.EngineAppHash = bytes.Repeat([]byte{1}, 32)
			case "wrong original envelope":
				bad.Expected.Envelope = bytes.Clone(m.Expected.Envelope)
				bad.Expected.Envelope[0] ^= 1
			case "wrong result proof":
				p.ExecutionProof = bytes.Clone(p.ExecutionProof)
				p.ExecutionProof[len(p.ExecutionProof)-2] ^= 1
			case "expired trust":
				bad.TrustingPeriod = time.Nanosecond
			case "wrong source genesis":
				bad.Pins.CometGenesisSHA256 = strings.Repeat("0", 64)
			}
			if _, err := WritePQLabProofInputs(filepath.Join(pqLabWorkloadTemp(t), "bad"), bad, p, time.Now().UTC()); err == nil {
				t.Fatal("mismatched actual proof material accepted")
			}
		})
	}
	if export := os.Getenv("YNX_PQ_LAB_PROOF_FIXTURE_OUT"); export != "" {
		if err = pqLabFreshDirectory(export); err != nil {
			t.Fatal(err)
		}
		proofRaw, err := json.Marshal(proof)
		if err != nil {
			t.Fatal(err)
		}
		if err = pqLabWriteExclusive(filepath.Join(export, "operator-materials.json"), raw); err != nil {
			t.Fatal(err)
		}
		if err = pqLabWriteExclusive(filepath.Join(export, "proof.json"), proofRaw); err != nil {
			t.Fatal(err)
		}
		t.Log("PQ_LAB_PROOF_PUBLIC_INPUTS_READY actualBlockExecutor=true actualNetwork=false authority=false")
	}
}

func TestPQLabWorkloadMaximumProtocolWhole(t *testing.T) {
	s, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 1024, BatchSize: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if len(s.manifest.Transactions) != 1 || s.manifest.Transactions[0].Type != PQWholeType || s.manifest.Transactions[0].Members != "1024" || s.manifest.FinalOwnerNonce != "1025" {
		t.Fatal("protocol maximum corpus truncated")
	}
	if s.manifest.InitialOwnerBalance != "2049" || s.manifest.FinalOwnerBalance != "1" {
		t.Fatal("maximum corpus underfunded")
	}
}
