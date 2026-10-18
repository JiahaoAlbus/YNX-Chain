package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
	"testing/iotest"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestReadySenderReadbackBindsFixtureAndRecoversOnlyCompleteIdentities(t *testing.T) {
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	j, err := newReadySenderJournal(p)
	if err != nil {
		t.Fatal(err)
	}
	for round := 1; round <= 2; round++ {
		var wave []readySenderEnvelope
		for sender, raw := range initial {
			if round == 2 {
				raw, err = p.nextForSender(sender, gateResult(raw, 5))
				if err != nil {
					t.Fatal(err)
				}
			}
			wave = append(wave, readySenderEnvelope{Index: (round-1)*3 + sender, Sender: sender, Round: round, Hash: fmt.Sprintf("%X", raw.Hash()), Transaction: raw})
		}
		if err = j.append(wave); err != nil {
			t.Fatal(err)
		}
	}
	if err = j.file.Close(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(p.root, readySenderJournalName))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeReadySenderJournal(context.Background(), raw, manifest, m, initial, 2)
	if err != nil || decoded.Records != 6 || decoded.IncompleteTail {
		t.Fatal("complete journal recovery failed", decoded, err)
	}
	streamRecords := 0
	streamed, streamErr := scanReadySenderJournal(context.Background(), iotest.OneByteReader(bytes.NewReader(raw)), manifest, m, initial, terminalStreamRecordLimit/len(initial), int64(len(raw)), func(e readySenderEnvelope) error {
		if !bytes.Equal(e.Transaction, decoded.Transactions[e.Index]) {
			t.Fatal("stream changed signed identity")
		}
		streamRecords++
		return nil
	})
	if streamErr != nil || streamRecords != 6 || streamed.Records != 6 || streamed.BytesRead != int64(len(raw)) || streamed.IncompleteTail {
		t.Fatal("streaming readback or exact byte cap failed", streamed, streamErr)
	}
	if _, err := decodeReadySenderJournal(context.Background(), raw, manifest, m, initial, terminalStreamRecordLimit/len(initial)); err == nil {
		t.Fatal("legacy caller limits widened")
	}
	for i, tx := range initial {
		if !bytes.Equal(tx, decoded.Transactions[i]) {
			t.Fatal("initial input changed")
		}
	}
	for _, mode := range []string{"fixture", "duplicate", "bad_hash", "nonce_gap", "bad_signature", "unknown_field", "cancel", "partial"} {
		t.Run(mode, func(t *testing.T) {
			input := append([]byte(nil), raw...)
			ctx := context.Background()
			lines := bytes.Split(bytes.TrimSpace(input), []byte{'\n'})
			switch mode {
			case "fixture":
				input = bytes.Replace(input, []byte(p.manifestSHA256), []byte("wrong manifest"), 1)
			case "duplicate":
				input = append(input, append(lines[1], '\n')...)
			case "cancel":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			case "partial":
				input = input[:len(input)-4]
			default:
				var envelope readySenderEnvelope
				if json.Unmarshal(lines[4], &envelope) != nil {
					t.Fatal("bad fixture line")
				}
				if mode == "bad_hash" {
					envelope.Hash = "wrong"
				}
				if mode == "bad_signature" {
					var tx consensus.SignedTransaction
					if json.Unmarshal(envelope.Transaction, &tx) != nil {
						t.Fatal("bad signed fixture")
					}
					tx.Signature = "00"
					envelope.Transaction, _ = json.Marshal(tx)
					envelope.Hash = fmt.Sprintf("%X", envelope.Transaction.Hash())
				}
				if mode == "nonce_gap" {
					tx, err := consensus.NewSignedTransfer(p.keys[0], p.templates[0].ChainID, p.templates[0].To, 1, 3)
					if err != nil {
						t.Fatal(err)
					}
					envelope.Transaction, err = consensus.EncodeSignedTransaction(tx)
					if err != nil {
						t.Fatal(err)
					}
					envelope.Hash = fmt.Sprintf("%X", envelope.Transaction.Hash())
				}
				line, err := json.Marshal(envelope)
				if err != nil {
					t.Fatal(err)
				}
				if mode == "unknown_field" {
					line = append(line[:len(line)-1], []byte(",\"extra\":true}")...)
				}
				lines[4] = line
				input = append(bytes.Join(lines, []byte{'\n'}), '\n')
			}
			streamed, streamErr := scanReadySenderJournal(ctx, bytes.NewReader(input), manifest, m, initial, 2, 8<<20, func(readySenderEnvelope) error { return nil })
			got, err := decodeReadySenderJournal(ctx, input, manifest, m, initial, 2)
			if mode == "partial" {
				if err != nil || streamErr != nil || !streamed.IncompleteTail || streamed.Records != 5 || !got.IncompleteTail || got.Records != 5 || got.Transactions[5] != nil {
					t.Fatal("partial tail invented identity", got, err)
				}
			} else if err == nil || streamErr == nil {
				t.Fatal("invalid complete journal accepted", mode)
			}
		})
	}
}

func TestReadySenderStreamingReadbackBoundsAndConsumerErrors(t *testing.T) {
	path, manifest, m, _, initial := senderFixture(t)
	_ = path
	sum := sha256.Sum256(manifest)
	header, _ := json.Marshal(readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", hex.EncodeToString(sum[:]), m.MigrationStateHash, m.GenesisHash})
	row, _ := json.Marshal(readySenderEnvelope{Index: 0, Sender: 0, Round: 1, Hash: fmt.Sprintf("%X", initial[0].Hash()), Transaction: initial[0]})
	raw := append(append(append(header, '\n'), row...), '\n')
	noOp := func(readySenderEnvelope) error { return nil }
	sentinel := errors.New("consumer stop")
	_, err := scanReadySenderJournal(context.Background(), bytes.NewReader(raw), manifest, m, initial, 2, int64(len(raw)), func(readySenderEnvelope) error { return sentinel })
	if !errors.Is(err, sentinel) {
		t.Fatal("consumer failure hidden", err)
	}
	for _, cap := range []int64{0, int64(len(raw) - 1), 1<<30 + 1} {
		if _, err = scanReadySenderJournal(context.Background(), bytes.NewReader(raw), manifest, m, initial, 2, cap, noOp); err == nil {
			t.Fatal("byte cap accepted", cap)
		}
	}
	for _, input := range [][]byte{header, append(append([]byte(nil), header...), append([]byte{'\n'}, bytes.Repeat([]byte{'x'}, terminalRowLimit+1)...)...)} {
		if _, err = scanReadySenderJournal(context.Background(), bytes.NewReader(input), manifest, m, initial, 2, 8<<20, noOp); err == nil {
			t.Fatal("incomplete header or oversized line accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = scanReadySenderJournal(ctx, bytes.NewReader(raw), manifest, m, initial, 2, 8<<20, noOp); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation hidden", err)
	}
	if _, err = scanReadySenderJournal(context.Background(), iotest.ErrReader(io.ErrUnexpectedEOF), manifest, m, initial, 2, 8<<20, noOp); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatal("reader failure hidden", err)
	}
}
