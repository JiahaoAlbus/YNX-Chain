package consensus

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

const (
	MigrationHistoryVersion         = "ynx-migration-history-v1"
	MigrationHistoryBlockPath       = "/migration/source-history/blocks/"
	MigrationHistoryTransactionPath = "/migration/source-history/transactions/"
	// A bounded read response, not a change to native or Comet consensus caps.
	MaxMigrationHistoryQueryBytes = 32 << 20
)

// MigrationHistoryAnchor identifies the immutable original import. It is not
// Comet inclusion, a current account authorization or independent finality.
type MigrationHistoryAnchor struct {
	Version             string `json:"version"`
	Source              string `json:"source"`
	SourceAnchor        string `json:"sourceAnchor"`
	OriginalGenesisHash string `json:"originalGenesisHash"`
	MigrationBlockHash  string `json:"migrationBlockHash"`
	NativeChainID       int64  `json:"nativeChainId,string"`
	MigrationHeight     uint64 `json:"migrationHeight,string"`
}

type MigrationHistoryBlockView struct {
	MigrationHistoryAnchor
	Found bool         `json:"found"`
	Block *chain.Block `json:"block,omitempty"`
}

type MigrationHistoryTransactionView struct {
	MigrationHistoryAnchor
	Found       bool               `json:"found"`
	Transaction *chain.Transaction `json:"transaction,omitempty"`
}

// Called under Application.Query's read lock. The constructor has already
// validated and deeply copied migration.Runtime, including its original block
// hashes and historical account policy. Never replay or relabel those records.
func queryMigrationHistory(response *abci.ResponseQuery, req *abci.RequestQuery, state CommittedState, migration chain.ConsensusMigrationState) bool {
	blockQuery := strings.HasPrefix(req.Path, MigrationHistoryBlockPath)
	if !blockQuery && !strings.HasPrefix(req.Path, MigrationHistoryTransactionPath) {
		return false
	}
	fail := func(err error) { response.Code, response.Log, response.Value = 1, err.Error(), nil }
	if req.Prove || len(req.Data) != 0 || req.Height < 0 || req.Height != 0 && req.Height != state.Height {
		fail(errors.New("source history supports only exact current state without proof/data"))
		return true
	}
	if migration.Runtime == nil || migration.Height == 0 || migration.Height >= math.MaxInt64 || state.Height < 0 || uint64(state.Height) < migration.Height || response.Height != state.Height || state.ChainID != migration.Network.ChainID || state.MigrationStateHash != migration.StateHash {
		fail(errors.New("source history differs from original configured migration"))
		return true
	}
	anchor := MigrationHistoryAnchor{Version: MigrationHistoryVersion, Source: "source_import", SourceAnchor: migration.StateHash, OriginalGenesisHash: migration.OriginalGenesisHash, MigrationBlockHash: migration.LastBlockHash, NativeChainID: migration.Network.ChainID, MigrationHeight: migration.Height}
	var view any
	if blockQuery {
		raw := strings.TrimPrefix(req.Path, MigrationHistoryBlockPath)
		height, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || strconv.FormatUint(height, 10) != raw {
			fail(errors.New("canonical unsigned source block height required"))
			return true
		}
		value := MigrationHistoryBlockView{MigrationHistoryAnchor: anchor}
		if height <= migration.Height {
			// Migration validation fixes Blocks[i].Height == i, including
			// genesis. Avoid scanning the complete old chain on every read.
			if height >= uint64(len(migration.Runtime.Blocks)) || migration.Runtime.Blocks[height].Height != height {
				fail(errors.New("source block sequence differs from validated original history"))
				return true
			}
			block := migration.Runtime.Blocks[height]
			value.Found, value.Block = true, &block
		}
		view = value
	} else {
		hash := strings.TrimPrefix(req.Path, MigrationHistoryTransactionPath)
		raw := strings.TrimPrefix(hash, "0x")
		decoded, err := hex.DecodeString(raw)
		if err != nil || len(decoded) != 32 || hex.EncodeToString(decoded) != raw {
			fail(errors.New("canonical lowercase original source transaction hash required"))
			return true
		}
		value := MigrationHistoryTransactionView{MigrationHistoryAnchor: anchor}
		if tx, found := sourceHistoryTransaction(migration, hash); found {
			value.Found, value.Transaction = true, &tx
		}
		view = value
	}
	payload, err := json.Marshal(view)
	if err != nil || len(payload) > MaxMigrationHistoryQueryBytes {
		fail(errors.New("source history cannot encode a complete bounded response"))
		return true
	}
	response.Value = payload
	return true
}
