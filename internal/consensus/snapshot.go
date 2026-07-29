package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"

	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const (
	stateSyncSnapshotFormat    uint32 = 1
	stateSyncSnapshotChunkSize        = 1 << 20
	stateSyncSnapshotMaxBytes         = 64 << 20
	stateSyncSnapshotCacheSize        = 4
)

const stateSyncSnapshotSchema = "ynx-abci-state-snapshot/v1"

type stateSyncSnapshotMetadata struct {
	Schema             string `json:"schema"`
	StateVersion       int    `json:"stateVersion"`
	ChainID            int64  `json:"chainId"`
	MigrationStateHash string `json:"migrationStateHash"`
	Height             uint64 `json:"height"`
	AppHash            string `json:"appHash"`
	PayloadBytes       int    `json:"payloadBytes"`
	ChunkSize          int    `json:"chunkSize"`
}

type stateSyncSnapshotExport struct {
	snapshot *abcitypes.Snapshot
	chunks   [][]byte
}

type stateSyncSnapshotRestore struct {
	snapshot        *abcitypes.Snapshot
	metadata        stateSyncSnapshotMetadata
	expectedAppHash []byte
	chunks          [][]byte
	received        []bool
	receivedBytes   int
}

func (a *Application) ListSnapshots(context.Context, *abcitypes.RequestListSnapshots) (*abcitypes.ResponseListSnapshots, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if !a.committed.Initialized || a.committed.Height < 0 {
		return &abcitypes.ResponseListSnapshots{}, nil
	}
	exported, err := a.buildStateSyncSnapshotLocked()
	if err != nil {
		return nil, err
	}
	return &abcitypes.ResponseListSnapshots{Snapshots: []*abcitypes.Snapshot{cloneABCSnapshot(exported.snapshot)}}, nil
}

func (a *Application) LoadSnapshotChunk(_ context.Context, req *abcitypes.RequestLoadSnapshotChunk) (*abcitypes.ResponseLoadSnapshotChunk, error) {
	if req == nil {
		return &abcitypes.ResponseLoadSnapshotChunk{}, nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	exported, ok := a.snapshotExports[req.Height]
	if !ok && req.Format == stateSyncSnapshotFormat && a.committed.Initialized && req.Height == uint64(a.committed.Height) {
		var err error
		exported, err = a.buildStateSyncSnapshotLocked()
		if err != nil {
			return nil, err
		}
		ok = true
	}
	if !ok || exported.snapshot.Format != req.Format || req.Chunk >= uint32(len(exported.chunks)) {
		return &abcitypes.ResponseLoadSnapshotChunk{}, nil
	}
	return &abcitypes.ResponseLoadSnapshotChunk{Chunk: append([]byte(nil), exported.chunks[req.Chunk]...)}, nil
}

func (a *Application) OfferSnapshot(_ context.Context, req *abcitypes.RequestOfferSnapshot) (*abcitypes.ResponseOfferSnapshot, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.pending != nil {
		return &abcitypes.ResponseOfferSnapshot{Result: abcitypes.ResponseOfferSnapshot_ABORT}, nil
	}
	if req == nil || req.Snapshot == nil {
		return &abcitypes.ResponseOfferSnapshot{Result: abcitypes.ResponseOfferSnapshot_REJECT}, nil
	}
	snapshot := req.Snapshot
	if snapshot.Format != stateSyncSnapshotFormat {
		return &abcitypes.ResponseOfferSnapshot{Result: abcitypes.ResponseOfferSnapshot_REJECT_FORMAT}, nil
	}
	if snapshot.Height > math.MaxInt64 || snapshot.Chunks == 0 || snapshot.Chunks > uint32(stateSyncSnapshotMaxBytes/stateSyncSnapshotChunkSize) || len(snapshot.Hash) != sha256.Size {
		return &abcitypes.ResponseOfferSnapshot{Result: abcitypes.ResponseOfferSnapshot_REJECT}, nil
	}
	if a.committed.Initialized && int64(snapshot.Height) <= a.committed.Height {
		return &abcitypes.ResponseOfferSnapshot{Result: abcitypes.ResponseOfferSnapshot_REJECT}, nil
	}
	metadata, err := decodeStateSyncSnapshotMetadata(snapshot.Metadata)
	if err != nil || metadata.Schema != stateSyncSnapshotSchema || metadata.StateVersion != CommittedStateVersion || metadata.ChainID != a.migration.Network.ChainID || metadata.MigrationStateHash != a.migration.StateHash || metadata.Height != snapshot.Height || metadata.ChunkSize != stateSyncSnapshotChunkSize || metadata.PayloadBytes < 1 || metadata.PayloadBytes > stateSyncSnapshotMaxBytes {
		return &abcitypes.ResponseOfferSnapshot{Result: abcitypes.ResponseOfferSnapshot_REJECT}, nil
	}
	expectedChunks := uint32((metadata.PayloadBytes + metadata.ChunkSize - 1) / metadata.ChunkSize)
	if expectedChunks != snapshot.Chunks {
		return &abcitypes.ResponseOfferSnapshot{Result: abcitypes.ResponseOfferSnapshot_REJECT}, nil
	}
	metadataAppHash, err := hex.DecodeString(metadata.AppHash)
	if err != nil || len(metadataAppHash) != sha256.Size || !bytes.Equal(metadataAppHash, req.AppHash) {
		return &abcitypes.ResponseOfferSnapshot{Result: abcitypes.ResponseOfferSnapshot_REJECT}, nil
	}

	a.snapshotRestore = &stateSyncSnapshotRestore{
		snapshot:        cloneABCSnapshot(snapshot),
		metadata:        metadata,
		expectedAppHash: append([]byte(nil), req.AppHash...),
		chunks:          make([][]byte, snapshot.Chunks),
		received:        make([]bool, snapshot.Chunks),
	}
	return &abcitypes.ResponseOfferSnapshot{Result: abcitypes.ResponseOfferSnapshot_ACCEPT}, nil
}

func (a *Application) ApplySnapshotChunk(_ context.Context, req *abcitypes.RequestApplySnapshotChunk) (*abcitypes.ResponseApplySnapshotChunk, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.snapshotRestore == nil {
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_ABORT}, nil
	}
	restore := a.snapshotRestore
	if req == nil || req.Index >= uint32(len(restore.chunks)) || len(req.Chunk) == 0 || len(req.Chunk) > restore.metadata.ChunkSize {
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT}, nil
	}
	expectedChunkBytes := restore.metadata.ChunkSize
	if req.Index == uint32(len(restore.chunks)-1) {
		expectedChunkBytes = restore.metadata.PayloadBytes - int(req.Index)*restore.metadata.ChunkSize
	}
	if len(req.Chunk) != expectedChunkBytes {
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT}, nil
	}
	if restore.received[req.Index] {
		if bytes.Equal(restore.chunks[req.Index], req.Chunk) {
			return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_ACCEPT}, nil
		}
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT}, nil
	}
	restore.chunks[req.Index] = append([]byte(nil), req.Chunk...)
	restore.received[req.Index] = true
	restore.receivedBytes += len(req.Chunk)
	if restore.receivedBytes > restore.metadata.PayloadBytes {
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT}, nil
	}
	for _, received := range restore.received {
		if !received {
			return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_ACCEPT}, nil
		}
	}

	payload := make([]byte, 0, restore.receivedBytes)
	for _, chunk := range restore.chunks {
		payload = append(payload, chunk...)
	}
	if len(payload) != restore.metadata.PayloadBytes {
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT}, nil
	}
	sum := sha256.Sum256(payload)
	if !bytes.Equal(sum[:], restore.snapshot.Hash) {
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT}, nil
	}
	var state CommittedState
	if err := decodeStrictJSON(payload, &state); err != nil || state.Height != int64(restore.snapshot.Height) || !strings.EqualFold(state.AppHash, restore.metadata.AppHash) {
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT}, nil
	}
	if err := state.Validate(a.migration); err != nil {
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT}, nil
	}
	stateAppHash, err := hex.DecodeString(state.AppHash)
	if err != nil || !bytes.Equal(stateAppHash, restore.expectedAppHash) {
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_REJECT_SNAPSHOT}, nil
	}
	if err := saveCommittedState(a.statePath, state, a.migration); err != nil {
		a.snapshotRestore = nil
		return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_ABORT}, nil
	}
	a.committed = state
	a.pending = nil
	a.snapshotRestore = nil
	if a.snapshotExports != nil {
		delete(a.snapshotExports, uint64(state.Height))
	}
	return &abcitypes.ResponseApplySnapshotChunk{Result: abcitypes.ResponseApplySnapshotChunk_ACCEPT}, nil
}

func (a *Application) buildStateSyncSnapshotLocked() (stateSyncSnapshotExport, error) {
	if a.committed.Height < 0 {
		return stateSyncSnapshotExport{}, errors.New("committed height cannot be negative")
	}
	payload, err := json.Marshal(a.committed)
	if err != nil {
		return stateSyncSnapshotExport{}, fmt.Errorf("encode committed state snapshot: %w", err)
	}
	if len(payload) == 0 || len(payload) > stateSyncSnapshotMaxBytes {
		return stateSyncSnapshotExport{}, fmt.Errorf("committed state snapshot size %d is outside the supported range", len(payload))
	}
	metadata := stateSyncSnapshotMetadata{
		Schema:             stateSyncSnapshotSchema,
		StateVersion:       CommittedStateVersion,
		ChainID:            a.committed.ChainID,
		MigrationStateHash: a.committed.MigrationStateHash,
		Height:             uint64(a.committed.Height),
		AppHash:            strings.ToLower(a.committed.AppHash),
		PayloadBytes:       len(payload),
		ChunkSize:          stateSyncSnapshotChunkSize,
	}
	metadataPayload, err := json.Marshal(metadata)
	if err != nil {
		return stateSyncSnapshotExport{}, fmt.Errorf("encode state sync snapshot metadata: %w", err)
	}
	chunks := make([][]byte, 0, (len(payload)+stateSyncSnapshotChunkSize-1)/stateSyncSnapshotChunkSize)
	for start := 0; start < len(payload); start += stateSyncSnapshotChunkSize {
		end := start + stateSyncSnapshotChunkSize
		if end > len(payload) {
			end = len(payload)
		}
		chunks = append(chunks, append([]byte(nil), payload[start:end]...))
	}
	sum := sha256.Sum256(payload)
	snapshot := &abcitypes.Snapshot{
		Height:   uint64(a.committed.Height),
		Format:   stateSyncSnapshotFormat,
		Chunks:   uint32(len(chunks)),
		Hash:     append([]byte(nil), sum[:]...),
		Metadata: metadataPayload,
	}
	exported := stateSyncSnapshotExport{snapshot: snapshot, chunks: chunks}
	if a.snapshotExports == nil {
		a.snapshotExports = make(map[uint64]stateSyncSnapshotExport)
	}
	a.snapshotExports[snapshot.Height] = exported
	if len(a.snapshotExports) > stateSyncSnapshotCacheSize {
		heights := make([]uint64, 0, len(a.snapshotExports))
		for height := range a.snapshotExports {
			heights = append(heights, height)
		}
		sort.Slice(heights, func(i, j int) bool { return heights[i] < heights[j] })
		for len(heights) > stateSyncSnapshotCacheSize {
			delete(a.snapshotExports, heights[0])
			heights = heights[1:]
		}
	}
	return exported, nil
}

func decodeStateSyncSnapshotMetadata(payload []byte) (stateSyncSnapshotMetadata, error) {
	var metadata stateSyncSnapshotMetadata
	if err := decodeStrictJSON(payload, &metadata); err != nil {
		return stateSyncSnapshotMetadata{}, err
	}
	return metadata, nil
}

func decodeStrictJSON(payload []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}

func cloneABCSnapshot(snapshot *abcitypes.Snapshot) *abcitypes.Snapshot {
	if snapshot == nil {
		return nil
	}
	return &abcitypes.Snapshot{
		Height:   snapshot.Height,
		Format:   snapshot.Format,
		Chunks:   snapshot.Chunks,
		Hash:     append([]byte(nil), snapshot.Hash...),
		Metadata: append([]byte(nil), snapshot.Metadata...),
	}
}
