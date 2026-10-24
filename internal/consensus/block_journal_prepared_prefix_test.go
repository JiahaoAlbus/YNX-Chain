package consensus

import (
	"bytes"
	"context"
	"os"
	"reflect"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestBlockJournalPreparedPrefixRealReplayOwnershipRotationAndRecovery(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	control, err := NewBoundedBlockJournalNativeClonePrefixDecoder(migration, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	candidate, err := NewBoundedBlockJournalPreparedNativePrefixDecoder(migration, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	if control.PreparedNativePublicationEnabled() || !candidate.PreparedNativePublicationEnabled() || candidate.canonicalNative || candidate.nativeSuffixSetup || candidate.ByteLimit() != control.ByteLimit() {
		t.Fatal("constructor defaults/axis differ")
	}
	fast, cold := 0, 0
	var data, older, previous []byte
	var expected BlockJournalPrefixReadback
	for nonce := uint64(1); nonce <= 18; nonce++ {
		raw := journalTransfer(t, nonce)
		ctx := context.Background()
		response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 0), Txs: [][]byte{raw, raw, []byte("invalid-envelope")}})
		if err != nil || len(response.TxResults) != 3 || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce || response.TxResults[2].Code == 0 {
			t.Fatal("real signature/nonce execution differs", err)
		}
		if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		data, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if nonce == 4 {
			older = append([]byte(nil), data...)
		}
		if nonce == 17 {
			previous = append([]byte(nil), data...)
		}
		expected, err = control.DecodeWithCertificatePhaseTiming(ctx, data)
		if err != nil {
			t.Fatal(err)
		}
		got, err := candidate.DecodeWithCertificatePhaseTiming(ctx, data)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got.State, expected.State) || !bytes.Equal(got.SnapshotJSON, expected.SnapshotJSON) || got.CompleteBytes != expected.CompleteBytes || got.ReplayedTransactionInputs != expected.ReplayedTransactionInputs {
			t.Fatal("original current state/bytes/replay differs", nonce)
		}
		details := got.WorkPhases.CertificatePublishDetails
		if details.PreparedNativeAccepted > 0 {
			fast++
			if details.PreparedNativeAccepted != 1 || details.StrictJSON.Calls != 0 || details.NativeClone.Calls != 1 {
				t.Fatal("prepared construction branch not actual", details)
			}
		} else {
			cold++
			if details.StrictJSON.Calls != 1 {
				t.Fatal("cold replay must retain strict JSON", details)
			}
		}
		got.State.Accounts[0].Balance++
		got.State.FeeEvents[0].ID = "caller changed"
		got.SnapshotJSON[0] = '!'
		again, err := candidate.DecodeWithCertificatePhaseTiming(ctx, data)
		if err != nil || !reflect.DeepEqual(again.State, expected.State) || !bytes.Equal(again.SnapshotJSON, expected.SnapshotJSON) || again.WorkPhases.PrivateValidate.Calls != 1 || again.WorkPhases.PrivateNativeClone.Calls != 1 {
			t.Fatal("caller mutation leaked or full validation omitted", err)
		}
	}
	if fast < 12 || cold < 2 {
		t.Fatal("hot prepared and checkpoint rotation fallback not both covered", fast, cold)
	}
	high := candidate.prefix.height
	if old, err := candidate.Decode(context.Background(), older); err != nil || old.State.Height >= high || candidate.prefix.height != high {
		t.Fatal("older capture displaced high water", err)
	}
	if current, err := candidate.Decode(context.Background(), data); err != nil || !reflect.DeepEqual(current.State, expected.State) {
		t.Fatal("older capture changed current cached state", err)
	}
	payloadCorrupt, err := NewBoundedBlockJournalPreparedNativePrefixDecoder(migration, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = payloadCorrupt.Decode(context.Background(), previous); err != nil {
		t.Fatal(err)
	}
	if _, err = payloadCorrupt.Decode(context.Background(), data); err != nil {
		t.Fatal(err)
	}
	payloadCorrupt.prefix.payload[0] ^= 1
	if _, err = payloadCorrupt.Decode(context.Background(), data); err == nil {
		t.Fatal("corrupt prepared payload accepted")
	}
	candidate.prefix.native.Accounts[0].Balance++
	if _, err = candidate.Decode(context.Background(), data); err == nil {
		t.Fatal("corrupt private state accepted")
	}
	reopened, err := NewBoundedBlockJournalPreparedNativePrefixDecoder(migration, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	result, err := reopened.Decode(context.Background(), data)
	if err != nil || !reflect.DeepEqual(result.State, expected.State) {
		t.Fatal("fresh recovery differs", err)
	}
	corrupt := append([]byte(nil), data...)
	corrupt[0] ^= 1
	if _, err = reopened.Decode(context.Background(), corrupt); err == nil {
		t.Fatal("corrupt journal accepted")
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = reopened.Decode(canceled, data); err == nil {
		t.Fatal("canceled decode accepted")
	}
	t.Logf("real signed18 successful/18 duplicate-nonce rejected/18 invalid rejected, prepared=%d/cold=%d, two checkpoint epochs, ownership/fullValidate/corruption/recovery; no network TPS", fast, cold)
}

func TestBlockJournalPreparedPrefixArbitraryPayloadAndProducerMismatchFailClosed(t *testing.T) {
	migration, _ := journalFixture(t)
	d, err := NewBoundedBlockJournalPreparedNativePrefixDecoder(migration, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	_, state := retainedSealFixture(t)
	payload, prepared, err := d.encodePreparedPrefixSnapshot(state)
	if err != nil || prepared == nil {
		t.Fatal(err)
	}
	out := BlockJournalReadback{State: state, SnapshotJSON: payload, CompleteBytes: 1}
	if _, err = d.makePrefixCertificateWithPrepared([]byte{1}, out, 1, nil, prepared); err != nil {
		t.Fatal(err)
	}
	bad := out
	bad.SnapshotJSON = []byte(`{"unknown":true}`)
	if _, err = d.makePrefixCertificateWithPrepared([]byte{1}, bad, 1, nil, prepared); err == nil {
		t.Fatal("mismatched encoded producer bytes accepted")
	}
	if _, err = d.makePrefixCertificate([]byte{1}, bad, 1, nil); err == nil {
		t.Fatal("arbitrary payload bypassed strict JSON on prepared decoder")
	}
	control, err := NewBoundedBlockJournalNativeClonePrefixDecoder(migration, 32<<20)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = control.makePrefixCertificateWithPrepared([]byte{1}, out, 1, nil, prepared); err == nil {
		t.Fatal("default decoder accepted private candidate")
	}
	for _, limit := range []int{0, (16 << 20) - 1, (512 << 20) + 1} {
		if _, err = NewBoundedBlockJournalPreparedNativePrefixDecoder(migration, limit); err == nil {
			t.Fatal("original bound expanded", limit)
		}
	}
}
