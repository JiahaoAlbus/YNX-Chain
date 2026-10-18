package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
)

type readySenderReadback struct {
	Transactions   []cmttypes.Tx
	Records        int
	IncompleteTail bool
}

type readySenderStreamReadback struct {
	Records        int
	BytesRead      int64
	IncompleteTail bool
}

// Read-only identity recovery. The compatibility wrapper retains the original
// 2048-input/32-round/8MiB limits and lifetime array for existing callers.
func decodeReadySenderJournal(ctx context.Context, raw, manifestRaw []byte, m consensus.EphemeralNetworkManifest, initial []cmttypes.Tx, rounds int) (readySenderReadback, error) {
	if len(raw) > 8<<20 || rounds < 2 || rounds > 32 || len(initial) == 0 || len(initial)*rounds > maxTransactions {
		return readySenderReadback{}, errors.New("ready journal input bounds")
	}
	out := readySenderReadback{Transactions: make([]cmttypes.Tx, len(initial)*rounds)}
	stream, err := scanReadySenderJournal(ctx, bytes.NewReader(raw), manifestRaw, m, initial, rounds, 8<<20, func(e readySenderEnvelope) error {
		out.Transactions[e.Index] = append(cmttypes.Tx(nil), e.Transaction...)
		return nil
	})
	if err != nil {
		return readySenderReadback{}, err
	}
	out.Records, out.IncompleteTail = stream.Records, stream.IncompleteTail
	return out, nil
}

// Incremental identity recovery in the existing V1 format. Memory is one capped
// line plus one immutable template/nonce per sender, independent of record count.
// Callbacks receive only individually validated complete identities. A later
// error invalidates full-file acceptance; earlier callbacks are a prefix only.
// This never submits/resumes a transaction or treats an intent as business proof.
func scanReadySenderJournal(ctx context.Context, input io.Reader, manifestRaw []byte, m consensus.EphemeralNetworkManifest, initial []cmttypes.Tx, rounds int, maxBytes int64, consume func(readySenderEnvelope) error) (readySenderStreamReadback, error) {
	var out readySenderStreamReadback
	if input == nil || consume == nil || len(initial) < 1 || len(initial) > maxTransactions || rounds < 2 || rounds > terminalStreamRecordLimit/len(initial) || maxBytes < 1 || maxBytes > 1<<30 {
		return out, errors.New("ready journal streaming bounds")
	}
	reader := bufio.NewReaderSize(io.LimitReader(input, maxBytes+1), terminalRowLimit)
	readLine := func() ([]byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		line, err := reader.ReadSlice('\n')
		out.BytesRead += int64(len(line))
		if out.BytesRead > maxBytes {
			return nil, errors.New("ready journal byte bound")
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			return nil, errors.New("ready journal line byte bound")
		}
		return line, err
	}
	line, err := readLine()
	if err != nil {
		if !errors.Is(err, io.EOF) {
			return readySenderStreamReadback{}, err
		}
		return readySenderStreamReadback{}, errors.New("ready journal missing complete header")
	}
	var header readySenderJournalHeader
	if err := strictJSON(line, &header); err != nil {
		return readySenderStreamReadback{}, err
	}
	sum := sha256.Sum256(manifestRaw)
	if header.Kind != "YNX_LOCAL_READY_SENDER_V1" || header.ManifestSHA256 != hex.EncodeToString(sum[:]) || header.MigrationHash != m.MigrationStateHash || header.GenesisHash != m.GenesisHash {
		return readySenderStreamReadback{}, errors.New("ready journal fixture binding mismatch")
	}
	// Decode each initial template once. Every actual journal record still gets
	// its own full signature verification, including first-round records.
	templates := make([]consensus.SignedTransaction, len(initial))
	seen := make(map[string]bool, len(initial))
	for i, raw := range initial {
		if err := ctx.Err(); err != nil {
			return readySenderStreamReadback{}, err
		}
		base, err := consensus.DecodeSignedTransaction(raw)
		if err != nil {
			return readySenderStreamReadback{}, err
		}
		if fmt.Sprintf("ynx_%d-1", base.ChainID) != m.ChainID || base.Nonce != 1 || base.Amount != 1 || base.Fee != 1 || seen[base.From] {
			return readySenderStreamReadback{}, errors.New("ready journal initial sender/template mismatch")
		}
		templates[i], seen[base.From] = base, true
	}
	lastNonce := make([]uint64, len(initial))
	for {
		line, err := readLine()
		if errors.Is(err, io.EOF) {
			out.IncompleteTail = len(line) > 0
			if err := ctx.Err(); err != nil {
				return readySenderStreamReadback{}, err
			}
			return out, nil
		}
		if err != nil {
			return readySenderStreamReadback{}, err
		}
		if out.Records >= len(initial)*rounds {
			return readySenderStreamReadback{}, errors.New("ready journal record bound")
		}
		var e readySenderEnvelope
		if err := strictJSON(line, &e); err != nil {
			return readySenderStreamReadback{}, err
		}
		if e.Index < 0 || e.Index >= len(initial)*rounds || e.Sender != e.Index%len(initial) || e.Round != e.Index/len(initial)+1 || e.Hash != fmt.Sprintf("%X", e.Transaction.Hash()) {
			return readySenderStreamReadback{}, errors.New("ready envelope index/hash mismatch")
		}
		tx, err := consensus.DecodeSignedTransaction(e.Transaction)
		if err != nil {
			return readySenderStreamReadback{}, err
		}
		base := templates[e.Sender]
		if err := tx.Verify(base.ChainID); err != nil {
			return readySenderStreamReadback{}, err
		}
		if tx.From != base.From || tx.To != base.To || tx.Amount != 1 || tx.Fee != 1 || tx.Nonce != uint64(e.Round) || tx.Nonce != lastNonce[e.Sender]+1 || (e.Round == 1 && !bytes.Equal(e.Transaction, initial[e.Sender])) {
			return readySenderStreamReadback{}, errors.New("ready envelope sender/nonce/template mismatch or duplicate")
		}
		if err := consume(e); err != nil {
			return readySenderStreamReadback{}, err
		}
		lastNonce[e.Sender] = tx.Nonce
		out.Records++
	}
}
