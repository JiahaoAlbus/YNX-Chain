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
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
)

type readyIntentPrefixReadback struct {
	Intents               readySenderReadback     `json:"-"`
	ValidatedSegments     int                     `json:"validatedSegments"`
	ValidatedRecords      int                     `json:"validatedRecords"`
	CapturedBytes         int64                   `json:"capturedBytes"`
	ValidatedBytes        int64                   `json:"validatedBytes"`
	ChainSHA256           string                  `json:"chainSha256"`
	ReachedInventoryEnd   bool                    `json:"reachedInventoryEnd"`
	AcknowledgedInventory bool                    `json:"acknowledgedInventory"`
	Boundary              *terminalPrefixBoundary `json:"boundary,omitempty"`
	Interpretation        string                  `json:"interpretation"`
}

// This reader never skips a missing/corrupt segment. EOF at a boundary lets the
// existing signature scanner finish only the captured prefix. A bad signature
// is still an error from that scanner, and the caller discards that entire wave.
type readyIntentPrefixSource struct {
	ctx         context.Context
	directory   string
	binding     readySenderJournalHeader
	inventory   int
	maxBytes    int64
	captured    int64
	next        int
	records     int
	chain       string
	current     *bytes.Reader
	active      readyIntentSegmentHeader
	activeBytes int64
	boundary    *terminalPrefixBoundary
}

func (r *readyIntentPrefixSource) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if r.current.Len() > 0 {
		return r.current.Read(p)
	}
	if r.boundary != nil || r.next == r.inventory {
		return 0, io.EOF
	}
	name := filepath.Join(r.directory, fmt.Sprintf("intent-%06d.jsonl", r.next))
	raw, err := captureTerminalSegment(name, r.maxBytes-r.captured)
	if err != nil {
		kind := "segment_capture_failed"
		if os.IsNotExist(err) {
			kind = "segment_gap"
		}
		r.boundary = &terminalPrefixBoundary{r.next, kind, err.Error()}
		return 0, io.EOF
	}
	r.captured += int64(len(raw))
	h, payload, chain, err := decodeReadyIntentSegment(raw, r.binding, r.next, r.records, r.chain)
	if err != nil {
		r.boundary = &terminalPrefixBoundary{r.next, "invalid_sealed_segment", err.Error()}
		return 0, io.EOF
	}
	r.active, r.activeBytes = h, int64(len(raw))
	r.chain, r.records = chain, r.records+h.Records
	r.next++
	r.current = bytes.NewReader(payload)
	return r.current.Read(p)
}

// Bounded read-only diagnostics without an acknowledged final report. Only a
// whole wave whose framing AND every actual signature/nonce pass is returned.
// A valid complete file may be an unacknowledged write; no identity here grants
// retry, sender advancement, transaction acceptance, durable completion or TPS.
func readReadyIntentPrefix(ctx context.Context, directory string, manifestRaw []byte, m consensus.EphemeralNetworkManifest, initial []cmttypes.Tx, rounds int, maxBytes int64) (readyIntentPrefixReadback, error) {
	var out readyIntentPrefixReadback
	if rounds < 2 || rounds > 32 || len(initial) < 1 || len(initial)*rounds > maxTransactions || maxBytes < 1 || maxBytes > 8<<20 || !filepath.IsAbs(directory) {
		return out, errors.New("ready intent prefix input bounds")
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	out.Intents.Transactions = make([]cmttypes.Tx, len(initial)*rounds)
	out.ChainSHA256 = fmt.Sprintf("%064x", 0)
	out.Interpretation = "Read-only signed-intent prefix. Complete files do not establish writer acknowledgement; absent identities are not unsubmitted outcomes. No retry, sender advancement, business success or TPS is authorized."
	info, err := os.Lstat(directory)
	if os.IsNotExist(err) {
		out.Boundary = &terminalPrefixBoundary{0, "directory_absent", "No signed-input evidence; possible submission outcomes remain unknown"}
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return out, errors.New("ready intent prefix directory is not regular")
	}
	dir, err := os.Open(directory)
	if err != nil {
		return out, err
	}
	count := 0
	for {
		if err := ctx.Err(); err != nil {
			_ = dir.Close()
			return out, err
		}
		entries, readErr := dir.ReadDir(64)
		for _, entry := range entries {
			count++
			n, e := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(entry.Name(), "intent-"), ".jsonl"))
			if count > len(initial)*rounds || e != nil || n < 0 || n >= len(initial)*rounds || entry.Name() != fmt.Sprintf("intent-%06d.jsonl", n) || !entry.Type().IsRegular() {
				_ = dir.Close()
				out.Boundary = &terminalPrefixBoundary{0, "unexpected_inventory", "No identities accepted from ambiguous input inventory"}
				return out, nil
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			_ = dir.Close()
			return out, readErr
		}
	}
	if err := dir.Close(); err != nil {
		return out, err
	}
	sum := sha256.Sum256(manifestRaw)
	binding := readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", hex.EncodeToString(sum[:]), m.MigrationStateHash, m.GenesisHash}
	header, err := json.Marshal(binding)
	if err != nil {
		return out, err
	}
	header = append(header, '\n')
	source := &readyIntentPrefixSource{ctx: ctx, directory: directory, binding: binding, inventory: count, maxBytes: maxBytes, chain: out.ChainSHA256, current: bytes.NewReader(header)}
	staged := make([]readySenderEnvelope, 0, terminalSegmentRecords)
	_, scanErr := scanReadySenderJournal(ctx, source, manifestRaw, m, initial, rounds, maxBytes+int64(len(header)), func(e readySenderEnvelope) error {
		if source.active.FirstRecord != out.ValidatedRecords || source.active.Segment != out.ValidatedSegments {
			return errors.New("ready prefix wave order mismatch")
		}
		staged = append(staged, e)
		if len(staged) > source.active.Records {
			return errors.New("ready prefix wave record overflow")
		}
		if len(staged) == source.active.Records {
			for _, e := range staged {
				if out.Intents.Transactions[e.Index] != nil {
					return errors.New("duplicate ready prefix identity")
				}
			}
			for _, e := range staged {
				out.Intents.Transactions[e.Index] = append(cmttypes.Tx(nil), e.Transaction...)
			}
			out.ValidatedRecords += len(staged)
			out.Intents.Records = out.ValidatedRecords
			out.ValidatedSegments++
			out.ValidatedBytes += source.activeBytes
			out.ChainSHA256 = source.chain
			staged = staged[:0]
		}
		return nil
	})
	out.CapturedBytes = source.captured
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if scanErr != nil {
		out.Boundary = &terminalPrefixBoundary{source.active.Segment, "signature_or_record_validation_failed", scanErr.Error()}
		return out, nil
	}
	if len(staged) != 0 {
		return out, errors.New("partial ready wave escaped scanner")
	}
	out.Boundary = source.boundary
	out.ReachedInventoryEnd = source.boundary == nil && source.next == count
	return out, nil
}

// Only an explicit retired segmented-window plan enables unacknowledged prefix
// diagnostics. A present, nonpoisoned full receipt must still pass the full gate;
// corruption cannot silently downgrade it into successful prefix acceptance.
func readPartialReadySenderIntents(ctx context.Context, networkDir string, manifestRaw []byte, m consensus.EphemeralNetworkManifest, initial []cmttypes.Tx, rounds int, segmentedPlanned bool, expected *readyIntentSegmentReport) (readySenderReadback, *readyIntentPrefixReadback, error) {
	if !segmentedPlanned || (expected != nil && !expected.Poisoned) {
		out, err := readReadySenderIntents(ctx, networkDir, manifestRaw, m, initial, rounds, expected)
		return out, nil, err
	}
	directory, err := filepath.Abs(filepath.Join(networkDir, readyIntentSegmentsName))
	if err != nil {
		return readySenderReadback{}, nil, err
	}
	if expected != nil && expected.Directory != directory {
		return readySenderReadback{}, nil, errors.New("uncertain segment receipt escaped fixture")
	}
	if _, err := os.Lstat(filepath.Join(networkDir, readySenderJournalName)); err == nil || !os.IsNotExist(err) {
		return readySenderReadback{}, nil, errors.New("mixed or unreadable legacy input evidence; no diagnostic fallback")
	}
	prefix, err := readReadyIntentPrefix(ctx, directory, manifestRaw, m, initial, rounds, 8<<20)
	if err != nil {
		return readySenderReadback{}, nil, err
	}
	return prefix.Intents, &prefix, nil
}
