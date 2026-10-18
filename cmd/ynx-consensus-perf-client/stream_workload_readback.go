package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmt "github.com/cometbft/cometbft/types"
)

// Join immutable signed intents to terminal observations without lifetime arrays.
// Pending identities are bounded by sender slots plus one 64-envelope wave.
// This verifies retained observation identity, not independent BFT/state replay.
func verifyStreamingWorkloadEvidence(ctx context.Context, manifestRaw []byte, m consensus.EphemeralNetworkManifest, initial []cmt.Tx, rounds int, intents *readyIntentSegmentReport, terminal *terminalStreamReport, latest []transactionResult, output string, byteBudget int64) error {
	senders := len(initial)
	if ctx == nil || senders < 1 || senders > maxTransactions || rounds < 2 || rounds > 4096 || rounds > terminalStreamRecordLimit/senders || intents == nil || terminal == nil || len(latest) != senders || byteBudget < 1 || byteBudget > 2<<30 {
		return errors.New("streaming readback plan bound")
	}
	total := senders * rounds
	if intents.Records != total || terminal.Records != total || intents.Bytes < 1 || terminal.Bytes < 1 || intents.Bytes+int64(terminal.Bytes) > byteBudget {
		return errors.New("streaming evidence count or shared budget differs")
	}
	terminalDir, err := filepath.Abs(output + ".terminal-stream")
	if err != nil {
		return err
	}
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	envelopes := make(chan readySenderEnvelope, 1)
	producer := make(chan error, 1)
	go func() {
		result, err := scanReadyIntentSegments(child, *intents, manifestRaw, m, initial, rounds, 1<<30, func(e readySenderEnvelope) error {
			select {
			case envelopes <- e:
				return nil
			case <-child.Done():
				return child.Err()
			}
		})
		if err == nil && (result.Records != total || result.IncompleteTail) {
			err = errors.New("signed-intent stream incomplete")
		}
		close(envelopes)
		producer <- err
	}()
	pending := make(map[int]readySenderEnvelope, senders)
	matchedLatest := make([]bool, senders)
	binding := readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", fmt.Sprintf("%x", sha256.Sum256(manifestRaw)), m.MigrationStateHash, m.GenesisHash}
	scanned, scanErr := scanCompletedTerminalResults(child, terminalDir, *terminal, binding, senders, total, 1<<30, func(r transactionResult) error {
		for {
			if e, ok := pending[r.Index]; ok {
				raw, err := base64.StdEncoding.DecodeString(r.SignedTransaction)
				if err != nil || e.Hash != r.Hash || !bytes.Equal(e.Transaction, raw) {
					return errors.New("terminal signed input differs from verified intent")
				}
				delete(pending, r.Index)
				if r.Round == rounds {
					sender := r.Index % senders
					expected, err := json.Marshal(r)
					if err != nil {
						return err
					}
					actual, err := json.Marshal(latest[sender])
					if err != nil || !bytes.Equal(actual, expected) {
						return errors.New("latest streaming slot differs from terminal")
					}
					matchedLatest[sender] = true
				}
				return nil
			}
			select {
			case e, ok := <-envelopes:
				if !ok {
					return errors.New("terminal has no matching signed intent")
				}
				if _, exists := pending[e.Index]; exists {
					return errors.New("duplicate signed-intent identity")
				}
				pending[e.Index] = e
				if len(pending) > senders+terminalSegmentRecords {
					return errors.New("signed/terminal join exceeds bounded in-flight scope")
				}
			case <-child.Done():
				return child.Err()
			}
		}
	})
	if scanErr == nil {
		for range envelopes {
			scanErr = errors.New("unmatched signed intents after terminal stream")
			cancel()
			break
		}
	}
	cancel()
	intentErr := <-producer
	if scanErr != nil || intentErr != nil {
		return errors.Join(scanErr, intentErr)
	}
	if !scanned.Complete || len(pending) != 0 {
		return errors.New("streaming evidence join incomplete")
	}
	for _, ok := range matchedLatest {
		if !ok {
			return errors.New("missing final streaming slot")
		}
	}
	return nil
}
