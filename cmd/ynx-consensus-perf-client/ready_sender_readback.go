package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
)

type readySenderReadback struct {
	Transactions   []cmttypes.Tx
	Records        int
	IncompleteTail bool
}

// Read-only identity recovery. Missing/partial envelopes are never resubmitted
// or used to sign a later nonce. Only complete lines can identify possible writes.
func decodeReadySenderJournal(ctx context.Context, raw, manifestRaw []byte, m consensus.EphemeralNetworkManifest, initial []cmttypes.Tx, rounds int) (readySenderReadback, error) {
	var out readySenderReadback
	if len(raw) > 8<<20 || rounds < 2 || rounds > 32 || len(initial) == 0 || len(initial)*rounds > maxTransactions {
		return out, errors.New("ready journal input bounds")
	}
	lines := bytes.Split(raw, []byte{'\n'})
	if len(lines) < 2 || len(lines) > maxTransactions+3 {
		return out, errors.New("ready journal line bounds")
	}
	var header readySenderJournalHeader
	if err := strictJSON(lines[0], &header); err != nil {
		return out, err
	}
	sum := sha256.Sum256(manifestRaw)
	if header.Kind != "YNX_LOCAL_READY_SENDER_V1" || header.ManifestSHA256 != hex.EncodeToString(sum[:]) || header.MigrationHash != m.MigrationStateHash || header.GenesisHash != m.GenesisHash {
		return out, errors.New("ready journal fixture binding mismatch")
	}
	out.Transactions = make([]cmttypes.Tx, len(initial)*rounds)
	out.IncompleteTail = len(lines[len(lines)-1]) > 0
	lastNonce := make([]uint64, len(initial))
	for _, line := range lines[1 : len(lines)-1] {
		if err := ctx.Err(); err != nil {
			return readySenderReadback{}, err
		}
		var e readySenderEnvelope
		if err := strictJSON(line, &e); err != nil {
			return readySenderReadback{}, err
		}
		if e.Index < 0 || e.Index >= len(out.Transactions) || e.Sender != e.Index%len(initial) || e.Round != e.Index/len(initial)+1 || out.Transactions[e.Index] != nil || e.Hash != fmt.Sprintf("%X", e.Transaction.Hash()) {
			return readySenderReadback{}, errors.New("ready envelope index/hash mismatch or duplicate")
		}
		tx, err := consensus.DecodeSignedTransaction(e.Transaction)
		if err != nil {
			return readySenderReadback{}, err
		}
		base, err := consensus.DecodeSignedTransaction(initial[e.Sender])
		if err != nil {
			return readySenderReadback{}, err
		}
		if err := tx.Verify(base.ChainID); err != nil {
			return readySenderReadback{}, err
		}
		if tx.From != base.From || tx.To != base.To || tx.Amount != 1 || tx.Fee != 1 || tx.Nonce != uint64(e.Round) || tx.Nonce != lastNonce[e.Sender]+1 || (e.Round == 1 && !bytes.Equal(e.Transaction, initial[e.Sender])) {
			return readySenderReadback{}, errors.New("ready envelope sender/nonce/template mismatch")
		}
		out.Transactions[e.Index] = append(cmttypes.Tx(nil), e.Transaction...)
		lastNonce[e.Sender] = tx.Nonce
		out.Records++
	}
	if err := ctx.Err(); err != nil {
		return readySenderReadback{}, err
	}
	return out, nil
}
