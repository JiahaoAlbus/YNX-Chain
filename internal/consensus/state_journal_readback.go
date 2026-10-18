package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

var ErrSnapshotJournalBusy = errors.New("snapshot journal writer active")
var ErrSnapshotJournalEmpty = errors.New("snapshot journal has no complete state")

// SnapshotJSON borrows caller-owned input. State is independently decoded.
type SnapshotJournalReadback struct {
	State          CommittedState
	SnapshotJSON   []byte
	CompleteBytes  int
	Records        int
	IncompleteTail bool
}

func IsSnapshotJournal(data []byte) bool { return bytes.HasPrefix(data, []byte(snapshotJournalMagic)) }

// No lock creation or writes. Reopen the data file after acquiring the lock to
// follow compaction. Release is idempotent and must precede RPC/network waits.
func LockSnapshotJournalRead(path string) (func(), error) {
	f, err := journalRegularFile(path+".read.lock", os.O_RDONLY)
	if err != nil {
		return nil, err
	}
	if err := lockSnapshotJournalReader(f); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("%w: %v", ErrSnapshotJournalBusy, err)
	}
	var once sync.Once
	return func() { once.Do(func() { unlockSnapshotJournal(f); _ = f.Close() }) }, nil
}

// A valid record alone does not prove Sync completed. Live observers must also
// corroborate the node's published ABCI committed height after reading it.
func DecodeSnapshotJournal(ctx context.Context, data []byte, migration chain.ConsensusMigrationState) (SnapshotJournalReadback, error) {
	return decodeSnapshotJournalWithBootstrap(ctx, data, migration, nil)
}

// bootstrap is independent operator configuration; never recover it from the
// journal. The public legacy decoder deliberately continues to pass nil.
func decodeSnapshotJournalWithBootstrap(ctx context.Context, data []byte, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap) (SnapshotJournalReadback, error) {
	var result SnapshotJournalReadback
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if err := migration.Validate(); err != nil {
		return result, err
	}
	header := []byte(snapshotJournalMagic + migration.StateHash + "\n")
	if len(data) > len(header)+(snapshotJournalHeader+snapshotJournalMaxPayload)*snapshotJournalCompactRecords {
		return result, errors.New("journal readback exceeds record capacity")
	}
	if !bytes.HasPrefix(data, header) {
		return result, errors.New("journal readback migration/header mismatch")
	}
	position := len(header)
	height := int64(migration.Height)
	for position < len(data) {
		if err := ctx.Err(); err != nil {
			return SnapshotJournalReadback{}, err
		}
		if len(data)-position < snapshotJournalHeader {
			break
		}
		frame := data[position : position+snapshotJournalHeader]
		headerSum := sha256.Sum256(frame[:8])
		if !bytes.Equal(headerSum[:], frame[8:40]) {
			return SnapshotJournalReadback{}, errors.New("journal readback length checksum mismatch")
		}
		length := binary.BigEndian.Uint64(frame[:8])
		if length == 0 || length > snapshotJournalMaxPayload {
			return SnapshotJournalReadback{}, errors.New("journal readback invalid record length")
		}
		if uint64(len(data)-position-snapshotJournalHeader) < length {
			break
		}
		payload := data[position+snapshotJournalHeader : position+snapshotJournalHeader+int(length)]
		sum := journalRecordDigest(frame[:8], payload)
		if !bytes.Equal(sum[:], frame[40:]) {
			return SnapshotJournalReadback{}, errors.New("journal readback record checksum mismatch")
		}
		var nextHeight int64
		if err := decodeJournalIdentity(payload, &nextHeight); err != nil || nextHeight <= height {
			return SnapshotJournalReadback{}, errors.New("journal readback invalid height sequence")
		}
		height = nextHeight
		result.Records++
		if result.Records > snapshotJournalCompactRecords {
			return SnapshotJournalReadback{}, errors.New("journal readback too many records")
		}
		result.SnapshotJSON = payload
		position += snapshotJournalHeader + int(length)
	}
	if result.Records == 0 {
		return SnapshotJournalReadback{}, ErrSnapshotJournalEmpty
	}
	result.CompleteBytes, result.IncompleteTail = position, position < len(data)
	if err := decodeStrictJSON(result.SnapshotJSON, &result.State); err != nil {
		return SnapshotJournalReadback{}, err
	}
	result.State.bootstrap = bootstrap
	if err := result.State.Validate(migration); err != nil {
		return SnapshotJournalReadback{}, err
	}
	if err := ctx.Err(); err != nil {
		return SnapshotJournalReadback{}, err
	}
	return result, nil
}
