package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/proxy"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

// headerProbe is a test-only ABCI wrapper. It is not an observation API and
// does not authenticate a node, source, process, block part set, or finality.
type headerProbe struct {
	abci.Application
	finalizedHeight  int64
	finalizedHeader  []byte
	finalizedAppHash []byte
	commitReturned   bool
}

func TestSyntheticCommitHeaderCaptureDoesNotReviveAttempts(t *testing.T) {
	f := newCommitObservationFixture(t)
	app, _, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "state"), false)
	ctx := context.Background()
	finalize := func(height int64, hash []byte) error {
		snapshot, err := app.CommittedPQEngineSnapshot()
		if err != nil {
			return err
		}
		next, err := snapshot.ExpectedValidatorHash(height + 1)
		if err != nil {
			return err
		}
		_, err = app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Hash: hash, Time: time.Unix(1800000000+height, 0), NextValidatorsHash: next})
		return err
	}
	commit := func() {
		t.Helper()
		if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	h := f.doc.InitialHeight
	hash := bytes.Repeat([]byte{0x37}, 32)
	if err := finalize(h, hash); err != nil {
		t.Fatal(err)
	}
	if err := app.SetSyntheticCommitHeaderCapture(true); err == nil {
		t.Fatal("capture enabled retroactively on an already pending block")
	}
	commit()
	if _, ok := app.LastSyntheticCommitHeader(); ok {
		t.Fatal("an unobserved pending block gained a header")
	}
	if err := app.SetSyntheticCommitHeaderCapture(true); err != nil {
		t.Fatal(err)
	}
	if err := finalize(h+1, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h + 2, Hash: hash}); err == nil {
		t.Fatal("duplicate finalize unexpectedly succeeded")
	}
	commit()
	if _, ok := app.LastSyntheticCommitHeader(); ok {
		t.Fatal("a failed intervening finalize revived the original pending header")
	}
	for i, invalid := range [][]byte{nil, make([]byte, 31), make([]byte, 33), make([]byte, 32)} {
		if err := finalize(h+2+int64(i), invalid); err != nil {
			t.Fatal(err)
		}
		commit()
		if _, ok := app.LastSyntheticCommitHeader(); ok {
			t.Fatalf("invalid header hash %d was invented", i)
		}
	}
	original := bytes.Clone(hash)
	if err := finalize(h+6, hash); err != nil {
		t.Fatal(err)
	}
	hash[0] ^= 0xff // caller mutation must not modify the owned snapshot
	commit()
	got, ok := app.LastSyntheticCommitHeader()
	if !ok || got.CaptureEpoch == 0 || got.Attempt == 0 || !bytes.Equal(got.HeaderHash[:], original) {
		t.Fatal("fresh valid attempt should be observed")
	}
	if err := finalize(h+7, original); err != nil {
		t.Fatal(err)
	}
	commit()
	advanced, ok := app.LastSyntheticCommitHeader()
	if !ok || advanced.CaptureEpoch != got.CaptureEpoch || advanced.Attempt <= got.Attempt {
		t.Fatal("successive commits shared an attempt identity")
	}
	if err := app.SetSyntheticCommitHeaderCapture(false); err != nil {
		t.Fatal(err)
	}
	if _, ok := app.LastSyntheticCommitHeader(); ok {
		t.Fatal("disabling retained a header")
	}
	if err := app.SetSyntheticCommitHeaderCapture(true); err != nil {
		t.Fatal(err)
	}
	if _, ok := app.LastSyntheticCommitHeader(); ok {
		t.Fatal("re-enabling revived an old observation")
	}
	if err := finalize(h+8, original); err != nil {
		t.Fatal(err)
	}
	commit()
	newer, ok := app.LastSyntheticCommitHeader()
	if !ok || newer.CaptureEpoch <= got.CaptureEpoch || newer.Attempt != 1 {
		t.Fatal("re-enabling did not create a fresh capture epoch")
	}
}

func TestSyntheticCommitHeaderCaptureDoesNotReviveFailedPersistence(t *testing.T) {
	f := newCommitObservationFixture(t)
	root := t.TempDir()
	dir := filepath.Join(root, "state-dir")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	app, _, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(dir, "state"), false)
	if err := app.SetSyntheticCommitHeaderCapture(true); err != nil {
		t.Fatal(err)
	}
	app.SetCommitTimingEnabled(true)
	snapshot, err := app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	h := f.doc.InitialHeight
	next, err := snapshot.ExpectedValidatorHash(h + 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Hash: bytes.Repeat([]byte{0x37}, 32), Time: time.Unix(1800000000+h, 0), NextValidatorsHash: next}); err != nil {
		t.Fatal(err)
	}
	// Move only this test's private temporary state directory aside, and put a
	// regular file at its old name so the real persistence call fails.
	held := filepath.Join(root, "held-state-dir")
	if err := os.Rename(dir, held); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir, []byte("test-only blocker"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
		t.Fatal("real persistence unexpectedly succeeded")
	}
	if _, ok := app.LastSyntheticCommitHeader(); ok {
		t.Fatal("failed persistence exposed a commit header")
	}
	if _, _, ok := app.LastSyntheticCommitHeaderAndTiming(); ok {
		t.Fatal("failed persistence exposed an atomic header and timing")
	}
	if err := os.Remove(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(held, dir); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	if _, ok := app.LastSyntheticCommitHeader(); ok {
		t.Fatal("retry after failed persistence revived the discarded header")
	}
	if _, _, ok := app.LastSyntheticCommitHeaderAndTiming(); ok {
		t.Fatal("retry revived an atomic header and timing")
	}
}

func TestSyntheticCommitHeaderCaptureStateSyncInvalidates(t *testing.T) {
	f := newCommitObservationFixture(t)
	source, _, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "source"), false)
	target, _, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "target"), false)
	if err := target.SetSyntheticCommitHeaderCapture(true); err != nil {
		t.Fatal(err)
	}
	target.SetCommitTimingEnabled(true)
	ctx := context.Background()
	advance := func(app *consensus.Application, h int64) {
		t.Helper()
		snapshot, err := app.CommittedPQEngineSnapshot()
		if err != nil {
			t.Fatal(err)
		}
		next, err := snapshot.ExpectedValidatorHash(h + 1)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, Hash: bytes.Repeat([]byte{byte(h)}, 32), Time: time.Unix(1800000000+h, 0), NextValidatorsHash: next}); err != nil {
			t.Fatal(err)
		}
		if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	h := f.doc.InitialHeight
	advance(source, h)
	advance(target, h)
	if _, ok := target.LastSyntheticCommitHeader(); !ok {
		t.Fatal("target did not capture its own original commit")
	}
	if _, _, ok := target.LastSyntheticCommitHeaderAndTiming(); !ok {
		t.Fatal("target did not capture its own atomic timing")
	}
	advance(source, h+1)
	advance(source, h+2)
	info, err := source.Info(ctx, &abci.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	list, err := source.ListSnapshots(ctx, &abci.RequestListSnapshots{})
	if err != nil || len(list.Snapshots) != 1 {
		t.Fatalf("source snapshot unavailable: %v", err)
	}
	snapshot := list.Snapshots[0]
	offer, err := target.OfferSnapshot(ctx, &abci.RequestOfferSnapshot{Snapshot: snapshot, AppHash: info.LastBlockAppHash})
	if err != nil || offer.Result != abci.ResponseOfferSnapshot_ACCEPT {
		t.Fatalf("snapshot offer not accepted: %v", err)
	}
	if _, ok := target.LastSyntheticCommitHeader(); ok {
		t.Fatal("state-sync offer retained the old header")
	}
	if _, _, ok := target.LastSyntheticCommitHeaderAndTiming(); ok {
		t.Fatal("state-sync offer retained the old atomic timing")
	}
	// The application accepts ordinary calls while chunks are outstanding.
	// They must not publish an observation during the restore.
	advance(target, h+1)
	if _, ok := target.LastSyntheticCommitHeader(); ok {
		t.Fatal("commit during state sync published a header")
	}
	if _, _, ok := target.LastSyntheticCommitHeaderAndTiming(); ok {
		t.Fatal("commit during state sync published an atomic timing")
	}
	bad, err := target.ApplySnapshotChunk(ctx, &abci.RequestApplySnapshotChunk{Index: 0})
	if err != nil || bad.Result != abci.ResponseApplySnapshotChunk_REJECT_SNAPSHOT {
		t.Fatalf("invalid snapshot chunk not rejected: %v", err)
	}
	if _, ok := target.LastSyntheticCommitHeader(); ok {
		t.Fatal("failed restore revived a header")
	}
	if _, _, ok := target.LastSyntheticCommitHeaderAndTiming(); ok {
		t.Fatal("failed restore revived an atomic timing")
	}
	offer, err = target.OfferSnapshot(ctx, &abci.RequestOfferSnapshot{Snapshot: snapshot, AppHash: info.LastBlockAppHash})
	if err != nil || offer.Result != abci.ResponseOfferSnapshot_ACCEPT {
		t.Fatalf("retrying synthetic snapshot offer failed: %v", err)
	}
	for index := uint32(0); index < snapshot.Chunks; index++ {
		chunk, err := source.LoadSnapshotChunk(ctx, &abci.RequestLoadSnapshotChunk{Height: snapshot.Height, Format: snapshot.Format, Chunk: index})
		if err != nil {
			t.Fatal(err)
		}
		applied, err := target.ApplySnapshotChunk(ctx, &abci.RequestApplySnapshotChunk{Index: index, Chunk: chunk.Chunk, Sender: "synthetic-source"})
		if err != nil || applied.Result != abci.ResponseApplySnapshotChunk_ACCEPT {
			t.Fatalf("snapshot chunk %d not accepted: %v", index, err)
		}
	}
	if _, ok := target.LastSyntheticCommitHeader(); ok {
		t.Fatal("restored state was reported as this instance's Commit")
	}
	if _, _, ok := target.LastSyntheticCommitHeaderAndTiming(); ok {
		t.Fatal("restored state was reported as an atomic Commit timing")
	}
}

func TestSyntheticCommitHeaderConcurrentReaders(t *testing.T) {
	f := newCommitObservationFixture(t)
	app, _, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "state"), false)
	if err := app.SetSyntheticCommitHeaderCapture(true); err != nil {
		t.Fatal(err)
	}
	app.SetCommitTimingEnabled(true)
	stop := make(chan struct{})
	ready := make(chan struct{}, 4)
	errs := make(chan string, 4)
	var wg sync.WaitGroup
	var reads atomic.Int64
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ready <- struct{}{}
			for {
				select {
				case <-stop:
					return
				default:
				}
				v, timing, ok := app.LastSyntheticCommitHeaderAndTiming()
				if !ok {
					continue
				}
				reads.Add(1)
				if v.CaptureEpoch == 0 || v.Attempt == 0 || v.Height < f.doc.InitialHeight || v.Height >= f.doc.InitialHeight+8 || !bytes.Equal(v.HeaderHash[:], bytes.Repeat([]byte{byte(v.Height)}, 32)) || v.AppHash == [32]byte{} || !timing.Durable || timing.Height != v.Height {
					select {
					case errs <- "inconsistent owned snapshot":
					default:
					}
					return
				}
			}
		}()
	}
	for i := 0; i < 4; i++ {
		<-ready
	}
	for h := f.doc.InitialHeight; h < f.doc.InitialHeight+8; h++ {
		s, err := app.CommittedPQEngineSnapshot()
		if err != nil {
			close(stop)
			wg.Wait()
			t.Fatal(err)
		}
		next, err := s.ExpectedValidatorHash(h + 1)
		if err != nil {
			close(stop)
			wg.Wait()
			t.Fatal(err)
		}
		if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Hash: bytes.Repeat([]byte{byte(h)}, 32), Time: time.Unix(1800000000+h, 0), NextValidatorsHash: next}); err != nil {
			close(stop)
			wg.Wait()
			t.Fatal(err)
		}
		if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			close(stop)
			wg.Wait()
			t.Fatal(err)
		}
	}
	// Synchronize with at least one reader after the last commit.
	deadline := time.Now().Add(time.Second)
	for reads.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	close(stop)
	wg.Wait()
	if reads.Load() == 0 {
		t.Fatal("no reader observed a committed snapshot")
	}
	select {
	case err := <-errs:
		t.Fatal(err)
	default:
	}
}

func (p *headerProbe) FinalizeBlock(ctx context.Context, req *abci.RequestFinalizeBlock) (*abci.ResponseFinalizeBlock, error) {
	h, header := req.Height, bytes.Clone(req.Hash)
	res, err := p.Application.FinalizeBlock(ctx, req)
	if err == nil && res != nil {
		p.finalizedHeight, p.finalizedHeader, p.finalizedAppHash = h, header, bytes.Clone(res.AppHash)
	}
	return res, err
}

func (p *headerProbe) Commit(ctx context.Context, req *abci.RequestCommit) (*abci.ResponseCommit, error) {
	res, err := p.Application.Commit(ctx, req)
	if err == nil {
		p.commitReturned = true
	}
	return res, err
}

func TestCommitHeaderProbeRealBlockExecutor(t *testing.T) {
	f := newCommitObservationFixture(t)
	app, _, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "state"), false)
	if _, ok := app.LastSyntheticCommitHeader(); ok {
		t.Fatal("header capture must be disabled by default")
	}
	if err := app.SetSyntheticCommitHeaderCapture(true); err != nil {
		t.Fatal(err)
	}
	probe := &headerProbe{Application: app}
	conns := proxy.NewAppConns(proxy.NewLocalClientCreator(probe), proxy.NopMetrics())
	if err := conns.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conns.Stop() }()
	state, err := sm.MakeGenesisState(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	info, err := app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	state.Version.Consensus.App = info.AppVersion
	db := dbm.NewMemDB()
	defer db.Close()
	store := sm.NewStore(db, sm.StoreOptions{})
	if err = store.Save(state); err != nil {
		t.Fatal(err)
	}
	blockDB := dbm.NewMemDB()
	defer blockDB.Close()
	blocks := blockstore.NewBlockStore(blockDB)
	block, err := state.MakeBlock(state.InitialHeight, cmttypes.Txs{f.transfer}, &cmttypes.Commit{}, nil, state.Validators.GetProposer().Address)
	if err != nil {
		t.Fatal(err)
	}
	parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	blockID := cmttypes.BlockID{Hash: bytes.Clone(block.Hash()), PartSetHeader: parts.Header()}
	executor := sm.NewBlockExecutor(sm.WithConsensusAuthorityStore(store, app), log.NewNopLogger().With("module", "state"), conns.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, blocks)
	next, err := executor.ApplyBlock(state, blockID, block)
	if err != nil {
		t.Fatal(err)
	}
	if !probe.commitReturned || probe.finalizedHeight != block.Height || !bytes.Equal(probe.finalizedHeader, blockID.Hash) {
		t.Fatal("original Finalize request header hash did not match the executed BlockID")
	}
	if !next.LastBlockID.Equals(blockID) || !bytes.Equal(next.AppHash, probe.finalizedAppHash) {
		t.Fatal("executed BlockID or application post-state differs")
	}
	observation, ok := app.LastSyntheticCommitHeader()
	if !ok || observation.Height != block.Height || !bytes.Equal(observation.HeaderHash[:], blockID.Hash) || !bytes.Equal(observation.AppHash[:], next.AppHash) {
		t.Fatal("same-application durable header association is unavailable or differs")
	}
	observation.HeaderHash[0] ^= 0xff
	if again, ok := app.LastSyntheticCommitHeader(); !ok || !bytes.Equal(again.HeaderHash[:], blockID.Hash) {
		t.Fatal("caller could mutate the original captured hash")
	}
	// H carries the state hash from before execution.  The state produced by
	// this Commit is carried by the H+1 header; neither header timestamp is a
	// measurement of the instant of BFT finality.
	if bytes.Equal(block.AppHash, probe.finalizedAppHash) {
		t.Fatal("the real transfer did not distinguish pre- and post-state")
	}
	commit := &cmttypes.Commit{Height: block.Height, BlockID: blockID}
	for i, member := range state.Validators.Validators {
		vote := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: block.Height, BlockID: blockID, Timestamp: block.Time.Add(time.Second), ValidatorAddress: bytes.Clone(member.Address), ValidatorIndex: int32(i)}
		for j := range f.migration.Validators {
			key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(121 + j)}, ed25519.SeedSize))
			if bytes.Equal(key.Public().(ed25519.PublicKey), member.PubKey.Bytes()) {
				vote.Signature = ed25519.Sign(key, cmttypes.VoteSignBytes(f.doc.ChainID, vote.ToProto()))
			}
			clear(key)
		}
		if err := vote.Verify(f.doc.ChainID, member.PubKey); err != nil {
			t.Fatal(err)
		}
		commit.Signatures = append(commit.Signatures, vote.CommitSig())
	}
	blocks.SaveBlock(block, parts, commit)
	successor, err := next.MakeBlock(next.LastBlockHeight+1, nil, commit, nil, next.Validators.GetProposer().Address)
	if err != nil {
		t.Fatal(err)
	}
	if !successor.LastBlockID.Equals(blockID) || !bytes.Equal(successor.AppHash, probe.finalizedAppHash) {
		t.Fatal("H+1 did not carry the original H BlockID and post-state")
	}
	successorParts, err := successor.MakePartSet(cmttypes.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	successorID := cmttypes.BlockID{Hash: bytes.Clone(successor.Hash()), PartSetHeader: successorParts.Header()}
	second, err := executor.ApplyBlock(next, successorID, successor)
	if err != nil {
		t.Fatal("actual H+1 BlockExecutor failed", err)
	}
	last, ok := app.LastSyntheticCommitHeader()
	if !ok || last.Height != successor.Height || !bytes.Equal(last.HeaderHash[:], successorID.Hash) || !bytes.Equal(last.AppHash[:], second.AppHash) {
		t.Fatal("actual H+1 commit did not advance the owned observation")
	}
	if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: block.Height}); err == nil {
		t.Fatal("stale finalize unexpectedly accepted")
	}
	if _, ok := app.LastSyntheticCommitHeader(); ok {
		t.Fatal("a failed later finalize reused the old header observation")
	}
}

func TestSyntheticCommitHeaderRealEngineOffOnEquivalent(t *testing.T) {
	f := newCommitObservationFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			var states, fees, hashes [][]byte
			var stores []map[string][]byte
			for _, enabled := range []bool{false, true} {
				dir := t.TempDir()
				app, _, _ := makeObservedOperatorApplication(t, f, layout, filepath.Join(dir, "state"), false)
				if enabled {
					if err := app.SetSyntheticCommitHeaderCapture(true); err != nil {
						t.Fatal(err)
					}
				}
				next, block, err := executeObservedEngineCommit(t, f, app, log.NewNopLogger(), cmttypes.Txs{f.transfer})
				if err != nil {
					t.Fatal(err)
				}
				states = append(states, cometJournalQuery(t, app, "/state", nil))
				fees = append(fees, cometJournalQuery(t, app, "/economics/fees", nil))
				hashes = append(hashes, bytes.Clone(next.AppHash))
				stores = append(stores, commitObservationStateFiles(t, dir))
				value, ok := app.LastSyntheticCommitHeader()
				if ok != enabled || (enabled && (value.Height != block.Height || !bytes.Equal(value.HeaderHash[:], block.Hash()) || !bytes.Equal(value.AppHash[:], next.AppHash))) {
					t.Fatal("header observation does not match the original engine commit")
				}
			}
			if !bytes.Equal(states[0], states[1]) || !bytes.Equal(fees[0], fees[1]) || !bytes.Equal(hashes[0], hashes[1]) || !reflect.DeepEqual(stores[0], stores[1]) {
				t.Fatal("header capture changed state, fees, AppHash, or persisted bytes")
			}
		})
	}
}

func TestSyntheticCommitHeaderAndTimingAtomicSnapshot(t *testing.T) {
	f := newCommitObservationFixture(t)
	app, _, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "state"), false)
	if err := app.SetSyntheticCommitHeaderCapture(true); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := app.LastSyntheticCommitHeaderAndTiming(); ok {
		t.Fatal("missing timing was accepted")
	}
	app.SetCommitTimingEnabled(true)
	next, block, err := executeObservedEngineCommit(t, f, app, log.NewNopLogger(), cmttypes.Txs{f.transfer})
	if err != nil {
		t.Fatal(err)
	}
	header, timing, ok := app.LastSyntheticCommitHeaderAndTiming()
	if !ok || timing.Height != block.Height || !timing.Durable || header.Height != block.Height || !bytes.Equal(header.HeaderHash[:], block.Hash()) || !bytes.Equal(header.AppHash[:], next.AppHash) || len(timing.StagesNs) == 0 {
		t.Fatal("atomic diagnostic did not describe the original application commit")
	}
	for key := range timing.StagesNs {
		timing.StagesNs[key] = -1
	}
	header.HeaderHash[0] ^= 0xff
	again, second, ok := app.LastSyntheticCommitHeaderAndTiming()
	if !ok || !bytes.Equal(again.HeaderHash[:], block.Hash()) {
		t.Fatal("header ownership lost")
	}
	for _, value := range second.StagesNs {
		if value < 0 {
			t.Fatal("timing map ownership lost")
		}
	}
	app.SetCommitTimingEnabled(false)
	app.SetCommitTimingEnabled(true)
	if _, _, ok := app.LastSyntheticCommitHeaderAndTiming(); ok {
		t.Fatal("timing re-enable revived an old association")
	}
}
