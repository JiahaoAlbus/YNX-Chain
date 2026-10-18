package main

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	cmt "github.com/cometbft/cometbft/types"
)

type terminalPrefixBoundary struct {
	Segment int    `json:"segment"`
	Kind    string `json:"kind"`
	Detail  string `json:"detail"`
}
type terminalPrefixReadback struct {
	Rows                []transactionResult     `json:"-"`
	ValidatedSegments   int                     `json:"validatedSegments"`
	ValidatedRecords    int                     `json:"validatedRecords"`
	CapturedBytes       int                     `json:"capturedBytes"`
	ValidatedBytes      int                     `json:"validatedBytes"`
	ChainSHA256         string                  `json:"chainSha256"`
	ReachedInventoryEnd bool                    `json:"reachedInventoryEnd"`
	Boundary            *terminalPrefixBoundary `json:"boundary,omitempty"`
}

// Read-only diagnostic observations. Reaching the directory end does not mean
// the workload finished or that missing terminal rows were never submitted.
// Intents must already have passed the fixture-bound signed-journal decoder.
func readTerminalPrefix(directory string, binding readySenderJournalHeader, senders int, intents []cmt.Tx) (terminalPrefixReadback, error) {
	out := terminalPrefixReadback{ChainSHA256: strings.Repeat("0", 64)}
	if senders < 1 || len(intents) < senders || len(intents) > maxTransactions || len(intents)%senders != 0 || len(intents)/senders > 32 {
		return out, errors.New("partial terminal input bounds")
	}
	info, err := os.Lstat(directory)
	if os.IsNotExist(err) {
		out.Boundary = &terminalPrefixBoundary{0, "directory_absent", "No terminal directory; signed identities are not evidence of an unsubmitted outcome"}
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return out, errors.New("partial terminal directory is not a regular directory")
	}
	maxSegments := (len(intents) + terminalSegmentRecords - 1) / terminalSegmentRecords
	dir, err := os.Open(directory)
	if err != nil {
		return out, err
	}
	entries, readErr := dir.ReadDir(maxSegments + 1)
	closeErr := dir.Close()
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return out, readErr
	}
	if closeErr != nil {
		return out, closeErr
	}
	if len(entries) > maxSegments {
		return out, errors.New("partial terminal inventory bound")
	}
	indices := map[int]bool{}
	for _, entry := range entries {
		name := entry.Name()
		number := strings.TrimSuffix(strings.TrimPrefix(name, "terminal-"), ".jsonl")
		index, e := strconv.Atoi(number)
		if e != nil || index < 0 || index >= maxSegments || name != fmt.Sprintf("terminal-%06d.jsonl", index) || indices[index] || !entry.Type().IsRegular() {
			return out, errors.New("unexpected partial terminal inventory")
		}
		indices[index] = true
	}
	decoder, err := newTerminalStreamDecoder(binding, senders)
	if err != nil {
		return out, err
	}
	lastStatus := make([]string, senders)
	seenSender := make([]bool, senders)
	stop := func(segment int, kind string, err error) (terminalPrefixReadback, error) {
		out.Boundary = &terminalPrefixBoundary{segment, kind, err.Error()}
		return out, nil
	}
	for segment := 0; segment < len(entries); segment++ {
		if !indices[segment] {
			return stop(segment, "segment_gap", errors.New("Later segments cannot be used across a missing prefix"))
		}
		name := filepath.Join(directory, fmt.Sprintf("terminal-%06d.jsonl", segment))
		raw, e := captureTerminalSegment(name, int64((16<<20)-out.CapturedBytes))
		if e != nil {
			return stop(segment, "segment_read_failed", e)
		}
		out.CapturedBytes += len(raw)
		rows, e := decoder.decode(raw)
		if e != nil {
			return stop(segment, "invalid_segment", e)
		}
		nextStatus := append([]string(nil), lastStatus...)
		nextSeen := append([]bool(nil), seenSender...)
		// Validate the whole segment before publishing any row or chain watermark.
		for _, r := range rows {
			if e = validateTerminalIntent(r, senders, intents); e != nil {
				return stop(segment, "unbound_signed_intent", e)
			}
			raw := intents[r.Index]
			sender := r.Index % senders
			if nextSeen[sender] && nextStatus[sender] != "confirmed" {
				return stop(segment, "successor_after_nonfinal", errors.New("A quarantined sender has a later terminal nonce"))
			}
			if r.Status == "confirmed" {
				if e = verifySenderRound([]cmt.Tx{raw}, []transactionResult{r}); e != nil {
					return stop(segment, "invalid_confirmed_observation", e)
				}
			}
			nextStatus[sender] = r.Status
			nextSeen[sender] = true
		}
		lastStatus = nextStatus
		seenSender = nextSeen
		out.Rows = append(out.Rows, rows...)
		out.ValidatedSegments++
		out.ValidatedRecords += len(rows)
		out.ValidatedBytes += len(raw)
		out.ChainSHA256 = hex.EncodeToString(decoder.chain[:])
	}
	out.ReachedInventoryEnd = true
	return out, nil
}

func validateTerminalIntent(r transactionResult, senders int, intents []cmt.Tx) error {
	if senders < 1 || r.Index < 0 || r.Index >= len(intents) || len(intents[r.Index]) == 0 || r.Round != r.Index/senders+1 {
		return errors.New("terminal identity outside complete signed intents")
	}
	raw := intents[r.Index]
	if r.SignedTransaction != base64.StdEncoding.EncodeToString(raw) || r.Hash != fmt.Sprintf("%X", raw.Hash()) {
		return errors.New("terminal payload/hash differs from signed intent")
	}
	return nil
}

type terminalReportedObservation struct {
	Result transactionResult
	Source string
}

// Latest slots provide only explicit original observations, never missing prior
// history. Conflicts preserve neither replacement nor an invented success.
func mergeTerminalPrefixAndLatest(prefix, latest []transactionResult, senders int, intents []cmt.Tx) ([]terminalReportedObservation, error) {
	if senders < 1 || len(latest) != senders || len(intents) < senders || len(intents) > maxTransactions || len(intents)%senders != 0 || len(intents)/senders > 32 || len(prefix) > len(intents) {
		return nil, errors.New("partial observation merge bounds")
	}
	byIndex := map[int]terminalReportedObservation{}
	for _, r := range prefix {
		if err := validateTerminalIntent(r, senders, intents); err != nil {
			return nil, err
		}
		if _, ok := byIndex[r.Index]; ok {
			return nil, errors.New("duplicate prefix observation")
		}
		byIndex[r.Index] = terminalReportedObservation{r, "sealed_prefix"}
	}
	for sender, r := range latest {
		if r.SignedTransaction == "" {
			continue
		}
		if err := validateTerminalIntent(r, senders, intents); err != nil {
			return nil, err
		}
		if r.Index%senders != sender {
			return nil, errors.New("latest observation belongs to another sender slot")
		}
		if prior, ok := byIndex[r.Index]; ok {
			a, err := json.Marshal(prior.Result)
			if err != nil {
				return nil, err
			}
			b, err := json.Marshal(r)
			if err != nil || !bytes.Equal(a, b) {
				return nil, errors.New("latest slot conflicts with sealed observation; original status cannot be replaced")
			}
			prior.Source = "sealed_prefix+latest_slot"
			byIndex[r.Index] = prior
		} else {
			byIndex[r.Index] = terminalReportedObservation{r, "latest_slot"}
		}
	}
	out := make([]terminalReportedObservation, 0, len(byIndex))
	seenSender := make([]bool, senders)
	lastStatus := make([]string, senders)
	for index := range intents {
		if row, ok := byIndex[index]; ok {
			sender := index % senders
			if seenSender[sender] && lastStatus[sender] != "confirmed" {
				return nil, errors.New("latest slot advances a sender quarantined in terminal history")
			}
			seenSender[sender], lastStatus[sender] = true, row.Result.Status
			out = append(out, row)
		}
	}
	return out, nil
}
