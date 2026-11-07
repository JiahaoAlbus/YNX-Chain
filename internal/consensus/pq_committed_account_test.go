//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"bytes"
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"os"
	"strings"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/node"
)

func committedAccountFixture(t *testing.T, layout string, h int64) *committedTraceObserver {
	t.Helper()
	return openCommittedTraceObserver(t, os.Getenv("YNX_PUBLIC_REGISTERED_OBSERVER_TRACE"), layout, h)
}
func committedAccountOpen(t *testing.T, f *committedTraceObserver) *PQCommittedAccountReader {
	t.Helper()
	r, e := OpenPQCommittedAccountReader(context.Background(), f.app, f.expected.Owner)
	if r != nil {
		t.Cleanup(func() { _ = r.Close() })
	}
	if e != nil {
		t.Fatal("original account capture", e)
	}
	return r
}
func committedAccountRead(t *testing.T, r *PQCommittedAccountReader, current int64) *PQCommittedAccountProof {
	t.Helper()
	p, e := r.Read()
	if e != nil {
		t.Fatal("actual H/H+1 proof", e)
	}
	v, e := p.View()
	if e != nil || v.Proof.Height != 10 || v.HistoricalAccount.ExecutionHeight != 11 || v.CurrentCheckpoint.Height != current || v.CurrentAccount.ExecutionHeight != uint64(current+1) || v.HistoricalAccount.CommittedRegistration == nil || v.CurrentAccount.CommittedRegistration == nil {
		t.Fatal("original historical/current checkpoint fields", e)
	}
	return p
}

func TestPQCommittedAccountPUBLICContinuousEngineLayouts(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			f := committedAccountFixture(t, layout, 10)
			r := committedAccountOpen(t, f)
			n := f.node
			t.Run("HPlusOneNotCommitted", func(t *testing.T) {
				if p, e := r.Read(); p != nil || e != ErrPQCommittedAccountNotReady {
					t.Fatal("missing H+1 promoted", e)
				}
			})
			before, err := f.node.ProofSourceView()
			if err != nil {
				t.Fatal(err)
			}
			t.Run("DetachedCommittedState", func(t *testing.T) {
				s, e := before.LoadCommittedState()
				if e != nil {
					t.Fatal(e)
				}
				original := bytes.Clone(s.AppHash)
				originalValidator := bytes.Clone(s.Validators.Validators[0].Address)
				s.AppHash[0] ^= 1
				s.LastBlockID.Hash[0] ^= 1
				s.Validators.Validators[0].Address[0] ^= 1
				s.Validators.Validators[0].VotingPower = 1
				s.ConsensusParams.Validator.PubKeyTypes[0] = "changed"
				again, e := before.LoadCommittedState()
				if e != nil || !bytes.Equal(again.AppHash, original) || !bytes.Equal(again.Validators.Validators[0].Address, originalValidator) || again.ConsensusParams.Validator.PubKeyTypes[0] == "changed" {
					t.Fatal("committed view aliases actual store", e)
				}
			})
			f.advance(t, 11)
			t.Run("OriginalRoundFencePreserved", func(t *testing.T) {
				if _, e := before.LoadState(); !errors.Is(e, node.ErrProofSourceCheckpointCrossing) {
					t.Fatal("old round-copy fence weakened", e)
				}
			})
			p := committedAccountRead(t, r, 11)
			v, _ := p.View()
			t.Run("DetachedSealedEvidenceAndOrigin", func(t *testing.T) {
				o, e := p.Origin()
				if e != nil || o.OwnedBy(f.app) != nil || o.OwnedBy(&Application{}) == nil {
					t.Fatal("origin changed or self-declared", e)
				}
				old := bytes.Clone(v.HistoricalAccount.PolicyOriginal)
				v.HistoricalAccount.PolicyOriginal[0] ^= 1
				v.HistoricalAccount.CommittedRegistration.PKA[0] ^= 1
				v.BlockOriginal[0] ^= 1
				again, e := p.View()
				if e != nil || !bytes.Equal(again.HistoricalAccount.PolicyOriginal, old) || bytes.Equal(again.BlockOriginal, v.BlockOriginal) {
					t.Fatal("seal accessor aliases", e)
				}
			})
			f.advance(t, 12)
			p2 := committedAccountRead(t, r, 12)
			v2, _ := p2.View()
			v1, _ := p.View()
			t.Run("SameCaptureAdvancingEngine", func(t *testing.T) {
				if f.node != n || !bytes.Equal(v1.BlockOriginal, v2.BlockOriginal) || !bytes.Equal(v1.SuccessorOriginal, v2.SuccessorOriginal) || v1.Proof != v2.Proof || v1.CurrentCheckpoint == v2.CurrentCheckpoint {
					t.Fatal("capture recaptured or node restarted")
				}
				if v2.CurrentAccount.LedgerNonce <= v2.HistoricalAccount.LedgerNonce {
					t.Fatal("PUBLIC owner nonce did not expose actual advancement")
				}
				t.Logf("proofH=%d executionH=%d currentH=%d historicalNonce=%d currentNonce=%d", v2.Proof.Height, v2.HistoricalAccount.ExecutionHeight, v2.CurrentCheckpoint.Height, v2.HistoricalAccount.LedgerNonce, v2.CurrentAccount.LedgerNonce)
			})
			t.Run("TipH12NoH13", func(t *testing.T) {
				tip := committedAccountOpen(t, f)
				if got, e := tip.Read(); got != nil || e != ErrPQCommittedAccountNotReady {
					t.Fatal("nonexistent H13 fabricated", e)
				}
			})
			t.Run("ColdRestartRetiresOldIdentity", func(t *testing.T) {
				oldApp := f.app
				f.reopen(t)
				if got, e := r.Read(); e == nil || got != nil {
					t.Fatal("old engine survived restart")
				}
				o, _ := p.Origin()
				if o.OwnedBy(oldApp) == nil || o.OwnedBy(f.app) == nil {
					t.Fatal("origin moved to cold engine")
				}
				cold := committedAccountOpen(t, f)
				if got, e := cold.Read(); got != nil || e != ErrPQCommittedAccountNotReady {
					t.Fatal("cold capture reused prior H", e)
				}
			})
		})
	}
}

func TestPQCommittedAccountPUBLICLifecycleAndDebt(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	t.Run("ZeroAndUnpaired", func(t *testing.T) {
		if p, e := (&PQCommittedAccountReader{}).Read(); p != nil || e == nil {
			t.Fatal("zero reader")
		}
		if r, e := OpenPQCommittedAccountReader(context.Background(), &Application{}, f.expected.Owner); r != nil || e == nil {
			t.Fatal("unpaired app")
		}
		if p, e := (&PQCommittedAccountProof{}).View(); e == nil || p.Proof.Height != 0 {
			t.Fatal("public zero forged seal")
		}
	})
	t.Run("PartialCanceledFactory", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		r, e := OpenPQCommittedAccountReader(ctx, f.app, f.expected.Owner)
		if r == nil || !errors.Is(e, context.Canceled) {
			t.Fatal("partial discarded or cancel lost", e)
		}
		if !errors.Is(r.Close(), context.Canceled) || !r.Drained() {
			t.Fatal("partial cleanup lost first cause")
		}
	})
	t.Run("CopiedHandleSharesRetire", func(t *testing.T) {
		r := committedAccountOpen(t, f)
		copy := *r
		if e := copy.Close(); e != nil || !r.Drained() {
			t.Fatal("copy close not shared", e)
		}
		if p, e := r.Read(); p != nil || !errors.Is(e, ErrPQCommittedAccountRetired) {
			t.Fatal("copy retirement ignored", e)
		}
	})
	t.Run("AdmittedDebtPrecedesClose", func(t *testing.T) {
		r := committedAccountOpen(t, f)
		if e := r.core.begin(); e != nil {
			t.Fatal(e)
		}
		release, e := r.core.borrow()
		if e != nil {
			t.Fatal(e)
		}
		done := make(chan error, 1)
		go func() { done <- r.Close() }()
		select {
		case <-done:
			t.Fatal("close skipped admitted original store debt")
		case <-time.After(20 * time.Millisecond):
		}
		if r.Drained() {
			t.Fatal("debt claimed drained")
		}
		var cause error
		release(&cause)
		r.core.finish(cause)
		select {
		case e := <-done:
			if !errors.Is(e, context.Canceled) || !r.Drained() {
				t.Fatal("close debt first cause", e)
			}
		case <-time.After(time.Second):
			t.Fatal("close failed to drain")
		}
	})
	t.Run("RetireJoinIsNotClose", func(t *testing.T) {
		r := committedAccountOpen(t, f)
		if r.Join() == nil || r.IsClosed() {
			t.Fatal("join without retirement")
		}
		if e := r.Retire(); e != nil {
			t.Fatal(e)
		}
		if e := r.Join(); e != nil || !r.Drained() || r.IsClosed() {
			t.Fatal("join promoted to close", e)
		}
		if e := r.Close(); e != nil || !r.IsClosed() {
			t.Fatal("actual close not reported", e)
		}
	})
	t.Run("OriginalSourceBusyPartial", func(t *testing.T) {
		s, e := f.app.WalletPolicyLiveSource()
		if e != nil {
			t.Fatal(e)
		}
		if e = s.begin(); e != nil {
			t.Fatal(e)
		}
		r, e := OpenPQCommittedAccountReader(context.Background(), f.app, f.expected.Owner)
		s.mu.Lock()
		s.reading = false
		s.mu.Unlock()
		s.wg.Done()
		if r == nil || !errors.Is(e, ErrPQWalletPolicyLiveBusy) {
			t.Fatal("busy source bypass", e)
		}
		if !errors.Is(r.Close(), ErrPQWalletPolicyLiveBusy) || !r.Drained() {
			t.Fatal("busy partial did not preserve first cause")
		}
	})
}

func TestPQCommittedAccountPUBLICAppBeforeStoreRefused(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	r := committedAccountOpen(t, f)
	row := f.rows[11-f.receipt.FirstHeight]
	var req abci.RequestFinalizeBlock
	if e := req.Unmarshal(row.Request); e != nil {
		t.Fatal(e)
	}
	if _, e := f.app.FinalizeBlock(context.Background(), &req); e != nil {
		t.Fatal("actual next FinalizeBlock", e)
	}
	if _, e := f.app.Commit(context.Background(), &abci.RequestCommit{}); e != nil {
		t.Fatal("actual next App.Commit", e)
	}
	// Do NOT save a forged engine checkpoint: actual app is H11, original store H10.
	s, e := f.node.ProofSourceView()
	if e != nil {
		t.Fatal(e)
	}
	engine, e := s.LoadCommittedState()
	if e != nil || engine.LastBlockHeight != 10 {
		t.Fatal("actual store advanced unexpectedly", e)
	}
	if p, e := r.Read(); p != nil || e == nil || errors.Is(e, ErrPQCommittedAccountNotReady) {
		t.Fatal("App-before-Store promoted or treated ready later", e)
	}
	if again, e := r.Read(); again != nil || e == nil {
		t.Fatal("failed capture retried")
	}
}

// New getter-specific controls: mutate only detached PUBLIC evidence already
// read from the actual engine; no signing, alternate registry/provider or fake
// sealed result. Production calls this exact private evidence check before
// returning its opaque proof.
func TestPQCommittedAccountPUBLICSignedEvidenceRefusals(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	r := committedAccountOpen(t, f)
	f.advance(t, 11)
	proof := committedAccountRead(t, r, 11)
	view, _ := proof.View()
	snapshot, e := f.app.CommittedPQEngineSnapshot()
	if e != nil {
		t.Fatal(e)
	}
	current, e := r.core.source.view.LoadCommittedState()
	if e != nil {
		t.Fatal(e)
	}
	cases := []string{"H-MLDSA", "H-SLH", "HPlus1-MLDSA", "HPlus1-SLH", "WrongChain", "WrongAppHash", "WrongCapturedBlock", "WrongCaptureHeight", "SuccessorSubstitution"}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			block, e := DecodePQTrustedLightBlock(view.BlockOriginal)
			if e != nil {
				t.Fatal(e)
			}
			next, e := DecodePQTrustedLightBlock(view.SuccessorOriginal)
			if e != nil {
				t.Fatal(e)
			}
			before := r.core.captured
			now := current
			switch name {
			case "H-MLDSA", "H-SLH", "HPlus1-MLDSA", "HPlus1-SLH":
				victim := block
				if strings.HasPrefix(name, "HPlus1") {
					victim = next
				}
				changed := 0
				for i := range victim.Commit.Signatures {
					sig := &victim.Commit.Signatures[i]
					if len(sig.Signature) == 0 {
						continue
					}
					envelope, e := ynxconsensusauth.ParseEnvelope(sig.Signature)
					if e != nil {
						t.Fatal(e)
					}
					if strings.HasSuffix(name, "MLDSA") {
						envelope.MLDSA87[0] ^= 1
					} else {
						envelope.SLHDSASHA2256f[0] ^= 1
					}
					sig.Signature, e = envelope.MarshalBinary()
					if e != nil {
						t.Fatal(e)
					}
					changed++
				}
				if changed == 0 {
					t.Fatal("PUBLIC original had no signatures")
				}
			case "WrongChain":
				now.ChainID = "other-original-chain"
			case "WrongAppHash":
				before.AppHash = bytes.Clone(before.AppHash)
				before.AppHash[0] ^= 1
			case "WrongCapturedBlock":
				before.LastBlockID.Hash = bytes.Clone(before.LastBlockID.Hash)
				before.LastBlockID.Hash[0] ^= 1
			case "WrongCaptureHeight":
				before.LastBlockHeight--
			case "SuccessorSubstitution":
				next = block
			}
			if e := pqCommittedAccountEvidence(snapshot, before, now, block, next); e == nil {
				t.Fatal("changed committed account evidence accepted")
			}
		})
	}
	// A failure on a different detached evidence object cannot mutate the real
	// held capture or turn a historical proof into present-account authorization.
	if p, e := r.Current(); e != nil || p == nil {
		t.Fatal("detached refusals changed original capture", e)
	}
}
