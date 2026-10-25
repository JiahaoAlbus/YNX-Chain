package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestPreparedNativeJSONMatchesOriginal(t *testing.T) {
	_, state := retainedSealFixture(t)
	for _, fees := range [][]BFTFeeEvent{nil, {}, state.FeeEvents} {
		state.FeeEvents = fees
		want, err := encodeCommittedStateJSON(state)
		if err != nil {
			t.Fatal(err)
		}
		got, err := encodePreparedNativeStateJSON(state)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatal("complete indented snapshot bytes differ", err)
		}
	}
}

func TestPreparedNativeJSONEveryFeeFieldAndOriginalErrors(t *testing.T) {
	weird := "\x00<>&\"\\\n汉字\u2028\u2029" + string([]byte{0xff})
	for i := 0; i < reflect.TypeOf(BFTFeeEvent{}).NumField(); i++ {
		event := BFTFeeEvent{}
		field := reflect.ValueOf(&event).Elem().Field(i)
		if field.Type() == reflect.TypeOf(time.Time{}) {
			field.Set(reflect.ValueOf(time.Date(2026, 1, 2, 3, 4, 5, 123, time.FixedZone("odd", 137*60))))
		} else {
			switch field.Kind() {
			case reflect.String:
				field.SetString(strings.Repeat(weird, 8))
			case reflect.Int, reflect.Int64:
				field.SetInt(-1)
			case reflect.Bool:
				field.SetBool(true)
			default:
				t.Fatalf("new fee field needs exact encoder qualification: %s", field.Type())
			}
		}
		state := CommittedState{FeeEvents: []BFTFeeEvent{event, event}}
		want, err := encodeCommittedStateJSON(state)
		got, e := encodePreparedNativeStateJSON(state)
		if err != nil || e != nil || !bytes.Equal(got, want) {
			t.Fatalf("complete bytes differ for fee field %s: %v %v", reflect.TypeOf(event).Field(i).Name, err, e)
		}
	}
	for _, when := range []time.Time{time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 1, 1, 0, 0, 0, 0, time.FixedZone("bad", 25*3600))} {
		state := CommittedState{FeeEvents: []BFTFeeEvent{{RecordedAt: when}}}
		_, want := encodeCommittedStateJSON(state)
		got, err := encodePreparedNativeStateJSON(state)
		var original, current *json.MarshalerError
		if want == nil || err == nil || got != nil || want.Error() != err.Error() || !errors.As(want, &original) || !errors.As(err, &current) || original.Type != current.Type {
			t.Fatal("original timestamp failure or no-publication behavior changed", want, err)
		}
	}
}

func TestPreparedNativeJSONFramingAndParallelOwnership(t *testing.T) {
	for _, raw := range []string{"", "{}", "{}\n", "{bad}\n"} {
		w := preparedFeeSnapshotWriter{fees: []BFTFeeEvent{{}}}
		if _, err := w.Write([]byte(raw)); err == nil || w.payload != nil {
			t.Fatal("bad scaffold published a snapshot")
		}
	}
	_, state := retainedSealFixture(t)
	want, err := encodeCommittedStateJSON(state)
	if err != nil {
		t.Fatal(err)
	}
	scaffold := state
	scaffold.FeeEvents = []BFTFeeEvent{{}}
	raw, err := json.Marshal(scaffold)
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	var empty preparedFeeSnapshotWriter
	if _, err := empty.Write(raw); err == nil || empty.payload != nil {
		t.Fatal("empty history bypassed the original encoder route")
	}
	w := preparedFeeSnapshotWriter{fees: state.FeeEvents}
	if _, err := w.Write(raw); err != nil || !bytes.Equal(w.payload, want) {
		t.Fatal("actual scaffold write differs", err)
	}
	if _, err := w.Write(raw); err == nil || !bytes.Equal(w.payload, want) {
		t.Fatal("second scaffold write accepted or changed first result")
	}
	for i := 0; i < 4; i++ {
		t.Run("private", func(t *testing.T) {
			t.Parallel()
			got, err := encodePreparedNativeStateJSON(state)
			if err != nil || !bytes.Equal(got, want) {
				t.Fatal("parallel bytes differ", err)
			}
			got[0] = '!'
			again, err := encodePreparedNativeStateJSON(state)
			if err != nil || !bytes.Equal(again, want) {
				t.Fatal("public result aliases encoder storage", err)
			}
		})
	}
}

var preparedJSONSink []byte

// New real signed grouped history, not a modification of retained fee times.
// Each block also rejects a duplicate nonce and malformed envelope. Reopen and
// the original full decoder must reproduce the complete committed state.
func preparedJSONGroupedHistory(t testing.TB) (chain.ConsensusMigrationState, CommittedState) {
	t.Helper()
	key := deterministicPrivateKey(61)
	sender, err := NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	to, err := NativeAddress(deterministicPrivateKey(62).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err = devnet.Faucet(sender, 100000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "state.json")
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	var last []byte
	for block := 0; block < 4; block++ {
		txs := make([][]byte, 0, 34)
		for i := 0; i < 32; i++ {
			tx, err := NewSignedTransfer(key, migration.Network.ChainID, to, 3, uint64(block*32+i+1))
			if err != nil {
				t.Fatal(err)
			}
			raw, err := EncodeSignedTransaction(tx)
			if err != nil {
				t.Fatal(err)
			}
			txs = append(txs, raw)
		}
		check, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: txs[0]})
		if err != nil || check.Code != 0 {
			t.Fatal("real next nonce admission failed", err)
		}
		last = txs[31]
		txs = append(txs, txs[0], []byte("invalid-envelope"))
		response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(block+1), Time: time.Unix(1802736000+int64(block), 123).UTC(), Txs: txs})
		if err != nil || len(response.TxResults) != 34 {
			t.Fatal("real grouped execution failed", err)
		}
		for i, result := range response.TxResults {
			if i < 32 && result.Code != 0 || i == 32 && result.Code != CodeInvalidNonce || i == 33 && result.Code == 0 {
				t.Fatalf("grouped execution result %d: %d", i, result.Code)
			}
		}
		if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeBlockJournal(ctx, data, migration)
	if err != nil || decoded.IncompleteTail || len(decoded.State.FeeEvents) != 128 || decoded.State.AppHash != app.committed.AppHash {
		t.Fatal("full original replay differs", err)
	}
	if err = decoded.State.Validate(migration); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	check, err := reopened.CheckTx(ctx, &abci.RequestCheckTx{Tx: last})
	if err != nil || check.Code != CodeInvalidNonce || reopened.committed.AppHash != decoded.State.AppHash {
		t.Fatal("restart changed state or admitted nonce replay", err)
	}
	t.Log("actual signed128/4blocks; rejected duplicate4/invalid4; durable Commit, original full replay, Validate, reopen and nonce rejection; not network TPS")
	return migration, decoded.State
}

func TestPreparedNativeJSONGroupedSignedHistory(t *testing.T) {
	migration, state := preparedJSONGroupedHistory(t)
	want, err := encodeCommittedStateJSON(state)
	if err != nil {
		t.Fatal(err)
	}
	got, err := encodePreparedNativeStateJSON(state)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatal("real grouped complete snapshot bytes differ", err)
	}
	if err = state.Validate(migration); err != nil {
		t.Fatal("encoding changed validated state", err)
	}
}

func BenchmarkPreparedNativeJSONGroupedSignedHistory(b *testing.B) {
	_, state := preparedJSONGroupedHistory(b)
	benchmarkPreparedNativeJSON(b, state)
}

func BenchmarkPreparedNativeJSONActualHistory(b *testing.B) {
	_, state := retainedSealFixture(b)
	benchmarkPreparedNativeJSON(b, state)
}

func benchmarkPreparedNativeJSON(b *testing.B, state CommittedState) {
	want, err := encodeCommittedStateJSON(state)
	if err != nil {
		b.Fatal(err)
	}
	for i, candidate := range []bool{false, true, true, false} {
		b.Run(fmt.Sprintf("%02d_candidate%t", i, candidate), func(b *testing.B) {
			encode := encodeCommittedStateJSON
			if candidate {
				encode = encodePreparedNativeStateJSON
			}
			got, err := encode(state)
			if err != nil || !bytes.Equal(got, want) {
				b.Fatal("same actual history bytes differ", err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for n := 0; n < b.N; n++ {
				preparedJSONSink, err = encode(state)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// Pre-change prepared operations from SOURCE f2ffa, without timing sinks.
func preparedNativeOriginalJSONBaseline(state CommittedState) (*preparedCanonicalNativeSnapshot, error) {
	private, ok := cloneCanonicalNativeCommittedState(state)
	if !ok {
		return nil, nil
	}
	payload, err := encodeCommittedStateJSON(private)
	if err != nil {
		return nil, err
	}
	return &preparedCanonicalNativeSnapshot{payload: payload, state: private}, nil
}

func BenchmarkPreparedNativeJSONPipelineActualHistory(b *testing.B) {
	_, state := retainedSealFixture(b)
	benchmarkPreparedNativeJSONPipeline(b, state)
}

func BenchmarkPreparedNativeJSONPipelineGroupedHistory(b *testing.B) {
	_, state := preparedJSONGroupedHistory(b)
	benchmarkPreparedNativeJSONPipeline(b, state)
}

func benchmarkPreparedNativeJSONPipeline(b *testing.B, state CommittedState) {
	want, err := preparedNativeOriginalJSONBaseline(state)
	if err != nil || want == nil {
		b.Fatal(err)
	}
	for i, candidate := range []bool{false, true, true, false} {
		b.Run(fmt.Sprintf("%02d_candidate%t", i, candidate), func(b *testing.B) {
			prepare := preparedNativeOriginalJSONBaseline
			if candidate {
				prepare = prepareCanonicalNativeSnapshot
			}
			got, err := prepare(state)
			if err != nil || !reflect.DeepEqual(got, want) {
				b.Fatal("complete prepared object/bytes differ", err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for n := 0; n < b.N; n++ {
				preparedNativeSink, err = prepare(state)
				if err != nil || preparedNativeSink == nil {
					b.Fatal(err)
				}
				preparedPublicSink = append([]byte(nil), preparedNativeSink.payload...)
			}
		})
	}
}
