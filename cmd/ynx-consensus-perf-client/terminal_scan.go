package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	cmt "github.com/cometbft/cometbft/types"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type completedTerminalScan struct {
	Records       int    `json:"validatedRecords"`
	Segments      int    `json:"validatedSegments"`
	Bytes         int64  `json:"validatedBytes"`
	CapturedBytes int64  `json:"capturedBytes"`
	ChainSHA256   string `json:"chainSha256"`
	Complete      bool   `json:"complete"`
}

// Read-only streaming recovery of reported observations. One bounded segment,
// directory chunk and nonce per sender are retained; no lifetime result/seen
// arrays. Callback rows remain a prefix until Complete is true with a nil error.
// Neither flags nor a hash chain replace independent BFT/state/signature proof.
func scanCompletedTerminalResults(ctx context.Context, directory string, expected terminalStreamReport, binding readySenderJournalHeader, senders, total int, maxBytes int64, consume func(transactionResult) error) (out completedTerminalScan, runErr error) {
	if expected.Encoding != "" && expected.Encoding != "gzip" {
		return out, errors.New("unsupported terminal encoding")
	}
	if ctx == nil || consume == nil || senders < 1 || senders > maxTransactions || total < senders || total > terminalStreamRecordLimit || total%senders != 0 || maxBytes < 1 || maxBytes > 1<<30 || expected.Poisoned || expected.Records != total || expected.DurableRecords != total || expected.Segments < 1 || expected.Segments > (total+terminalSegmentRecords-1)/terminalSegmentRecords || expected.Bytes < 1 || int64(expected.Bytes) > maxBytes {
		return out, errors.New("incomplete or unbounded terminal scan receipt")
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return out, err
	}
	reported, err := filepath.Abs(expected.Directory)
	if err != nil || absolute != reported {
		return out, errors.New("terminal evidence directory escaped expected output")
	}
	before, err := os.Lstat(absolute)
	if err != nil {
		return out, err
	}
	if !before.IsDir() || before.Mode()&os.ModeSymlink != 0 {
		return out, errors.New("terminal evidence must be an owned directory, not a symlink")
	}
	dir, err := os.Open(absolute)
	if err != nil {
		return out, err
	}
	defer func() {
		runErr = errors.Join(runErr, dir.Close())
		if runErr != nil {
			out.Complete = false
		}
	}()
	opened, err := dir.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return out, errors.New("terminal directory changed while opening")
	}
	count := 0
	for {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		entries, readErr := dir.ReadDir(64)
		for _, entry := range entries {
			count++
			number := strings.TrimSuffix(strings.TrimPrefix(entry.Name(), "terminal-"), ".jsonl")
			n, e := strconv.Atoi(number)
			if count > expected.Segments || e != nil || n < 0 || n >= expected.Segments || entry.Name() != fmt.Sprintf("terminal-%06d.jsonl", n) || !entry.Type().IsRegular() {
				return out, errors.New("terminal segment inventory differs from receipt")
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return out, readErr
		}
	}
	if count != expected.Segments {
		return out, errors.New("terminal segment inventory differs from receipt")
	}
	decoder, err := newTerminalStreamDecoder(binding, senders)
	if err != nil {
		return out, err
	}
	for segment := 0; segment < expected.Segments; segment++ {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		raw, err := captureTerminalSegment(filepath.Join(absolute, fmt.Sprintf("terminal-%06d.jsonl", segment)), maxBytes-out.CapturedBytes)
		if err != nil {
			return out, err
		}
		out.CapturedBytes += int64(len(raw))
		rows, err := decoder.decodeStored(raw, expected.Encoding)
		if err != nil {
			return out, err
		}
		for _, r := range rows {
			if err := ctx.Err(); err != nil {
				return out, err
			}
			if r.Index < 0 || r.Index >= total {
				return out, errors.New("terminal result outside bounded workload")
			}
			signed, err := base64.StdEncoding.DecodeString(r.SignedTransaction)
			if err != nil || len(signed) == 0 {
				return out, errors.New("terminal signed identity missing or invalid")
			}
			if err := verifySenderRound([]cmt.Tx{signed}, []transactionResult{r}); err != nil {
				return out, fmt.Errorf("terminal row is not a reported complete final observation: %w", err)
			}
			if err := consume(r); err != nil {
				return out, err
			}
			out.Records++
		}
		out.Bytes += int64(len(raw))
		out.Segments++
		out.ChainSHA256 = hex.EncodeToString(decoder.chain[:])
	}
	if decoder.sequence != total || out.Records != total || out.Bytes != int64(expected.Bytes) || out.ChainSHA256 != expected.ChainSHA256 {
		return out, errors.New("terminal stream count/bytes/final chain mismatch")
	}
	// Decoder enforces one strictly increasing round per sender. Together with
	// the total count and index bound this proves coverage without a seen array.
	for _, round := range decoder.lastRound {
		if round != total/senders {
			return out, errors.New("terminal sender coverage incomplete")
		}
	}
	after, err := os.Lstat(absolute)
	if err != nil || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
		return out, errors.New("terminal directory changed during scan")
	}
	out.Complete = true
	return out, nil
}
