//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func assertNativeArchiveStep(t *testing.T, n *NativePayService, client *NativeInvoiceIntentClient, source *nativeSourceFixture, f nativeCoreWorkflowManifest, step int, op NativePayOperation) {
	t.Helper()
	ctx := context.Background()
	archive, err := client.ReadOriginalArchive(ctx, f.Merchant, f.Terms.InvoiceID, op.NativeHash, func() error { return nil })
	if err != nil {
		t.Fatal("normal protected archive consumer", step, err)
	}
	terms, err := ynxbatch.DecodeMember(f.Rows[0].Wire)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(archive.Original.Member, f.Rows[step].Wire) || !bytes.Equal(archive.TermsMessage, terms.Message) || hashJSON(archive.Proof) != hashJSON(f.Rows[step].Proof) || hashJSON(archive.Expected) != hashJSON(f.Rows[step].Expected) || archive.EventClaim != nativeEventClaim(*op.Effect) || archive.Verified.NativeGrant || archive.ProductMerchantID == "" {
		t.Fatal("archive changed retained public proof/terms/binding")
	}
	if err = n.parent.store.Update(func(data *Snapshot) error {
		state, _, e := n.load(*data, f.Merchant, f.Terms.InvoiceID)
		if e != nil {
			return e
		}
		return n.appendOriginalArchive(data, &state, op, archive)
	}); err == nil {
		t.Fatal("append-only archive was replaced")
	}
	n.parent.store.View(func(data Snapshot) error {
		if len(data.Deliveries) != step+1 {
			t.Fatal("archive/fact/outbox not atomic", len(data.Deliveries), step)
		}
		return nil
	})
}

func assertNativeArchiveColdRecovery(t *testing.T, n *NativePayService, client *NativeInvoiceIntentClient, source *nativeSourceFixture, proofs *nativeWorkflowProofSource, f nativeCoreWorkflowManifest) {
	t.Helper()
	ctx := context.Background()
	before := map[string]string{}
	for _, row := range f.Rows {
		hash := consensus.SignedTransactionHash(row.Wire)
		a, e := n.ReadOriginalArchive(ctx, f.Merchant, f.Terms.InvoiceID, hash)
		if e != nil {
			t.Fatal(e)
		}
		before[hash] = a.Digest
	}
	cold, err := OpenStore(n.parent.store.path, n.parent.key)
	if err != nil {
		t.Fatal(err)
	}
	n.parent.store = cold
	source.grant.Height += 100
	source.grant.LedgerNonce += 100
	source.grant.KeyEpoch++
	source.grant.Registration.PolicyRevision = "PUBLIC-current-policy-is-not-historical"
	proofs.corrupt = true // Cold archive reads and duplicate reconciliation never consult current trust.
	diskBefore, err := os.ReadFile(cold.path)
	if err != nil {
		t.Fatal(err)
	}
	for hash, digest := range before {
		a, e := client.ReadOriginalArchive(ctx, f.Merchant, f.Terms.InvoiceID, hash, func() error { return nil })
		if e != nil || a.Digest != digest {
			t.Fatal("cold same-op archive changed at new current nonce/epoch", e)
		}
		a.TermsMessage[0] ^= 1
		a.Proof.ExecutionResult[0] ^= 1
		again, e := n.ReadOriginalArchive(ctx, f.Merchant, f.Terms.InvoiceID, hash)
		if e != nil || again.Digest != digest {
			t.Fatal("caller mutated retained originals", e)
		}
	}
	var group sync.WaitGroup
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			_, e := n.Reconcile(ctx, f.Merchant, f.Terms.InvoiceID, consensus.SignedTransactionHash(f.Rows[2].Wire))
			failures <- e
		}()
	}
	group.Wait()
	close(failures)
	for e := range failures {
		if e != nil {
			t.Fatal("duplicate proof read replayed or reverified", e)
		}
	}
	feed, err := n.InvoiceEvents(ctx, f.Merchant, f.Terms.InvoiceID)
	if err != nil || len(feed.Events) != 3 {
		t.Fatal("duplicate event claimed", err, len(feed.Events))
	}
	for _, event := range feed.Events {
		if event.OriginalWebhookEventID == "" {
			t.Fatal("archived event lost original outbox identity")
		}
	}
	diskAfter, _ := os.ReadFile(cold.path)
	if !bytes.Equal(diskBefore, diskAfter) {
		t.Fatal("cold original read/duplicate event changed durable state")
	}
	n.parent.store.View(func(data Snapshot) error {
		archives := 0
		for _, record := range data.BusinessDispatches {
			if record.Operation == "native.originals" {
				archives++
			}
		}
		if archives != 3 || len(data.Deliveries) != 3 {
			t.Fatal("archive/outbox duplicate", archives, len(data.Deliveries))
		}
		return nil
	})
	t.Log("NORMAL_ARCHIVE_COLD_HTTP originals=3 canonicalProofs=true currentNonceEpochIgnored=true CoreOffline=true readOnly=true duplicateReconcile8=true outbox3=true")
	assertNativeArchiveTwoProcessRestarts(t, n, f, before)
}

// New Members below use only temporary PUBLIC authority/key fixtures. They
// exercise the existing normal signature verifier and Store reservation lock;
// the new uncertain POST has no Core execution/finality or real funds effect.
func assertNativeArchiveMovementReservations(t *testing.T, n *NativePayService, source *nativeSourceFixture, f nativeCoreWorkflowManifest) {
	t.Helper()
	ctx := context.Background()
	key, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	source.grant.Registration = ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: f.Merchant, Purpose: "TX-BATCH", PolicyRevision: "PUBLIC-new-current-fixture", ChainID: f.Network, PKA: pub.PKA, PKB: pub.PKB, Enabled: true, ActiveFrom: 1}
	sign := func(action ynxauth.Action) []byte {
		t.Helper()
		message, e := action.SigningBytes()
		if e != nil {
			t.Fatal(e)
		}
		batch, e := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: f.Network, Owner: action.Owner, Purpose: "TX-BATCH"}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
		if e != nil {
			t.Fatal(e)
		}
		defer batch.Discard()
		member, e := ynxbatch.Extract(batch, 0)
		if e != nil {
			t.Fatal(e)
		}
		wire, e := ynxbatch.EncodeMember(member)
		if e != nil {
			t.Fatal(e)
		}
		return wire
	}
	payer, err := ynxbatch.DecodeMember(f.Rows[1].Wire)
	if err != nil {
		t.Fatal(err)
	}
	action, err := ynxauth.DecodeAction(payer.Message)
	if err != nil {
		t.Fatal(err)
	}
	source.grant.Principal = action.Owner
	source.grant.Registration.Owner = action.Owner
	source.grant.Height = f.Rows[1].Height
	action.Nonce = source.grant.LedgerNonce + 1
	if _, err = n.SubmitSettlement(ctx, f.Merchant, f.Terms.InvoiceID, sign(action)); err == nil {
		t.Fatal("second valid current nonce claimed another invoice payment")
	}
	source.grant.Principal = f.Merchant
	source.grant.Registration.Owner = f.Merchant
	// Use a current height within original terms for this independent bounded
	// reservation control; archive bytes above remain the actual historical ones.
	source.grant.Height = f.Rows[2].Height
	var posts atomic.Int32
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posts.Add(1)
		connection, _, e := w.(http.Hijacker).Hijack()
		if e != nil {
			t.Error(e)
			return
		}
		connection.Close()
	}))
	defer backend.Close()
	caller, err := NewNativePayHTTP(backend.URL, backend.Client())
	if err != nil {
		t.Fatal(err)
	}
	cfg := n.cfg
	cfg.HTTP = caller
	movements, err := NewNativePayService(n.parent, cfg)
	if err != nil {
		t.Fatal(err)
	}
	state, err := n.Read(ctx, f.Merchant, f.Terms.InvoiceID)
	if err != nil {
		t.Fatal(err)
	}
	termsHash, _ := hex.DecodeString(state.TermsHash)
	settlementHash, _ := hex.DecodeString(state.SettlementOperation[2:])
	var wires [][]byte
	for _, id := range []string{"concurrent-50-a", "concurrent-50-b"} {
		payload, e := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceRefund, ynxauth.InvoiceRefundPayload{InvoiceID: f.Terms.InvoiceID, RefundID: id, TermsHash: termsHash, SettlementHash: settlementHash, Amount: 50})
		if e != nil {
			t.Fatal(e)
		}
		wires = append(wires, sign(ynxauth.Action{ChainID: f.Network, NativeChainID: f.NativeChainID, Owner: f.Merchant, Nonce: source.grant.LedgerNonce + 1, Fee: 1, Kind: ynxauth.ActionInvoiceRefund, Payload: payload}))
	}
	var group sync.WaitGroup
	unknown := make(chan NativePayOperation, 2)
	for _, wire := range wires {
		group.Add(1)
		go func(wire []byte) {
			defer group.Done()
			op, e := movements.SubmitRefund(ctx, f.Merchant, f.Terms.InvoiceID, wire)
			if e == nil {
				t.Error("lost response falsely succeeded")
			}
			unknown <- op
		}(wire)
	}
	group.Wait()
	close(unknown)
	final, err := n.Read(ctx, f.Merchant, f.Terms.InvoiceID)
	if err != nil {
		t.Fatal(err)
	}
	reserved := 0
	for op := range unknown {
		// An error may carry a candidate operation; only the durable Store
		// establishes that this exact original was actually reserved.
		if saved, retained := final.Operations[op.NativeHash]; retained && saved.Status == "unknown" {
			reserved++
		}
	}
	if posts.Load() != 1 || reserved != 1 {
		t.Fatal("concurrent over-refund double dispatch/reservation", posts.Load(), reserved)
	}
	projection, err := nativeInvoiceProjection(final)
	if err != nil || projection["paidAtoms"] != "100" || projection["refundedAtoms"] != "30" || projection["netPaidAtoms"] != "70" || len(final.OriginalArchives) != 3 {
		t.Fatal("uncertain refund changed confirmed money or historical archive", err)
	}
	t.Log("NORMAL_PAYMENT_CLAIM secondValidNonceDenied=true concurrent50plus50OfRemaining70=oneUNKNOWNPost confirmed100/30/70Unchanged=true archives3=true")
}

func TestNativePayOriginalArchiveLegacyMissingNeverBackfills(t *testing.T) {
	// Explicit old-journal projection fixture, not independent proof evidence.
	f := newNativeServiceFixture(t)
	wire := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	op, err := f.service.RegisterTerms(context.Background(), "order-100", wire)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.service.parent.store.Update(func(data *Snapshot) error {
		state, _, e := f.service.load(*data, f.merchant, f.terms.InvoiceID)
		if e != nil {
			return e
		}
		old := state.Operations[op.NativeHash]
		old.Status = "confirmed"
		state.Operations[op.NativeHash] = old
		return f.service.save(data, state)
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = f.service.Reconcile(context.Background(), f.merchant, f.terms.InvoiceID, op.NativeHash); err != nil {
		t.Fatal(err)
	}
	if _, err = f.service.ReadOriginalArchive(context.Background(), f.merchant, f.terms.InvoiceID, op.NativeHash); !errors.Is(err, ErrNativePayOriginalArchiveUnavailable) {
		t.Fatal("old current/journal synthesized archive", err)
	}
	endpoint := httptest.NewServer(f.service.Handler())
	defer endpoint.Close()
	client, e := NewNativeInvoiceIntentClient(endpoint.URL, endpoint.Client())
	if e != nil {
		t.Fatal(e)
	}
	if _, e = client.ReadOriginalArchive(context.Background(), f.merchant, f.terms.InvoiceID, op.NativeHash, func() error { return nil }); !errors.Is(e, ErrNativePayOriginalArchiveUnavailable) {
		t.Fatal("old archive code not preserved over normal GET", e)
	}
	f.source.denied = true
	if _, e = client.ReadOriginalArchive(context.Background(), f.merchant, f.terms.InvoiceID, op.NativeHash, func() error { return nil }); !errors.Is(e, ErrNativePayUnavailable) {
		t.Fatal("revoked Source read archive", e)
	}
	if f.writes != 1 {
		t.Fatal("missing archive triggered replay", f.writes)
	}
}
