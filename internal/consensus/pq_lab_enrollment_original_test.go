//go:build unix

package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type pqLabEnrollmentProducerFixture struct {
	sender     *PQLabSender
	app        *Application
	checkpoint *PQLabSenderCheckpoint
	request    PQLabEnrollmentRequest
	classic    *secp256k1.PrivateKey
	proposed   *ynxbatch.PrivateKey
	dir, pin   string
	credential []byte
}

func newPQLabEnrollmentProducerFixture(t *testing.T) *pqLabEnrollmentProducerFixture {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 1, Transfers: 3, BatchSize: 1, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(source.Destroy)
	bound := pqLabBoundFixture(t, source.Migration)
	dir := filepath.Join(pqLabWorkloadTemp(t), "workload")
	if _, err = source.WriteCorpus(dir, bound.migration); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "PUBLIC-WORKLOAD.json"))
	if err != nil {
		t.Fatal(err)
	}
	pin := pqLabSHA(raw)
	credential, err := os.ReadFile(filepath.Join(dir, "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { clear(credential) })
	sender, err := OpenPQLabSender(dir, pin, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sender.Close() })
	app, err := NewPersistentApplication(bound.migration, filepath.Join(pqLabWorkloadTemp(t), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := pqLabSenderTestCheckpoint(t, app, bound.migration)
	classic := deterministicPrivateKey(229)
	t.Cleanup(classic.Zero)
	target := mustNativeAddress(t, classic)
	proposed, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(proposed.Destroy)
	request := PQLabEnrollmentRequest{Version: "YNX-PQ-LAB-ENROLLMENT-REQUEST/v1", FundingOperationID: strings.Repeat("a", 64), MigrationOperationID: strings.Repeat("b", 64), OwnerIndex: 0, FundingNonce: 2, TargetOwner: target, FundingAmount: 3, ActivationHeight: uint64(checkpoint.state.Height + 2), PKA: pub.PKA, PKB: pub.PKB}
	return &pqLabEnrollmentProducerFixture{sender: sender, app: app, checkpoint: checkpoint, request: request, classic: classic, proposed: proposed, dir: dir, pin: pin, credential: credential}
}
func (f *pqLabEnrollmentProducerFixture) files(t *testing.T, id string) []byte {
	t.Helper()
	dir, err := f.sender.operation(id)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "transaction.abci"))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestPQLabEnrollmentOriginalDurableSameChainAndCold(t *testing.T) {
	f := newPQLabEnrollmentProducerFixture(t)
	signed, err := f.sender.SignPQLabEnrollmentOriginals(f.request, f.checkpoint, f.classic, f.proposed)
	if err != nil {
		t.Fatal(err)
	}
	if !signed.SyntheticOnly || signed.AuthorityGranted || signed.CurrentEligibility != "UNKNOWN" || signed.Status != "signed-originals" {
		t.Fatal("sign result gained authority", signed)
	}
	// A signed original is not a finalized transaction; unresolved operation
	// blocks a fresh sender operation even when caller proposes a new nonce.
	next := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("c", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}
	if _, err = f.sender.Sign(next, f.checkpoint); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("unconfirmed enrollment permitted nonce reuse", err)
	}
	funding, migration := f.files(t, f.request.FundingOperationID), f.files(t, f.request.MigrationOperationID)
	check, err := f.app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: funding})
	if err != nil || check.Code != 0 {
		t.Fatal("funding CheckTx", err, check)
	}
	h := f.app.committed.Height + 1
	block, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: [][]byte{funding, migration}})
	if err != nil || len(block.TxResults) != 2 || block.TxResults[0].Code != 0 || block.TxResults[1].Code != 0 {
		t.Fatal("same-chain originals failed", err, block)
	}
	if _, err = f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	account := queryConsensusAccount(t, f.app, f.request.TargetOwner)
	if account.Balance != 2 || account.Nonce != 1 {
		t.Fatal("migration lost balance or nonce", account)
	}
	recovered, err := f.sender.RecoverPQLabEnrollmentOriginals(f.request)
	if err != nil || !reflect.DeepEqual(recovered, signed) {
		t.Fatal("original recovery differs", err)
	}
	if _, err = f.sender.SignPQLabEnrollmentOriginals(f.request, f.checkpoint, f.classic, f.proposed); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("existing original was signed again", err)
	}
	if err = f.sender.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenPQLabSender(f.dir, f.pin, 0, f.credential)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	recovered, err = reopened.RecoverPQLabEnrollmentOriginals(f.request)
	if err != nil || !reflect.DeepEqual(recovered, signed) {
		t.Fatal("cold original recovery differs", err)
	}
	cold, err := NewPersistentApplication(f.app.migration, f.app.statePath)
	if err != nil || !reflect.DeepEqual(cold.committed, f.app.committed) {
		t.Fatal("cold state differs", err)
	}
}

func TestPQLabEnrollmentOriginalUnknownPreservesCrashWindows(t *testing.T) {
	for _, stage := range []string{"fund-directory", "migration-directory", "intents", "funding-signed", "migration-signed", "result-funding"} {
		t.Run(stage, func(t *testing.T) {
			f := newPQLabEnrollmentProducerFixture(t)
			calls := 0
			_, err := f.sender.signPQLabEnrollmentOriginals(f.request, f.checkpoint, f.classic, f.proposed, func(got string) error {
				calls++
				if got == stage || stage == "result-funding" && got == "result-"+f.request.FundingOperationID {
					return errors.New("injected durable fault")
				}
				return nil
			})
			if !errors.Is(err, ErrPQLabSenderUnknown) || calls == 0 {
				t.Fatal("fault not UNKNOWN", stage, err)
			}
			dir, _ := f.sender.operation(f.request.FundingOperationID)
			before, err := os.ReadDir(dir)
			if err != nil {
				t.Fatal(err)
			}
			if err = f.sender.Close(); err != nil {
				t.Fatal(err)
			}
			reopened, err := OpenPQLabSender(f.dir, f.pin, 0, f.credential)
			if err != nil {
				t.Fatal(err)
			}
			f.sender = reopened
			defer reopened.Close()
			if _, err = f.sender.RecoverPQLabEnrollmentOriginals(f.request); !errors.Is(err, ErrPQLabSenderUnknown) {
				t.Fatal("partial original was reconstructed", err)
			}
			changed := f.request
			changed.FundingNonce++
			if _, err = f.sender.RecoverPQLabEnrollmentOriginals(changed); !errors.Is(err, ErrPQLabSenderUnknown) {
				t.Fatal("changed original recovered", err)
			}
			if _, err = f.sender.SignPQLabEnrollmentOriginals(f.request, f.checkpoint, f.classic, f.proposed); !errors.Is(err, ErrPQLabSenderUnknown) {
				t.Fatal("UNKNOWN signed again", err)
			}
			after, err := os.ReadDir(dir)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatal("UNKNOWN original changed", err)
			}
		})
	}
}

func TestPQLabEnrollmentOriginalRequestAndResultTampering(t *testing.T) {
	f := newPQLabEnrollmentProducerFixture(t)
	if _, err := f.sender.SignPQLabEnrollmentOriginals(f.request, f.checkpoint, f.classic, f.proposed); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"changed nonce", "different migration operation", "changed target"} {
		t.Run(mode, func(t *testing.T) {
			r := f.request
			switch mode {
			case "changed nonce":
				r.FundingNonce++
			case "different migration operation":
				r.MigrationOperationID = strings.Repeat("d", 64)
			case "changed target":
				r.TargetOwner = f.sender.owner.Owner
			}
			if _, err := f.sender.RecoverPQLabEnrollmentOriginals(r); !errors.Is(err, ErrPQLabSenderUnknown) {
				t.Fatal("retargeted original accepted", err)
			}
		})
	}
	dir, _ := f.sender.operation(f.request.MigrationOperationID)
	path := filepath.Join(dir, "transaction.abci")
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	modified := bytes.Clone(original)
	modified[len(modified)-1] ^= 1
	if err = os.WriteFile(path, modified, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = f.sender.RecoverPQLabEnrollmentOriginals(f.request); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("modified signed bytes accepted", err)
	}
	now, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(now, modified) {
		t.Fatal("read-only recovery modified original", err)
	}
	if _, err = hex.DecodeString(f.request.FundingOperationID); err != nil {
		t.Fatal(err)
	}
}

func TestPQLabEnrollmentOriginalPostSignCheckpointChangeUnknown(t *testing.T) {
	f := newPQLabEnrollmentProducerFixture(t)
	calls := 0
	cause := errors.New("synthetic original checkpoint advanced")
	f.checkpoint.current = func() error { calls++; if calls == 2 { return cause }; return nil }
	if _, err := f.sender.SignPQLabEnrollmentOriginals(f.request, f.checkpoint, f.classic, f.proposed); !errors.Is(err, ErrPQLabSenderUnknown) || !errors.Is(err, cause) || calls != 2 { t.Fatal("post-sign checkpoint change lost UNKNOWN/first cause", err, calls) }
	beforeFund := f.files(t, f.request.FundingOperationID)
	beforeMigration := f.files(t, f.request.MigrationOperationID)
	if _, err := f.sender.RecoverPQLabEnrollmentOriginals(f.request); !errors.Is(err, ErrPQLabSenderUnknown) { t.Fatal("post-sign unknown was promoted", err) }
	if _, err := f.sender.SignPQLabEnrollmentOriginals(f.request, f.checkpoint, f.classic, f.proposed); !errors.Is(err, ErrPQLabSenderUnknown) || calls != 2 { t.Fatal("post-sign unknown was re-signed", err, calls) }
	if !bytes.Equal(beforeFund, f.files(t, f.request.FundingOperationID)) || !bytes.Equal(beforeMigration, f.files(t, f.request.MigrationOperationID)) { t.Fatal("post-sign original bytes changed") }
}

func TestPQLabEnrollmentOriginalConfirmationSameChainAndCold(t *testing.T) {
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 1, Transfers: 4, BatchSize: 1, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	var sender *PQLabSender
	var request PQLabEnrollmentRequest
	var signed PQLabEnrollmentOriginalResult
	var directory, pin string
	var credential []byte
	var migrationEnvelope, migrationWire []byte
	fundMaterials, fundProof, h := pqLabProofFixtureSource(t, source, func(h *engineWiringHarness) (PQLabWorkloadTransaction, []byte, []byte) {
		directory = filepath.Join(pqLabWorkloadTemp(t), "workload")
		if _, e := source.WriteCorpus(directory, h.f.migration); e != nil {
			t.Fatal(e)
		}
		raw, e := os.ReadFile(filepath.Join(directory, "PUBLIC-WORKLOAD.json"))
		if e != nil {
			t.Fatal(e)
		}
		pin = pqLabSHA(raw)
		credential, e = os.ReadFile(filepath.Join(directory, "private-senders", "recovery.raw"))
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { clear(credential) })
		sender, e = OpenPQLabSender(directory, pin, 0, credential)
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { _ = sender.Close() })
		classic := deterministicPrivateKey(228)
		t.Cleanup(classic.Zero)
		owner := mustNativeAddress(t, classic)
		target, pub, e := ynxbatch.KeyGen()
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(target.Destroy)
		cp := pqLabSenderTestCheckpoint(t, h.app, h.f.migration)
		request = PQLabEnrollmentRequest{Version: "YNX-PQ-LAB-ENROLLMENT-REQUEST/v1", FundingOperationID: strings.Repeat("a", 64), MigrationOperationID: strings.Repeat("b", 64), OwnerIndex: 0, FundingNonce: 2, TargetOwner: owner, FundingAmount: 3, ActivationHeight: uint64(cp.state.Height + 8), PKA: pub.PKA, PKB: pub.PKB}
		signed, e = sender.SignPQLabEnrollmentOriginals(request, cp, classic, target)
		if e != nil {
			t.Fatal(e)
		}
		fd, _ := sender.operation(request.FundingOperationID)
		md, _ := sender.operation(request.MigrationOperationID)
		fundWire, e := os.ReadFile(filepath.Join(fd, "transaction.wire"))
		if e != nil {
			t.Fatal(e)
		}
		fundEnvelope, e := os.ReadFile(filepath.Join(fd, "transaction.abci"))
		if e != nil {
			t.Fatal(e)
		}
		migrationWire, e = os.ReadFile(filepath.Join(md, "transaction.wire"))
		if e != nil {
			t.Fatal(e)
		}
		migrationEnvelope, e = os.ReadFile(filepath.Join(md, "transaction.abci"))
		if e != nil {
			t.Fatal(e)
		}
		return PQLabWorkloadTransaction{Type: PQTransferType}, fundWire, fundEnvelope
	})
	migrationHeight := h.app.committed.Height + 1
	h.apply(t, cmttypes.Txs{migrationEnvelope})
	h.apply(t, nil)
	response, err := h.raw.LoadFinalizeBlockResponse(migrationHeight)
	if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
		t.Fatal("actual original migration failed", err, response)
	}
	light := &pqLightProofFixture{harness: h}
	b, successor := light.block(t, migrationHeight), light.block(t, migrationHeight+1)
	statement := func(v *cmttypes.LightBlock) PQLightProofExpectation {
		return PQLightProofExpectation{ChainID: v.ChainID, HeaderHeight: v.Height, BlockHash: bytes.Clone(v.Hash()), StateHeight: v.Height - 1, StateAppHash: bytes.Clone(v.AppHash)}
	}
	outer, native := sha256.Sum256(migrationEnvelope), sha256.Sum256(migrationWire)
	expected := PQTransactionProofExpectation{Block: statement(b), Successor: statement(successor), TransactionType: PQMigrationType, Envelope: migrationEnvelope, NativeWire: migrationWire, TransactionHash: outer[:], NativeWireHash: native[:], Index: 0}
	txProof, err := cmtjson.Marshal(h.blocks.LoadBlock(migrationHeight).Data.Txs.Proof(0))
	if err != nil {
		t.Fatal(err)
	}
	execution, resultProof, err := EncodePQTransactionExecutionProof(response.TxResults, 0)
	if err != nil {
		t.Fatal(err)
	}
	migrationProof := PQTransactionProofRequest{Version: PQTransactionProofVersion, Block: light.encode(t, b), Successor: light.encode(t, successor), TransactionProof: txProof, ExecutionResult: execution, ExecutionProof: resultProof}
	currentState, err := os.ReadFile(h.path)
	if err != nil {
		t.Fatal(err)
	}
	engine, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	fundMaterials.CommittedState = currentState
	fundMaterials.EngineHeight = engine.LastBlockHeight
	fundMaterials.EngineAppHash = bytes.Clone(engine.AppHash)
	migrationMaterials := fundMaterials
	migrationMaterials.Expected = expected
	before := pqLabSenderTestCheckpoint(t, h.app, h.f.migration)
	next := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("c", 64), OwnerIndex: 0, FirstNonce: 3, Members: 1}
	if _, err = sender.Sign(next, before); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("unconfirmed originals permitted next nonce", err)
	}
	wrongTrust := migrationMaterials
	wrongTrust.EngineAppHash = bytes.Repeat([]byte{0x71}, 32)
	if _, err = sender.ConfirmPQLabEnrollmentOriginals(request, fundMaterials, wrongTrust, fundProof, migrationProof, time.Now().UTC()); err == nil {
		t.Fatal("different independent checkpoint accepted")
	}
	if _, err = sender.Sign(next, before); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("split checkpoint unblocked next nonce", err)
	}
	bad := migrationProof
	bad.ExecutionResult = []byte{1, 2, 3}
	if _, err = sender.ConfirmPQLabEnrollmentOriginals(request, fundMaterials, migrationMaterials, fundProof, bad, time.Now().UTC()); err == nil {
		t.Fatal("bad original migration proof confirmed")
	}
	if _, err = sender.Sign(next, before); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("single proof unblocked next nonce", err)
	}
	sender.enrollmentConfirmedFileSync = func(f *os.File) error {
		if filepath.Base(filepath.Dir(f.Name())) == request.FundingOperationID {
			return errors.New("synthetic file fsync failure")
		}
		return f.Sync()
	}
	_, err = sender.ConfirmPQLabEnrollmentOriginals(request, fundMaterials, migrationMaterials, fundProof, migrationProof, time.Now().UTC())
	sender.enrollmentConfirmedFileSync = nil
	if !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("partial confirmation did not remain UNKNOWN", err)
	}
	if _, err = sender.Sign(next, before); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("partial confirmation unblocked next nonce", err)
	}
	fundDir, _ := sender.operation(request.FundingOperationID)
	confirmPath := filepath.Join(fundDir, "CONFIRMED.json")
	originalConfirm, err := os.ReadFile(confirmPath)
	if err != nil {
		t.Fatal(err)
	}
	tamperedConfirm := bytes.Clone(originalConfirm)
	tamperedConfirm[len(tamperedConfirm)-1] ^= 1
	if err = os.WriteFile(confirmPath, tamperedConfirm, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = sender.ConfirmPQLabEnrollmentOriginals(request, fundMaterials, migrationMaterials, fundProof, migrationProof, time.Now().UTC()); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("damaged confirmed record accepted", err)
	}
	if _, err = sender.Sign(next, before); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("damaged confirmed record unblocked next nonce", err)
	}
	// The preceding corruption was injected only into this isolated fixture.
	if err = os.WriteFile(confirmPath, originalConfirm, 0600); err != nil {
		t.Fatal(err)
	}
	if err = sender.Close(); err != nil {
		t.Fatal(err)
	}
	sender, err = OpenPQLabSender(directory, pin, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	sender.enrollmentConfirmedDirectorySync = func(dir *os.File) error {
		if filepath.Base(dir.Name()) == request.MigrationOperationID {
			return errors.New("synthetic directory fsync failure")
		}
		return dir.Sync()
	}
	_, err = sender.ConfirmPQLabEnrollmentOriginals(request, fundMaterials, migrationMaterials, fundProof, migrationProof, time.Now().UTC())
	sender.enrollmentConfirmedDirectorySync = nil
	if !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("second confirmation failure lost UNKNOWN", err)
	}
	var replacedPath string
	sender.enrollmentConfirmedSync = func(path string) error {
		if err := syncPQLabEnrollmentConfirmed(path); err != nil {
			return err
		}
		if filepath.Base(filepath.Dir(path)) == request.MigrationOperationID {
			original, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if err = os.Rename(path, path+".held"); err != nil {
				return err
			}
			if err = os.WriteFile(path, original, 0600); err != nil {
				return err
			}
			replacedPath = path
		}
		return nil
	}
	if _, err = sender.Sign(next, before); !errors.Is(err, ErrPQLabSenderUnknown) || replacedPath == "" {
		t.Fatal("same-byte inode replacement escaped barrier", err)
	}
	// Undo only the explicitly injected replacement inside this isolated test.
	if err = os.Remove(replacedPath); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(replacedPath+".held", replacedPath); err != nil {
		t.Fatal(err)
	}
	sender.enrollmentConfirmedSync = func(path string) error {
		if filepath.Base(filepath.Dir(path)) == request.MigrationOperationID {
			return errors.New("synthetic confirmation fsync failure")
		}
		return syncPQLabEnrollmentConfirmed(path)
	}
	if _, err = sender.Sign(next, before); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("old sender bypassed confirmation barrier", err)
	}
	otherClassic := deterministicPrivateKey(227)
	defer otherClassic.Zero()
	otherKey, otherPub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer otherKey.Destroy()
	otherRequest := PQLabEnrollmentRequest{Version: "YNX-PQ-LAB-ENROLLMENT-REQUEST/v1", FundingOperationID: strings.Repeat("d", 64), MigrationOperationID: strings.Repeat("e", 64), OwnerIndex: 0, FundingNonce: 3, TargetOwner: mustNativeAddress(t, otherClassic), FundingAmount: 3, ActivationHeight: uint64(before.state.Height + 2), PKA: otherPub.PKA, PKB: otherPub.PKB}
	if _, err = sender.SignPQLabEnrollmentOriginals(otherRequest, before, otherClassic, otherKey); !errors.Is(err, ErrPQLabSenderUnknown) {
		t.Fatal("enrollment sender bypassed confirmation barrier", err)
	}
	if err = sender.Close(); err != nil {
		t.Fatal(err)
	}
	sender, err = OpenPQLabSender(directory, pin, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	confirmation, err := sender.ConfirmPQLabEnrollmentOriginals(request, fundMaterials, migrationMaterials, fundProof, migrationProof, time.Now().UTC())
	if err != nil {
		t.Fatal("two exact signed historical proofs", err)
	}
	if confirmation.CurrentEligibility != "UNKNOWN" || confirmation.AuthorityGranted || !confirmation.Funding.Result.ExecutionSuccessful || !confirmation.Migration.Result.ExecutionSuccessful || confirmation.Historical.NativeGrant {
		t.Fatal("confirmation granted authority", confirmation)
	}
	if err = sender.Close(); err != nil {
		t.Fatal(err)
	}
	sender, err = OpenPQLabSender(directory, pin, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	defer sender.Close()
	recovered, err := sender.RecoverPQLabEnrollmentOriginals(request)
	if err != nil || !reflect.DeepEqual(recovered, signed) {
		t.Fatal("cold signed originals lost", err)
	}
	again, err := sender.ConfirmPQLabEnrollmentOriginals(request, fundMaterials, migrationMaterials, fundProof, migrationProof, time.Now().UTC())
	if err != nil || !reflect.DeepEqual(again, confirmation) {
		t.Fatal("cold original proof recovery changed", err)
	}
	if _, err = sender.Sign(next, pqLabSenderTestCheckpoint(t, h.app, h.f.migration)); err != nil {
		t.Fatal("fully finalized originals did not release normal next nonce", err)
	}
}

// Actual committed ABCI transitions; not BFT finality or proof that a failed
// original cannot be accepted later under changed state.
func TestPQLabEnrollmentOriginalRejectedABCIStateSemantics(t *testing.T) {
	t.Run("migration-expired", func(t *testing.T) {
		f := newPQLabEnrollmentProducerFixture(t)
		if _, err := f.sender.SignPQLabEnrollmentOriginals(f.request, f.checkpoint, f.classic, f.proposed); err != nil {
			t.Fatal(err)
		}
		funding, migration := f.files(t, f.request.FundingOperationID), f.files(t, f.request.MigrationOperationID)
		h := f.app.committed.Height + 1
		first, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: [][]byte{funding}})
		if err != nil || first.TxResults[0].Code != 0 {
			t.Fatal("funding failed", err, first)
		}
		if _, err = f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		h++
		if uint64(h) != f.request.ActivationHeight {
			t.Fatal("fixture must execute migration at forbidden activation height")
		}
		rejected, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: [][]byte{migration}})
		if err != nil || rejected.TxResults[0].Code == 0 {
			t.Fatal("expired migration unexpectedly accepted", err, rejected)
		}
		if _, err = f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		target := queryConsensusAccount(t, f.app, f.request.TargetOwner)
		sponsor := queryConsensusAccount(t, f.app, f.sender.owner.Owner)
		if target.Balance != 3 || target.Nonce != 0 || sponsor.Balance != 3 || sponsor.Nonce != 2 {
			t.Fatal("rejected migration changed nonce/fees", target, sponsor)
		}
		if _, ok := f.app.committed.AccountPolicy.PolicyAt(f.request.TargetOwner, uint64(h+1)); ok {
			t.Fatal("rejected migration installed PQ policy")
		}
	})
	t.Run("funding-stale-nonce", func(t *testing.T) {
		f := newPQLabEnrollmentProducerFixture(t)
		if _, err := f.sender.SignPQLabEnrollmentOriginals(f.request, f.checkpoint, f.classic, f.proposed); err != nil {
			t.Fatal(err)
		}
		funding, migration := f.files(t, f.request.FundingOperationID), f.files(t, f.request.MigrationOperationID)
		_, _, firstEnvelope, err := pqLabSignTransferGroup(f.sender.key, f.checkpoint.state.AccountPolicy, f.sender.owner, 2, 1, uint64(f.checkpoint.state.Height+1))
		if err != nil {
			t.Fatal(err)
		}
		h := f.app.committed.Height + 1
		prior, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: [][]byte{firstEnvelope}})
		if err != nil || prior.TxResults[0].Code != 0 {
			t.Fatal("prior nonce execution failed", err, prior)
		}
		if _, err = f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		h++
		rejected, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Time: time.Unix(h, 0).UTC(), Txs: [][]byte{funding, migration}})
		if err != nil || len(rejected.TxResults) != 2 || rejected.TxResults[0].Code == 0 || rejected.TxResults[1].Code == 0 {
			t.Fatal("stale funding/unfunded migration unexpectedly accepted", err, rejected)
		}
		if _, err = f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		sponsor := queryConsensusAccount(t, f.app, f.sender.owner.Owner)
		if sponsor.Nonce != 2 || sponsor.Balance != 5 {
			t.Fatal("rejected funding changed sponsor nonce/fees", sponsor)
		}
		if _, exists := accountIndex(f.app.committed.Accounts, f.request.TargetOwner); exists {
			t.Fatal("rejected funding created target")
		}
	})
}
