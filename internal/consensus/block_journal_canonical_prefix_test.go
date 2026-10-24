package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestBlockJournalCertificateCanonicalDecoderRealReplayAndFallback(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	d, err := NewBlockJournalCanonicalNativePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	control, err := NewBlockJournalNativeSuffixPrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	var first, latest []byte
	var last BlockJournalPrefixReadback
	var aggregate BlockJournalPrefixWorkPhases
	for nonce := uint64(1); nonce <= 4; nonce++ {
		res, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 123).UTC(), Txs: [][]byte{journalTransfer(t, nonce)}})
		if err != nil || len(res.TxResults) != 1 || res.TxResults[0].Code != 0 {
			t.Fatal("signed execution", err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		latest, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if nonce == 1 {
			first = append([]byte(nil), latest...)
		}
		last, err = d.DecodeWithCertificatePhaseTiming(context.Background(), latest)
		if err != nil {
			t.Fatal(err)
		}
		old, err := control.DecodeWithCertificatePhaseTiming(context.Background(), latest)
		if err != nil || !bytes.Equal(last.SnapshotJSON, old.SnapshotJSON) || !reflect.DeepEqual(last.State, old.State) {
			t.Fatal("control differs", err)
		}
		p := last.WorkPhases.CertificatePublishDetails
		if p.CanonicalNative == nil || p.CanonicalNative.Calls != 1 || p.CanonicalNative.Errors != 0 || p.CanonicalNativeAccepted != 1 || p.StrictJSON.Calls != 0 || p.NativeClone.Calls != 1 {
			t.Fatalf("candidate branch absent: %+v", p)
		}
		if p.PayloadCopy.DurationNs+p.CanonicalNative.DurationNs+p.NativeClone.DurationNs > last.WorkPhases.CertificatePublish.DurationNs {
			t.Fatal("nested time exceeds parent")
		}
		if old.WorkPhases.CertificatePublishDetails.CanonicalNative != nil {
			t.Fatal("old constructor selected candidate")
		}
		aggregate.Add(*last.WorkPhases)
		last.WorkPhases.CertificatePublishDetails.CanonicalNative.Calls = 999
		if aggregate.CertificatePublishDetails.CanonicalNative.Calls != nonce {
			t.Fatal("aggregate aliases caller")
		}
		last.WorkPhases.CertificatePublishDetails.CanonicalNative.Calls = 1
		same, err := d.DecodeWithCertificatePhaseTiming(context.Background(), latest)
		if err != nil || same.WorkPhases.PrivateValidate.Calls != 1 || same.WorkPhases.PrivateNativeClone == nil || same.WorkPhases.PrivateNativeClone.Calls != 1 || same.WorkPhases.CertificatePublish.Calls != 0 {
			t.Fatal("reuse lost full validation", err)
		}
		last.State.Accounts[0].Lots["caller-only"] = 99
		if _, exists := d.prefix.native.Accounts[0].Lots["caller-only"]; exists {
			t.Fatal("caller modified certificate")
		}
	}
	prior := d.prefix
	if _, err := d.Decode(context.Background(), first); err != nil || d.prefix != prior {
		t.Fatal("older capture lowered high-water", err)
	}
	// Candidate refusal, and a valid object whose encoded bytes do not match
	// the payload, must both use the old strict decoder rather than trusting it.
	for _, kind := range []string{"unsupported-string", "payload-mismatch", "malformed-payload"} {
		bad := last.BlockJournalReadback
		bad.State, _ = cloneNativeCommittedState(*prior.native)
		switch kind {
		case "unsupported-string":
			bad.State.Accounts[0].Address = string([]byte{0xff})
		case "payload-mismatch":
			bad.State.AppHash = "mismatch"
		case "malformed-payload":
			bad.SnapshotJSON = []byte("{")
		}
		phases := &BlockJournalPrefixWorkPhases{CertificatePublishDetails: new(BlockJournalPrefixCertificatePhases)}
		cert, err := d.makePrefixCertificate(latest, bad, 4, phases)
		p := phases.CertificatePublishDetails
		if d.prefix != prior || p.CanonicalNative.Calls != 1 || p.CanonicalNativeAccepted != 0 || p.StrictJSON.Calls != 1 {
			t.Fatalf("%s did not fall back: %+v", kind, p)
		}
		if kind == "malformed-payload" {
			if err == nil || cert != nil || p.StrictJSON.Errors != 1 {
				t.Fatal("malformed payload accepted")
			}
		} else if err != nil || cert.native == nil || !reflect.DeepEqual(*cert.native, *prior.native) {
			t.Fatal("fallback changed state", err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := d.Decode(ctx, latest); err == nil || d.prefix != prior {
		t.Fatal("cancelled decode changed publication")
	}
	raw, err := json.Marshal(aggregate)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("REAL_CANONICAL_CANDIDATE_SIGNED_4 %s", raw)
}
