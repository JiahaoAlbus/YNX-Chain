package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Diagnostic-only real fixture signatures. No network, business acceptance or
// writer acknowledgement is inferred from these captured files.
func TestReadyIntentPrefixRetainsOnlyWholeValidatedWaves(t *testing.T) {
	for _, mode := range []string{"complete", "gap", "partial", "corrupt", "bad_signature", "wrong_fixture", "budget"} {
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
			waves := intentWaves(t, p)
			if mode == "bad_signature" {
				// Earlier row in the same wave is valid, but none of this wave
				// may escape when a later signature fails.
				var tx consensus.SignedTransaction
				if err := json.Unmarshal(waves[1][1].Transaction, &tx); err != nil {
					t.Fatal(err)
				}
				tx.Signature = "00"
				waves[1][1].Transaction, err = json.Marshal(tx)
				if err != nil {
					t.Fatal(err)
				}
				waves[1][1].Hash = fmt.Sprintf("%X", waves[1][1].Transaction.Hash())
			}
			if err := s.append(waves[0]); err != nil {
				t.Fatal(err)
			}
			firstBytes, firstHash := s.report.Bytes, s.report.ChainSHA256
			if err := s.append(waves[1]); err != nil {
				t.Fatal(err)
			}
			name := filepath.Join(s.report.Directory, "intent-000001.jsonl")
			raw, err := os.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			budget := int64(8 << 20)
			switch mode {
			case "gap":
				err = os.Rename(name, filepath.Join(s.report.Directory, "intent-000002.jsonl"))
			case "partial":
				err = os.WriteFile(name, raw[:len(raw)/2], 0600)
			case "corrupt":
				raw[len(raw)-3] ^= 1
				err = os.WriteFile(name, raw, 0600)
			case "wrong_fixture":
				manifest = append(append([]byte(nil), manifest...), ' ')
			case "budget":
				budget = firstBytes
			}
			if err != nil {
				t.Fatal(err)
			}
			got, err := readReadyIntentPrefix(context.Background(), s.report.Directory, manifest, m, initial, 2, budget)
			if err != nil || got.AcknowledgedInventory {
				t.Fatal("prefix claimed acknowledgement or failed diagnostics", got, err)
			}
			want := 3
			if mode == "complete" {
				want = 6
			}
			if mode == "wrong_fixture" {
				want = 0
			}
			if got.ValidatedRecords != want || got.Intents.Records != want || got.ValidatedSegments != want/3 {
				t.Fatal("incorrect validated prefix", got)
			}
			if mode == "complete" {
				if !got.ReachedInventoryEnd || got.Boundary != nil || got.ChainSHA256 != s.report.ChainSHA256 {
					t.Fatal("complete captured prefix changed", got)
				}
			} else if got.Boundary == nil || got.ReachedInventoryEnd {
				t.Fatal("invalid boundary hidden", got)
			}
			if want == 3 && (got.ValidatedBytes != firstBytes || got.ChainSHA256 != firstHash) {
				t.Fatal("bad wave advanced prefix hash/bytes", got)
			}
			for i, raw := range got.Intents.Transactions {
				if i < want && !bytes.Equal(raw, waves[i/3][i%3].Transaction) {
					t.Fatal("prefix identity changed", i)
				}
				if i >= want && raw != nil {
					t.Fatal("invalid wave leaked a signed identity", i)
				}
			}
		})
	}
}

func TestReadyIntentPrefixWithoutReportNeverPromotesUnknownToAcknowledged(t *testing.T) {
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(p.root, readyIntentSegmentsName)
	absent, err := readReadyIntentPrefix(context.Background(), directory, manifest, m, initial, 2, 8<<20)
	if err != nil || absent.ValidatedRecords != 0 || absent.Boundary == nil || absent.ReachedInventoryEnd || absent.AcknowledgedInventory {
		t.Fatal("missing directory invented evidence", absent, err)
	}
	s, err := newReadyIntentSegments(directory, p, 6, 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	wave := intentWaves(t, p)[0]
	// Actual complete persistence, followed by an injected uncertain return.
	s.persist = func(name string, raw []byte) error {
		if err := persistTerminalSegment(name, raw); err != nil {
			return err
		}
		return errors.New("uncertain return")
	}
	if s.append(wave) == nil || !s.report.Poisoned {
		t.Fatal("uncertain write accepted")
	}
	before, err := os.ReadFile(filepath.Join(directory, "intent-000000.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := readReadyIntentPrefix(context.Background(), directory, manifest, m, initial, 2, 8<<20)
	if err != nil || got.ValidatedRecords != 3 || !got.ReachedInventoryEnd || got.AcknowledgedInventory {
		t.Fatal("captured uncertain identities misclassified", got, err)
	}
	if _, err := readReadySenderIntents(context.Background(), p.root, manifest, m, initial, 2, nil); err == nil {
		t.Fatal("diagnostics bypassed missing-receipt full gate")
	}
	after, err := os.ReadFile(filepath.Join(directory, "intent-000000.jsonl"))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("diagnostics modified evidence", err)
	}
	if p.templates[0].Nonce != 1 || s.report.Records != 0 {
		t.Fatal("diagnostics advanced sender/writer")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := readReadyIntentPrefix(ctx, directory, manifest, m, initial, 2, 8<<20); !errors.Is(err, context.Canceled) {
		t.Fatal("cancel ignored", err)
	}
}

// Keep the sealed decoder shared with full readback; a rehashed malicious
// record still needs actual signature validation in the incremental scanner.
func TestReadyIntentSharedSegmentDecoderRejectsWrongPrefix(t *testing.T) {
	p := terminalFixture(t)
	s, err := newReadyIntentSegments(filepath.Join(t.TempDir(), "intents"), p, 6, 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.append(intentWaves(t, p)[0]); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(s.report.Directory, "intent-000000.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	_, _, digest, err := decodeReadyIntentSegment(raw, s.binding, 0, 0, fmt.Sprintf("%064x", 0))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if digest != hex.EncodeToString(sum[:]) {
		t.Fatal("file digest differs")
	}
	if _, _, _, err := decodeReadyIntentSegment(raw, s.binding, 1, 0, fmt.Sprintf("%064x", 0)); err == nil {
		t.Fatal("wrong segment accepted")
	}
}

func TestReadyIntentPartialSelectionRequiresPlanAndNeverDowngradesAcknowledgedCorruption(t *testing.T) {
	for _, mode := range []string{"no_plan", "missing_receipt", "poisoned", "full_receipt", "corrupt_acknowledged", "mixed", "escaped"} {
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
			planned := mode != "no_plan"
			var expected *readyIntentSegmentReport
			copy := s.report
			if mode == "poisoned" || mode == "escaped" {
				copy.Poisoned = true
				expected = &copy
			}
			if mode == "escaped" {
				copy.Directory = t.TempDir()
			}
			if mode == "full_receipt" || mode == "corrupt_acknowledged" {
				expected = &copy
			}
			if mode == "corrupt_acknowledged" {
				name := filepath.Join(s.report.Directory, "intent-000001.jsonl")
				raw, e := os.ReadFile(name)
				if e != nil {
					t.Fatal(e)
				}
				if e = os.WriteFile(name, raw[:len(raw)/2], 0600); e != nil {
					t.Fatal(e)
				}
			}
			if mode == "mixed" {
				if err := os.WriteFile(filepath.Join(p.root, readySenderJournalName), []byte("retain mixed evidence\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			got, prefix, err := readPartialReadySenderIntents(context.Background(), p.root, manifest, m, initial, 2, planned, expected)
			switch mode {
			case "missing_receipt", "poisoned":
				if err != nil || got.Records != 6 || prefix == nil || prefix.AcknowledgedInventory {
					t.Fatal("explicit diagnostic selection failed", got, prefix, err)
				}
			case "full_receipt":
				if err != nil || got.Records != 6 || prefix != nil {
					t.Fatal("full receipt unexpectedly downgraded", got, prefix, err)
				}
			default:
				if err == nil || prefix != nil || got.Records != 0 {
					t.Fatal("unapproved or corrupted evidence downgraded", got, prefix, err)
				}
			}
		})
	}
}
