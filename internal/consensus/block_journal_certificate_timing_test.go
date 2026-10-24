package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestBlockJournalCertificateTimingPreservesOriginalNormalizationAndOwnership(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	d, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	control, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	appendBlock := func(n uint64) []byte {
		t.Helper()
		res, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(n), Time: time.Unix(1802736000+int64(n), 0), Txs: [][]byte{journalTransfer(t, n)}})
		if err != nil || res.TxResults[0].Code != 0 {
			t.Fatal("real signed execution", err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	first := appendBlock(1)
	cold, err := d.DecodeWithCertificatePhaseTiming(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	old, err := control.DecodeWithPhaseTiming(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	if old.WorkPhases.CertificatePublishDetails != nil || !bytes.Equal(cold.SnapshotJSON, old.SnapshotJSON) {
		t.Fatal("old API shape/bytes changed")
	}
	check := func(result BlockJournalPrefixReadback, publishes uint64) {
		t.Helper()
		p := result.WorkPhases
		parts := p.CertificatePublishDetails
		if parts == nil || p.CertificatePublish.Calls != publishes {
			t.Fatal("selected certificate coverage absent")
		}
		var sum int64
		for _, v := range []BlockJournalPrefixPhase{parts.PayloadCopy, parts.StrictJSON, parts.NativeClone} {
			if v.Calls != publishes || v.Errors != 0 || publishes > 0 && v.DurationNs <= 0 {
				t.Fatalf("real certificate child differs: %+v", v)
			}
			sum += v.DurationNs
		}
		if sum > p.CertificatePublish.DurationNs {
			t.Fatal("nested child time exceeds parent")
		}
		if publishes > 0 && (parts.PayloadBytes != uint64(len(result.SnapshotJSON)) || parts.PrefixBytesHashed != uint64(result.CompleteBytes)) {
			t.Fatal("actual copied/hashed bytes differ")
		}
	}
	check(cold, 1)
	same, err := d.DecodeWithCertificatePhaseTiming(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	check(same, 0)
	if same.WorkPhases.PrivateValidate.Calls != 1 || same.WorkPhases.PrivateNativeClone.Calls != 1 {
		t.Fatal("full private validation disappeared")
	}
	second := appendBlock(2)
	next, err := d.DecodeWithCertificatePhaseTiming(context.Background(), second)
	if err != nil {
		t.Fatal(err)
	}
	check(next, 1)
	full, err := DecodeBlockJournal(context.Background(), second, migration)
	if err != nil || !bytes.Equal(next.SnapshotJSON, full.SnapshotJSON) {
		t.Fatal("original replay/normalization changed", err)
	}
	var sum BlockJournalPrefixWorkPhases
	sum.Add(*cold.WorkPhases)
	sum.Add(*same.WorkPhases)
	sum.Add(*next.WorkPhases)
	expected := sum.CertificatePublishDetails.PayloadBytes
	originalBytes := next.WorkPhases.CertificatePublishDetails.PayloadBytes
	next.WorkPhases.CertificatePublishDetails.PayloadBytes = 0
	if sum.CertificatePublishDetails.PayloadBytes != expected || sum.CertificatePublishDetails.PayloadCopy.Calls != 2 {
		t.Fatal("aggregate aliases caller timing")
	}
	next.WorkPhases.CertificatePublishDetails.PayloadBytes = originalBytes
	prior := d.prefix
	payload := append([]byte(nil), prior.payload...)
	next.State.Accounts[0].Lots["caller-only"] = 123
	if _, exists := prior.native.Accounts[0].Lots["caller-only"]; exists || !bytes.Equal(prior.payload, payload) {
		t.Fatal("caller state changed certificate")
	}
	older, err := d.DecodeWithCertificatePhaseTiming(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	check(older, 0)
	if d.prefix != prior || !bytes.Equal(d.prefix.payload, payload) {
		t.Fatal("old capture lowered high-water")
	}
	for name, p := range map[string]*BlockJournalPrefixWorkPhases{"cold": cold.WorkPhases, "same": same.WorkPhases, "suffix": next.WorkPhases} {
		raw, _ := json.Marshal(p)
		t.Logf("REAL_SIGNED_CERTIFICATE_CHILDREN %s %s", name, raw)
	}
}

func TestBlockJournalCertificateTimingFailureRetainsPriorPublication(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	res, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + 1, Time: time.Unix(1802736001, 0), Txs: [][]byte{journalTransfer(t, 1)}})
	if err != nil || res.TxResults[0].Code != 0 {
		t.Fatal(err)
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	d, err := NewBlockJournalNativeClonePrefixDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	valid, err := d.DecodeWithCertificatePhaseTiming(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	prior := d.prefix
	bad := valid.BlockJournalReadback
	bad.SnapshotJSON = []byte("{")
	phases := &BlockJournalPrefixWorkPhases{CertificatePublishDetails: new(BlockJournalPrefixCertificatePhases)}
	err = phases.measure("certificatePublish", func() error { _, e := d.makePrefixCertificate(raw, bad, 1, phases); return e })
	p := phases.CertificatePublishDetails
	if err == nil || d.prefix != prior || phases.CertificatePublish.Errors != 1 || p.PayloadCopy.Calls != 1 || p.StrictJSON.Errors != 1 || p.NativeClone.Calls != 0 {
		t.Fatalf("failed normalization published/lost error: %v %+v", err, p)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, err := d.DecodeWithCertificatePhaseTiming(ctx, raw)
	if err == nil || got.WorkPhases.CertificatePublishDetails.PayloadCopy.Calls != 0 || d.prefix != prior {
		t.Fatal("cancelled call published work")
	}
}
