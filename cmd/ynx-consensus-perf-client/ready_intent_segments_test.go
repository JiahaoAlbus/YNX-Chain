package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func intentWaves(t *testing.T, p *ephemeralSenderPool) [][]readySenderEnvelope {
	t.Helper()
	waves := make([][]readySenderEnvelope, 2)
	for round := 1; round <= 2; round++ {
		for sender, raw := range p.pending {
			if round == 2 {
				var err error
				raw, err = p.nextForSender(sender, gateResult(raw, 5))
				if err != nil {
					t.Fatal(err)
				}
			}
			waves[round-1] = append(waves[round-1], readySenderEnvelope{Index: (round-1)*len(p.pending) + sender, Sender: sender, Round: round, Hash: fmt.Sprintf("%X", raw.Hash()), Transaction: raw})
		}
	}
	return waves
}

// Real fixture signatures and actual exclusive write/Sync/close/dir-Sync;
// these are input identities, not transaction acceptance or consensus evidence.
func TestReadyIntentSegmentsPersistAndStreamExactSignedInputs(t *testing.T) {
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(t.TempDir(), "intents")
	s, err := newReadyIntentSegments(directory, p, 6, 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := newReadyIntentSegments(directory, p, 6, 8<<20); err == nil {
		t.Fatal("existing evidence directory reused")
	}
	waves := intentWaves(t, p)
	for _, wave := range waves {
		if err := s.append(wave); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.close(); err != nil {
		t.Fatal(err)
	}
	if err := s.append(waves[0]); err == nil {
		t.Fatal("closed stream reused")
	}
	var accepted []readySenderEnvelope
	out, err := scanReadyIntentSegments(context.Background(), s.report, manifest, m, initial, 2, 8<<20, func(e readySenderEnvelope) error { accepted = append(accepted, e); return nil })
	if err != nil || out.Records != 6 || len(accepted) != 6 || out.IncompleteTail || out.BytesRead != s.report.Bytes || s.report.Segments != 2 || s.report.Poisoned {
		t.Fatal("signed-intent stream did not round trip", out, s.report, err)
	}
	for i, e := range accepted {
		want := waves[i/3][i%3]
		if e.Index != want.Index || e.Hash != want.Hash || !bytes.Equal(e.Transaction, want.Transaction) {
			t.Fatal("signed identity changed", i)
		}
	}
}

func TestReadyIntentSegmentsNeverRetryFailedOrUncertainPersistence(t *testing.T) {
	for _, complete := range []bool{false, true} {
		t.Run(fmt.Sprint(complete), func(t *testing.T) {
			p := terminalFixture(t)
			s, err := newReadyIntentSegments(filepath.Join(t.TempDir(), "intents"), p, 6, 8<<20)
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			var retained string
			s.persist = func(name string, raw []byte) error {
				calls++
				retained = name
				if complete {
					if err := persistTerminalSegment(name, raw); err != nil {
						return err
					}
				} else if err := os.WriteFile(name, raw[:len(raw)/2], 0600); err != nil {
					return err
				}
				return io.ErrShortWrite
			}
			wave := intentWaves(t, p)[0]
			if err := s.append(wave); !errors.Is(err, io.ErrShortWrite) || !s.report.Poisoned || s.report.Records != 0 || s.report.Segments != 0 || s.report.Bytes != 0 {
				t.Fatal("uncertain write counted complete", s.report, err)
			}
			before, err := os.ReadFile(retained)
			if err != nil || len(before) == 0 {
				t.Fatal("lost uncertain write", err)
			}
			if s.append(wave) == nil || s.close() == nil || calls != 1 {
				t.Fatal("poisoned writer retried")
			}
			after, err := os.ReadFile(retained)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("uncertain evidence overwritten", err)
			}
		})
	}
}

func TestReadyIntentSegmentsRejectMissingCorruptAndWrongBinding(t *testing.T) {
	for _, mode := range []string{"missing", "extra", "corrupt", "manifest", "chain", "budget", "signature"} {
		t.Run(mode, func(t *testing.T) {
			path, manifest, m, migration, initial := senderFixture(t)
			p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
			if err != nil {
				t.Fatal(err)
			}
			s, err := newReadyIntentSegments(filepath.Join(t.TempDir(), "intents"), p, 6, 8<<20)
			if err != nil {
				t.Fatal(err)
			}
			waves := intentWaves(t, p)
			if mode == "signature" {
				var tx consensus.SignedTransaction
				if err := json.Unmarshal(waves[1][0].Transaction, &tx); err != nil {
					t.Fatal(err)
				}
				tx.Signature = "00"
				waves[1][0].Transaction, err = json.Marshal(tx)
				if err != nil {
					t.Fatal(err)
				}
				waves[1][0].Hash = fmt.Sprintf("%X", waves[1][0].Transaction.Hash())
			}
			for _, wave := range waves {
				if err := s.append(wave); err != nil {
					t.Fatal(err)
				}
			}
			budget := int64(8 << 20)
			switch mode {
			case "missing":
				err = os.Remove(filepath.Join(s.report.Directory, "intent-000000.jsonl"))
			case "extra":
				err = os.WriteFile(filepath.Join(s.report.Directory, "unexpected"), []byte("retain"), 0600)
			case "corrupt":
				name := filepath.Join(s.report.Directory, "intent-000001.jsonl")
				var raw []byte
				raw, err = os.ReadFile(name)
				if err == nil {
					raw[len(raw)-3] ^= 1
					err = os.WriteFile(name, raw, 0600)
				}
			case "manifest":
				manifest = append(append([]byte(nil), manifest...), ' ')
			case "chain":
				s.report.ChainSHA256 = fmt.Sprintf("%064x", 0)
			case "budget":
				budget = s.report.Bytes - 1
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := scanReadyIntentSegments(context.Background(), s.report, manifest, m, initial, 2, budget, func(readySenderEnvelope) error { return nil }); err == nil {
				t.Fatal("invalid intent stream accepted", mode)
			}
		})
	}
}

func TestReadyIntentFormatSelectionRejectsMixedMissingAndEscapedReceipts(t *testing.T) {
	for _, mode := range []string{"valid", "missing_receipt", "mixed", "escaped", "poisoned"} {
		t.Run(mode, func(t *testing.T) {
			path, manifest, m, migration, initial := senderFixture(t)
			p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
			if err != nil {
				t.Fatal(err)
			}
			s, err := newReadyIntentSegments(filepath.Join(p.root, readyIntentSegmentsName), p, 6, 8<<20)
			if err != nil {
				t.Fatal(err)
			}
			for _, wave := range intentWaves(t, p) {
				if err := s.append(wave); err != nil {
					t.Fatal(err)
				}
			}
			receipt := s.report
			expected := &receipt
			switch mode {
			case "missing_receipt":
				expected = nil
			case "mixed":
				if err := os.WriteFile(filepath.Join(p.root, readySenderJournalName), []byte("retain ambiguous evidence\n"), 0600); err != nil {
					t.Fatal(err)
				}
			case "escaped":
				receipt.Directory = t.TempDir()
			case "poisoned":
				receipt.Poisoned = true
			}
			got, err := readReadySenderIntents(context.Background(), p.root, manifest, m, initial, 2, expected)
			if mode == "valid" {
				if err != nil || got.Records != 6 || got.IncompleteTail {
					t.Fatal("complete recorded input format not recovered", got, err)
				}
			} else if err == nil || got.Records != 0 {
				t.Fatal("ambiguous input format accepted", got, err)
			}
		})
	}
}

func TestSegmentedIntentOptionsRequireBoundedEvidenceMode(t *testing.T) {
	o := options{manifest: "manifest", transactions: "transactions", output: "new-output", concurrency: 1, observers: 4, rounds: 2, senderMode: "ready-pool", inclusionMode: "block-scan", offeredRate: 128, timeout: time.Second, poll: 100 * time.Millisecond, reuseResultSlots: true, terminalStream: true, segmentedIntents: true}
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.reuseResultSlots = false
	if validateOptions(o) == nil {
		t.Fatal("segmented mode without slot/terminal recovery accepted")
	}
	o.reuseResultSlots = true
	o.terminalStream = false
	if validateOptions(o) == nil {
		t.Fatal("segmented mode without terminal evidence accepted")
	}
}
