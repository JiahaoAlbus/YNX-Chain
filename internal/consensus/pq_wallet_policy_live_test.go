//go:build unix

package consensus

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	sm "github.com/cometbft/cometbft/state"
)

func walletLiveOriginal(t *testing.T) (*proofHostLiveFixture, *PQWalletPolicyLiveSource, string) {
	t.Helper()
	f := newProofHostLiveFixture(t) // actual normal ctor, original DBs/full AND; no Node.Start
	s, err := f.app.WalletPolicyLiveSource()
	if err != nil || s == nil || f.node.IsRunning() || f.node.IsListening() {
		t.Fatal("normal constructor did not bind the non-started actual Node/App", err)
	}
	if len(f.app.committed.AccountPolicy.Records) != 1 {
		t.Fatal("expected the original actually registered account fixture")
	}
	return f, s, f.app.committed.AccountPolicy.Records[0].Owner
}

func walletLivePending(t *testing.T, f *proofHostLiveFixture) {
	t.Helper()
	actual, err := f.node.ProofSourceView()
	if err != nil {
		t.Fatal(err)
	}
	state, err := actual.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := f.app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	height := f.app.committed.Height + 1
	next, err := snapshot.ExpectedValidatorHash(height + 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: state.LastBlockTime.Add(time.Second), NextValidatorsHash: next}); err != nil {
		t.Fatal("actual original FinalizeBlock", err)
	}
	if f.app.pending == nil || f.app.pending.Height != height {
		t.Fatal("actual Finalize did not retain its pending candidate")
	}
}

func TestPQWalletPolicyLiveOriginalNodeCommittedAndPending(t *testing.T) {
	f, source, owner := walletLiveOriginal(t)
	before, err := os.ReadFile(f.app.statePath)
	if err != nil {
		t.Fatal(err)
	}
	read, err := source.Read(context.Background(), owner)
	if err != nil || read == nil {
		t.Fatal("original live policy read", err)
	}
	cp, _ := read.Checkpoint()
	origin, _ := read.Origin()
	view, _ := read.OwnerPolicy()
	if origin != PQWalletPolicyLocalEngineCheckpoint || !view.PQSigningEnabled || view.Owner != owner || view.CommittedHeight != cp.Height || view.ExecutionHeight != uint64(cp.Height+1) || view.ExecutionRegistration == nil {
		t.Fatal("live getter lost original checkpoint or registered account policy")
	}
	// Compare the sealed owner projection with the existing full original-file
	// reader at precisely the actual engine checkpoint, including all full keys.
	offline, err := ReadPQWalletPolicyAtCheckpoint(PQWalletPolicyReadRequest{Migration: f.app.migration, StatePath: f.app.statePath, Bootstrap: f.app.bootstrap, EngineAuthorization: f.app.pqEngineAuthorization, Checkpoint: cp, Owner: owner})
	if err != nil {
		t.Fatal(err)
	}
	want, _ := offline.OwnerPolicy()
	if !reflect.DeepEqual(view, want) {
		t.Fatal("owning live and full cold validation disagree")
	}
	view.PolicyOriginal[0] ^= 1
	view.ExecutionRegistration.PKA[0] ^= 1
	again, _ := read.OwnerPolicy()
	if !reflect.DeepEqual(again, want) {
		t.Fatal("caller mutated sealed policy or full public pair")
	}
	walletLivePending(t, f)
	pending, err := source.Read(context.Background(), owner)
	if err != nil {
		t.Fatal("pending Finalize leaked into original committed read", err)
	}
	pendingCP, _ := pending.Checkpoint()
	pendingView, _ := pending.OwnerPolicy()
	if pendingCP != cp || !reflect.DeepEqual(pendingView, want) {
		t.Fatal("pending candidate changed checkpoint, nonce or registration")
	}
	after, _ := os.ReadFile(f.app.statePath)
	if !bytes.Equal(before, after) {
		t.Fatal("readonly getter or pending Finalize rewrote original committed source")
	}
	if _, err = f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	if out, err := source.Read(context.Background(), owner); err == nil || out != nil {
		t.Fatal("App.Commit ahead of the original engine store was accepted")
	}
}

// A deterministic scheduling context invokes a real state transition only at
// the requested fence. It supplies no checkpoint, view, signature or provider.
type walletLiveFenceContext struct {
	context.Context
	calls int
	at    int
	run   func()
}

func (c *walletLiveFenceContext) Err() error {
	c.calls++
	if c.calls == c.at {
		c.run()
	}
	return c.Context.Err()
}

func TestPQWalletPolicyLiveCurrentCheckpointAndPersistenceFence(t *testing.T) {
	f, source, owner := walletLiveOriginal(t)
	for _, code := range []string{"durability_uncertain", "save_failed", "source_changed"} {
		t.Run(code, func(t *testing.T) {
			original := f.app.persistence
			f.app.persistence.errorCode = code
			out, err := source.Read(context.Background(), owner)
			f.app.persistence = original
			if err == nil || out != nil {
				t.Fatal("unconfirmed original persistence authorized a policy result")
			}
		})
	}
	t.Run("same-bytes-new-original-inode", func(t *testing.T) {
		original, err := os.ReadFile(f.app.statePath)
		if err != nil {
			t.Fatal(err)
		}
		held := f.app.statePath + ".held-test-original"
		if err = os.Rename(f.app.statePath, held); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(f.app.statePath, original, 0600); err != nil {
			t.Fatal(err)
		}
		out, readErr := source.Read(context.Background(), owner)
		if err = os.Remove(f.app.statePath); err != nil {
			t.Fatal(err)
		}
		if err = os.Rename(held, f.app.statePath); err != nil {
			t.Fatal(err)
		}
		if readErr == nil || out != nil {
			t.Fatal("same bytes at a replacement persistence source passed")
		}
	})
	t.Run("node-post-read-block-id-crossing", func(t *testing.T) {
		original, err := source.view.LoadState()
		if err != nil {
			t.Fatal(err)
		}
		raw := sm.NewStore(f.databases["state"], sm.StoreOptions{})
		ctx := &walletLiveFenceContext{Context: context.Background(), at: 3, run: func() {
			changed := original.Copy()
			changed.LastBlockID.Hash = bytes.Clone(original.LastBlockID.Hash)
			changed.LastBlockID.Hash[0] ^= 1
			if err := raw.Save(changed); err != nil {
				t.Fatal(err)
			}
		}}
		out, readErr := source.Read(ctx, owner)
		if err = raw.Save(original); err != nil {
			t.Fatal(err)
		}
		if ctx.calls < 3 || readErr == nil || out != nil {
			t.Fatal("original engine post-read mismatch was not refused")
		}
	})
	t.Run("app-commit-between-projection-and-final-check", func(t *testing.T) {
		ctx := &walletLiveFenceContext{Context: context.Background(), at: 3, run: func() {
			walletLivePending(t, f)
			if _, err := f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
		}}
		out, err := source.Read(ctx, owner)
		if ctx.calls < 3 || err == nil || out != nil {
			t.Fatal("late original App.Commit escaped the post-engine app fence")
		}
	})
}

func TestPQWalletPolicyLiveNoCallerAuthorityAndCancellation(t *testing.T) {
	var nilApp *Application
	for _, app := range []*Application{nilApp, {}, {}} {
		if source, err := app.WalletPolicyLiveSource(); err == nil || source != nil {
			t.Fatal("unbound or zero application produced a live source")
		}
	}
	for _, source := range []*PQWalletPolicyLiveSource{nil, {}} {
		if out, err := source.Read(context.Background(), "0x"+strings.Repeat("1", 40)); err == nil || out != nil {
			t.Fatal("zero source accepted caller owner as engine authority")
		}
	}
	f, source, owner := walletLiveOriginal(t)
	foreign := &Application{pqWalletPolicyLive: source}
	if got, err := foreign.WalletPolicyLiveSource(); err == nil || got != nil {
		t.Fatal("copied reference created a different Node/App pairing")
	}
	if err := bindPQWalletPolicyLiveSource(f.node, f.app); err == nil {
		t.Fatal("normal app was rebound or original lifetime was replaced")
	}
	databaseCalls := 0
	duplicate, duplicateErr := newPQNodeWithDatabase(f.node.Config(), f.app, nil, nil, log.NewNopLogger(), func(*cmtconfig.DBContext) (dbm.DB, error) {
		databaseCalls++
		return nil, errors.New("must not open or initialize another original database")
	})
	if duplicateErr == nil || duplicate != nil || databaseCalls != 0 || !strings.Contains(duplicateErr.Error(), "already paired") {
		t.Fatal("already paired app entered another Node/database constructor", duplicateErr, databaseCalls)
	}
	for _, child := range []pqWalletPolicyProofChild{(*ProofHostLiveControl)(nil), (*PQLabLiveMaterialsControl)(nil), &ProofHostLiveControl{}, &PQLabLiveMaterialsControl{}} {
		if err := f.app.attachWalletPolicyProofChild(f.node, child); err == nil {
			t.Fatal("nil or unbound typed proof child consumed the original lifetime")
		}
	}
	for _, other := range []string{"", strings.ToUpper(owner), "0x" + strings.Repeat("f", 40)} {
		if out, err := source.Read(context.Background(), other); err == nil || out != nil {
			t.Fatal("absent or noncanonical owner acquired another account projection")
		}
	}
	if out, err := source.Read(nil, owner); err == nil || out != nil {
		t.Fatal("nil caller context accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if out, err := source.Read(ctx, owner); !errors.Is(err, context.Canceled) || out != nil {
		t.Fatal("cancelled caller retained a result", err)
	}
	ctx, cancel = context.WithCancel(context.Background())
	fence := &walletLiveFenceContext{Context: ctx, at: 3, run: cancel}
	if out, err := source.Read(fence, owner); !errors.Is(err, context.Canceled) || out != nil {
		t.Fatal("cancellation after projection retained partial output", err)
	}
	if out, err := source.Read(context.Background(), owner); err != nil || out == nil {
		t.Fatal("cancelled readonly call replaced or poisoned original binding", err)
	}
	t.Run("late-bind-failure-closes-owned-resources-once", func(t *testing.T) {
		// Reopen the same actual stores with a fresh app after the original
		// owner stopped. A normal constructor Option occupies the one slot
		// before the app binding, forcing the real post-construction failure.
		f.stop()
		before, err := os.ReadFile(f.app.statePath)
		if err != nil {
			t.Fatal(err)
		}
		app, err := NewPersistentApplicationWithEngineAuthorization(f.app.migration, f.app.statePath, f.app.bootstrap, f.app.pqEngineAuthorization)
		if err != nil {
			t.Fatal(err)
		}
		f.pv.blocked = false
		defer func() { f.pv.blocked = true }()
		dbs := make(map[string]dbm.DB)
		provider := func(ctx *cmtconfig.DBContext) (dbm.DB, error) {
			db, err := cmtconfig.DefaultDBProvider(ctx)
			if err == nil {
				dbs[ctx.ID] = db
			}
			return db, err
		}
		var captured *node.Node
		closed := 0
		out, err := newPQNodeWithDatabase(f.node.Config(), app, f.pv, &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}, log.NewNopLogger(), provider, func(n *node.Node) {
			captured = n
			if err := n.RegisterProofSourceConsumer(func() error { closed++; return nil }); err != nil {
				t.Fatal(err)
			}
		})
		if captured == nil || out != nil || err == nil || err.Error() != "read-only consumer must be registered exactly once before node startup" {
			t.Fatal("bind failure lost its original cause or appended a second proxy Stop error", err)
		}
		if closed != 1 || captured.IsRunning() || captured.ProxyApp().IsRunning() || len(dbs) == 0 {
			t.Fatal("bind failure did not retire the original owner and proxy exactly once", closed)
		}
		for id, db := range dbs {
			if _, err := db.Get([]byte("stateKey")); err == nil {
				t.Fatal("bind failure left an owned database open", id)
			}
		}
		if source, err := app.WalletPolicyLiveSource(); err == nil || source != nil {
			t.Fatal("failed binding left a usable policy source")
		}
		after, err := os.ReadFile(f.app.statePath)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("bind failure changed the original committed source", err)
		}
	})
}

func TestPQWalletPolicyLiveNodeStopDrainsAndRetires(t *testing.T) {
	f, source, owner := walletLiveOriginal(t)
	stateBytes, err := f.databases["state"].Get([]byte("stateKey"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := &walletLiveFenceContext{Context: context.Background(), at: 3}
	entered, release := make(chan struct{}), make(chan struct{})
	ctx.run = func() { close(entered); <-release }
	readDone := make(chan error, 1)
	go func() {
		out, err := source.Read(ctx, owner)
		if out != nil {
			readDone <- errors.New("retired live read returned policy data")
			return
		}
		readDone <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("actual policy read did not reach its post-projection fence")
	}
	if out, err := source.Read(context.Background(), owner); !errors.Is(err, ErrPQWalletPolicyLiveBusy) || out != nil {
		close(release)
		t.Fatal("bounded original source admitted a second simultaneous read", err)
	}
	stopped := make(chan struct{})
	go func() { f.stop(); close(stopped) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		source.mu.Lock()
		retired := source.retired
		source.mu.Unlock()
		if retired {
			break
		}
		if time.Now().After(deadline) {
			close(release)
			t.Fatal("normal Node.OnStop did not retire source before stores")
		}
		time.Sleep(time.Millisecond)
	}
	select {
	case <-stopped:
		close(release)
		t.Fatal("normal Stop returned before its admitted live read joined")
	default:
	}
	original, err := f.databases["state"].Get([]byte("stateKey"))
	if err != nil || !bytes.Equal(original, stateBytes) {
		close(release)
		t.Fatal("normal Stop closed or changed original DB before drain", err)
	}
	if out, err := source.Read(context.Background(), owner); !errors.Is(err, ErrPQWalletPolicyLiveRetired) || out != nil {
		close(release)
		t.Fatal("retiring source renewed its read lifetime", err)
	}
	close(release)
	select {
	case err := <-readDone:
		if !errors.Is(err, ErrPQWalletPolicyLiveRetired) {
			t.Fatal("admitted read did not retain stop failure", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("live reader failed to drain")
	}
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("original Node did not complete Stop after reader joined")
	}
	if _, err = f.databases["state"].Get([]byte("stateKey")); err == nil {
		t.Fatal("actual store remained open after normal Stop")
	}
	if got, err := f.app.WalletPolicyLiveSource(); err == nil || got != nil {
		t.Fatal("stopped Application reacquired a live getter")
	}
	if err := source.Close(); err != nil {
		t.Fatal("normal source close was not idempotent", err)
	}
}

func TestPQWalletPolicyLiveOriginalProofChildComposition(t *testing.T) {
	for _, kind := range []string{"one-shot", "lab"} {
		t.Run(kind, func(t *testing.T) {
			f, source, owner := walletLiveOriginal(t)
			if err := f.node.RegisterProofSourceConsumer(func() error { return nil }); err == nil {
				t.Fatal("normal constructor did not own the single Node slot")
			}
			_, policyPath, pin := f.policy(t, 'a', nil)
			var closeChild func() error
			if kind == "one-shot" {
				child, err := NewProofHostLiveControl(f.node, f.app, policyPath, pin)
				if err != nil {
					t.Fatal("original one-shot constructor did not compose", err)
				}
				closeChild = child.Close
				if err := f.app.attachWalletPolicyProofLab(f.node, &PQLabLiveMaterialsControl{node: f.node, app: f.app}); err == nil {
					t.Fatal("lab child replaced existing one-shot owner")
				}
				// A real descriptor close failure must survive both child and
				// composite Close; no arbitrary callback/error provider is used.
				if err := child.in.planFile.file.Close(); err != nil {
					t.Fatal(err)
				}
			} else {
				// Lifetime-only control: no Source policy, capture, operation or
				// successful lab request is fabricated by this private fixture.
				file, err := os.OpenFile(filepath.Join(t.TempDir(), "public-lifecycle-input"), os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
				if err != nil {
					t.Fatal(err)
				}
				if err = file.Close(); err != nil {
					t.Fatal(err)
				}
				child := &PQLabLiveMaterialsControl{node: f.node, app: f.app, in: &pqLabLiveMaterialsInputs{originals: []*proofHostOriginal{{file: file}}}, done: make(chan struct{})}
				if err = f.app.attachWalletPolicyProofLab(f.node, child); err != nil {
					t.Fatal(err)
				}
				closeChild = child.Close
				if _, err := NewProofHostLiveControl(f.node, f.app, policyPath, pin); err == nil {
					t.Fatal("one-shot child replaced existing lab owner")
				}
			}
			if read, err := source.Read(context.Background(), owner); err != nil || read == nil {
				t.Fatal("proof ownership consumed the independent readonly getter", err)
			}
			if err := source.Close(); !errors.Is(err, os.ErrClosed) {
				t.Fatal("composite discarded original child close failure", err)
			}
			if err := source.Close(); !errors.Is(err, os.ErrClosed) {
				t.Fatal("repeated composite close forgot UNKNOWN", err)
			}
			if err := closeChild(); !errors.Is(err, os.ErrClosed) {
				t.Fatal("original child close error changed", err)
			}
			if read, err := source.Read(context.Background(), owner); !errors.Is(err, ErrPQWalletPolicyLiveRetired) || read != nil {
				t.Fatal("close error renewed or leaked a live result", err)
			}
			if err := f.app.attachWalletPolicyProofHost(f.node, &ProofHostLiveControl{node: f.node, app: f.app}); err == nil {
				t.Fatal("retired owner accepted a replacement child")
			}
			if err := f.app.attachWalletPolicyProofHost(&node.Node{}, &ProofHostLiveControl{node: f.node, app: f.app}); err == nil {
				t.Fatal("foreign Node pointer accepted")
			}
		})
	}
}
