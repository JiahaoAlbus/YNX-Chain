package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

func TestBlockJournalDecoderFactsPreserveIndependentFullReplay(t *testing.T) {
	migration, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	for nonce := uint64(1); nonce <= 2; nonce++ {
		raw := journalTransfer(t, nonce)
		response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: int64(migration.Height) + int64(nonce), Time: time.Unix(1802736000+int64(nonce), 0), Txs: [][]byte{raw, raw, []byte("invalid-envelope")}})
		if err != nil || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce || response.TxResults[2].Code == 0 {
			t.Fatal("fixture execution mismatch", err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := DecodeBlockJournal(context.Background(), data, migration)
	if err != nil {
		t.Fatal(err)
	}
	d, err := NewBlockJournalDecoder(migration)
	if err != nil {
		t.Fatal(err)
	}
	first, err := d.Decode(context.Background(), data)
	if err != nil || !bytes.Equal(first.SnapshotJSON, baseline.SnapshotJSON) || first.ReplayedTransactionInputs != 6 {
		t.Fatal("first decoder replay changed state", err)
	}
	stats := d.VerificationStats()
	if stats.SuccessfulVerifications != 2 || stats.Entries != 2 || stats.Capacity != 4096 || stats.StringByteLimit != 4<<20 {
		t.Fatal("crypto cache missed or expanded bounds", stats)
	}
	// Callers cannot mutate the decoder's migration, output state or canonical
	// bytes; the cache holds immutable cryptographic facts, not those objects.
	migration.Accounts[0].Balance++
	first.State.Accounts[0].Balance++
	first.SnapshotJSON[0] ^= 1
	second, err := d.Decode(context.Background(), data)
	if err != nil || !bytes.Equal(second.SnapshotJSON, baseline.SnapshotJSON) || second.ReplayedTransactionInputs != 6 {
		t.Fatal("caller mutation leaked into replay", err)
	}
	if after := d.VerificationStats(); after.SuccessfulVerifications != 2 || after.Hits <= stats.Hits {
		t.Fatal("repeated replay reverified crypto or skipped lookups", after)
	}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			decoded, err := d.Decode(context.Background(), data)
			if err != nil || !bytes.Equal(decoded.SnapshotJSON, baseline.SnapshotJSON) {
				t.Error("concurrent replay changed owned state", err)
			}
		}()
	}
	wg.Wait()
	if d.VerificationStats().SuccessfulVerifications != 2 {
		t.Fatal("warm concurrent replay lost facts")
	}
	for _, mode := range []string{"checksum", "migration", "signature", "signature_shape", "nonce", "prior_hash", "response_hash", "app_hash", "canceled"} {
		t.Run(mode, func(t *testing.T) {
			input := append([]byte(nil), data...)
			ctx := context.Background()
			switch mode {
			case "checksum":
				input[len(input)-2] ^= 1
			case "migration":
				input[len(blockJournalMagic)] ^= 1
			case "canceled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			default:
				prefix := len(d.migration.StateHash) + len(blockJournalMagic) + 1
				r := bytes.NewReader(data[prefix:])
				input = append([]byte(nil), data[:prefix]...)
				for index := 0; ; index++ {
					payload, _, _, err := readBlockJournalFrame(r)
					if err != nil {
						t.Fatal(err)
					}
					if payload == nil {
						break
					}
					var record blockJournalRecord
					if err = json.Unmarshal(payload, &record); err != nil {
						t.Fatal(err)
					}
					if index == 2 {
						switch mode {
						case "prior_hash":
							record.BeforeAppHash = "wrong"
						case "response_hash":
							record.ResponseHash = "wrong"
						case "app_hash":
							record.AppHash = "wrong"
						default:
							var req abci.RequestFinalizeBlock
							if err = req.Unmarshal(record.Request); err != nil {
								t.Fatal(err)
							}
							if mode == "nonce" {
								req.Txs[0] = journalTransfer(t, 1)
							} else {
								tx, err := DecodeSignedTransaction(req.Txs[0])
								if err != nil {
									t.Fatal(err)
								}
								other, err := DecodeSignedTransaction(journalTransfer(t, 1))
								if err != nil {
									t.Fatal(err)
								}
								tx.Signature = other.Signature // well-formed signature for another signed message
								if mode == "signature_shape" {
									tx.Signature = "00"
								}
								req.Txs[0], err = json.Marshal(tx) // intentionally bypass the encoder's signature validation for this bad-input fixture
								if err != nil {
									t.Fatal(err)
								}
							}
							record.Request, err = req.Marshal()
							if err != nil {
								t.Fatal(err)
							}
						}
					}
					payload, err = json.Marshal(record)
					if err != nil {
						t.Fatal(err)
					}
					input = append(input, blockJournalFrame(payload)...)
					input = append(input, payload...)
				}
			}
			before := d.VerificationStats()
			got, err := d.Decode(ctx, input)
			if err == nil || len(got.SnapshotJSON) != 0 || got.State.Height != 0 {
				t.Fatal("warm facts bypassed full integrity/execution gate", mode)
			}
			if d.VerificationStats().SuccessfulVerifications != before.SuccessfulVerifications {
				t.Fatal("invalid input became a verified crypto fact", mode)
			}
		})
	}
	stored, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(stored, data) {
		t.Fatal("decoder changed durable file")
	}
}
