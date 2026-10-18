package consensus

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

const (
	PQWalletIdentityPath     = "/pq-wallet/identity"
	PQWalletIdentityVersion  = "ynx-pq-wallet-identity-v1"
	MaxPQWalletIdentityBytes = 16 << 10
)

// PQWalletIdentityView is one latest committed application observation plus
// the original independently pinned bootstrap configuration. It neither
// publishes a block hash nor authenticates that configuration to a remote
// client. CometGenesisSHA256 hashes exact raw genesis bytes, not RPC JSON
// reserialization; NativeGenesisHash is the distinct original native genesis.
// No chain-wide epoch exists. Validator key epochs belong to the registry.
type PQWalletIdentityView struct {
	Version             string `json:"version"`
	Source              string `json:"source"`
	RecordsView         string `json:"recordsView"`
	HashAlgorithm       string `json:"hashAlgorithm"`
	NativeChainID       int64  `json:"nativeChainId,string"`
	NativeGenesisHash   string `json:"nativeGenesisHash"`
	CometChainID        string `json:"cometChainId"`
	CometGenesisSHA256  string `json:"cometGenesisSHA256"`
	MigrationStateHash  string `json:"migrationStateHash"`
	MigrationHeight     uint64 `json:"migrationHeight,string"`
	InitialHeight       int64  `json:"initialHeight,string"`
	CurrentStateHeight  int64  `json:"currentStateHeight,string"`
	CurrentStateAppHash string `json:"currentStateAppHash"`
}

func ValidatePQWalletIdentityView(v PQWalletIdentityView, queryHeight int64) error {
	if v.Version != PQWalletIdentityVersion || v.Source != "configured-abci-bootstrap" || v.RecordsView != "committed" || v.HashAlgorithm != "sha256" || v.NativeChainID <= 0 || v.CometChainID != fmt.Sprintf("ynx_%d-1", v.NativeChainID) || v.MigrationHeight >= math.MaxInt64 || v.InitialHeight != int64(v.MigrationHeight)+1 || v.CurrentStateHeight != queryHeight || queryHeight <= 0 || queryHeight < int64(v.MigrationHeight) || queryHeight == math.MaxInt64 {
		return errors.New("invalid pinned identity source, network or current state height")
	}
	for _, hash := range []string{v.NativeGenesisHash, v.CometGenesisSHA256, v.MigrationStateHash, v.CurrentStateAppHash} {
		if _, err := canonicalBootstrapHash(hash); err != nil {
			return err
		}
	}
	return nil
}

// queryPQIdentity is called under Application.Query's existing RLock. The
// private bootstrap parameter is installed by normal operator construction,
// never accepted from a query, peer, pending transaction or saved self-pin.
func queryPQIdentity(response *abci.ResponseQuery, req *abci.RequestQuery, s CommittedState, m chain.ConsensusMigrationState, b *ConsensusBootstrap) bool {
	if req.Path != PQWalletIdentityPath {
		return false
	}
	fail := func(err error) { response.Code, response.Log, response.Value = 1, err.Error(), nil }
	if req.Prove || len(req.Data) != 0 || req.Height < 0 || req.Height != 0 && req.Height != s.Height {
		fail(errors.New("identity query supports only exact current state without proof/data"))
		return true
	}
	if b == nil {
		fail(errors.New("independent consensus bootstrap identity is unavailable"))
		return true
	}
	if !s.Initialized || s.Height <= 0 {
		fail(errors.New("initialized nonzero committed identity checkpoint is unavailable"))
		return true
	}
	if b.record.OriginalGenesisHash != m.OriginalGenesisHash || b.record.MigrationStateHash != m.StateHash || s.MigrationStateHash != m.StateHash || s.ChainID != m.Network.ChainID {
		fail(errors.New("identity differs from original configured migration"))
		return true
	}
	v := PQWalletIdentityView{Version: PQWalletIdentityVersion, Source: "configured-abci-bootstrap", RecordsView: "committed", HashAlgorithm: "sha256", NativeChainID: s.ChainID, NativeGenesisHash: m.OriginalGenesisHash, CometChainID: b.record.ChainID, CometGenesisSHA256: b.record.CometGenesisSHA256, MigrationStateHash: m.StateHash, MigrationHeight: m.Height, InitialHeight: b.record.InitialHeight, CurrentStateHeight: s.Height, CurrentStateAppHash: s.AppHash}
	if err := ValidatePQWalletIdentityView(v, response.Height); err != nil {
		fail(err)
		return true
	}
	raw, err := json.Marshal(v)
	if err != nil || len(raw) > MaxPQWalletIdentityBytes {
		fail(errors.New("identity response exceeds its complete bound"))
		return true
	}
	response.Value = raw
	return true
}
