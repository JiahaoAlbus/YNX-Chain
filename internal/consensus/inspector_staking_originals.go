package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	dbm "github.com/cometbft/cometbft-db"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

const OperatorLegacyStakingOriginalsVersion = "YNX-LEGACY-STAKING-ORIGINALS/v1"

// OperatorLegacyStakingOriginals is public DATA from the stopped original
// stores, not independent finality, a new baseline or permission to stake.
// Originals and Coordinates use the complete owner's original successful fee
// order. Originals are the unchanged canonical transactions (JSON base64).
type OperatorLegacyStakingOriginals struct {
	Version     string                               `json:"version"`
	Owner       string                               `json:"owner"`
	Height      int64                                `json:"height,string"`
	AppHash     string                               `json:"appHash"`
	Originals   [][]byte                             `json:"originals"`
	Coordinates []OperatorLegacyStakingOriginalPoint `json:"coordinates"`
}

type OperatorLegacyStakingOriginalPoint struct {
	Height          int64     `json:"height,string"`
	Index           uint64    `json:"index,string"`
	TransactionHash string    `json:"transactionHash"`
	TransactionType string    `json:"transactionType"`
	BlockHash       string    `json:"blockHash"`
	RecordedAt      time.Time `json:"recordedAt"`
}

// The Inspector owns the already-held App/signing leases and state DB. This
// adds the existing blockstore's read-only lock until the Inspector returns.
// Like the original proof-source reader, it neither creates missing LOCK nor
// repairs LevelDB, and checks the original file identities before releasing it.
func openOperatorStakingBlockStore(dataDirectory string) (dbm.DB, func() error, error) {
	directory := filepath.Join(dataDirectory, "blockstore.db")
	before, err := inspectionDatabaseFiles(directory)
	if err != nil {
		return nil, nil, fmt.Errorf("original staking block store unavailable: %w", err)
	}
	database, err := dbm.NewGoLevelDBWithOpts("blockstore", dataDirectory, &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
	if err != nil {
		return nil, nil, fmt.Errorf("open original staking block store read-only: %w", err)
	}
	finish := func() error {
		after, err := inspectionDatabaseFiles(directory)
		if err != nil || !sameInspectionDatabase(before, after) {
			err = errors.Join(err, errors.New("original staking block store changed during inspection"))
		}
		return errors.Join(err, database.Close())
	}
	return database, finish, nil
}

// The caller has validated state and actual with the independent bootstrap and
// exact engine H/AppHash while excluding all original writers. Do not expose
// this internal function as a way to authenticate a caller-supplied checkpoint.
func collectOperatorLegacyStakingOriginals(state CommittedState, migration chain.ConsensusMigrationState, owner string, actual sm.State, stateDB, blocksDB dbm.DB) (out *OperatorLegacyStakingOriginals, err error) {
	// Normal BlockStore corrupt-record paths panic. Convert them to an explicit
	// failure, with no partial originals; do not use fatal store.Load anywhere.
	defer func() {
		if recover() != nil {
			out = nil
			err = errors.New("original staking block store is corrupt or unavailable")
		}
	}()
	if !IsNativeAddress(owner) || state.Height != actual.LastBlockHeight || state.AppHash != hex.EncodeToString(actual.AppHash) || actual.ChainID == "" {
		return nil, errors.New("staking originals require the exact authenticated owner and checkpoint")
	}
	fees := legacyStakingFees(state.FeeEvents, owner)
	if len(fees) == 0 {
		return nil, errors.New("owner has no original successful classic staking fees")
	}
	wanted := make(map[string]int, len(fees))
	byHeight := make(map[int64][]int)
	firstHeight := actual.LastBlockHeight
	for i, fee := range fees {
		if fee.BlockHeight < actual.InitialHeight || fee.BlockHeight > actual.LastBlockHeight || fee.RecordedAt.IsZero() {
			return nil, errors.New("staking fee is outside original Comet history")
		}
		if _, duplicate := wanted[fee.TxHash]; duplicate {
			return nil, errors.New("staking successful fee hash is duplicated")
		}
		wanted[fee.TxHash] = i
		byHeight[fee.BlockHeight] = append(byHeight[fee.BlockHeight], i)
		if fee.BlockHeight < firstHeight {
			firstHeight = fee.BlockHeight
		}
	}
	blocks := blockstore.NewBlockStore(blocksDB)
	if blocks.Base() <= 0 || blocks.Base() > firstHeight || blocks.Height() != actual.LastBlockHeight {
		return nil, errors.New("original staking blocks are pruned, missing or ahead of the committed checkpoint")
	}
	responseStore := sm.NewStore(stateDB, sm.StoreOptions{})
	originals := make([][]byte, len(fees))
	points := make([]OperatorLegacyStakingOriginalPoint, len(fees))
	expectedID := actual.LastBlockID
	expectedAppHash, expectedResultsHash := actual.AppHash, actual.LastResultsHash
	totalBytes := 0
	for height := actual.LastBlockHeight; height >= firstHeight; height-- {
		block := blocks.LoadBlock(height)
		if block == nil {
			return nil, fmt.Errorf("original staking block %d is missing or pruned", height)
		}
		if err := block.ValidateBasic(); err != nil {
			return nil, fmt.Errorf("invalid original staking block %d: %w", height, err)
		}
		parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
		if err != nil {
			return nil, err
		}
		id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
		if block.Height != height || block.ChainID != actual.ChainID || !id.Equals(expectedID) {
			return nil, errors.New("staking block data/identity differs from the actual engine's original block chain")
		}
		if len(byHeight[height]) != 0 {
			response, err := responseStore.LoadFinalizeBlockResponse(height)
			if err != nil {
				return nil, fmt.Errorf("original staking results at height %d unavailable: %w", height, err)
			}
			if response == nil {
				return nil, fmt.Errorf("original staking results at height %d are missing", height)
			}
			if len(response.TxResults) != len(block.Data.Txs) || !bytes.Equal(response.AppHash, expectedAppHash) {
				return nil, errors.New("original staking results count or application hash differs from committed history")
			}
			for _, result := range response.TxResults {
				if result == nil {
					return nil, errors.New("original staking result is missing")
				}
			}
			if !bytes.Equal(cmttypes.NewResults(response.TxResults).Hash(), expectedResultsHash) {
				return nil, errors.New("original staking result root differs from committed history")
			}
			for index, raw := range block.Data.Txs {
				position, found := wanted[ApplicationActionHash(raw)]
				if !found || response.TxResults[index].Code != 0 {
					continue
				}
				fee := fees[position]
				if originals[position] != nil || fee.BlockHeight != height || !fee.RecordedAt.Equal(block.Time) || !bytes.Equal(response.TxResults[index].Data, []byte(fee.TxHash)) {
					return nil, errors.New("staking original index, successful result, height or time differs from its committed fee")
				}
				if len(raw) > MaxPQContractTransactionBytes-totalBytes {
					return nil, errors.New("staking originals exceed the existing action transport bound")
				}
				totalBytes += len(raw)
				originals[position] = bytes.Clone(raw)
				points[position] = OperatorLegacyStakingOriginalPoint{Height: height, Index: uint64(index), TransactionHash: fee.TxHash, TransactionType: fee.TransactionType, BlockHash: hex.EncodeToString(id.Hash), RecordedAt: block.Time.UTC()}
			}
			for _, position := range byHeight[height] {
				if originals[position] == nil {
					return nil, errors.New("successful staking fee has no exact original successful block transaction")
				}
			}
		}
		expectedID, expectedAppHash, expectedResultsHash = block.LastBlockID, block.AppHash, block.LastResultsHash
	}
	// Reuse the original signed-wire/historical policy/fee/nonce and complete
	// owner business replay. A block inclusion alone cannot supply these facts.
	if err := ValidateLegacyStakingOriginals(state, migration, owner, originals); err != nil {
		return nil, fmt.Errorf("original staking witness does not reproduce the committed owner records: %w", err)
	}
	return &OperatorLegacyStakingOriginals{Version: OperatorLegacyStakingOriginalsVersion, Owner: owner, Height: state.Height, AppHash: state.AppHash, Originals: originals, Coordinates: points}, nil
}
