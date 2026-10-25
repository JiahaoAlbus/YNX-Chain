package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

const PQWalletConsensusGenesisPath = "/pq-wallet/consensus-genesis"

// Called under Application.Query's RLock. These are the exact constructor's
// independently pinned original bytes, not Comet /genesis reserialization.
// Returning them is a current application observation, never a remote grant.
func queryPQConsensusGenesis(response *abci.ResponseQuery, req *abci.RequestQuery, state CommittedState, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap) bool {
	if req.Path != PQWalletConsensusGenesisPath {
		return false
	}
	// Reuse the original current/initialized/bootstrap/migration checks without
	// revalidating or reencoding the full original migration on each read.
	identityRequest := *req
	identityRequest.Path = PQWalletIdentityPath
	identityResponse := &abci.ResponseQuery{Height: response.Height}
	queryPQIdentity(identityResponse, &identityRequest, state, migration, bootstrap)
	if identityResponse.Code != 0 {
		response.Code, response.Log, response.Value = identityResponse.Code, identityResponse.Log, nil
		return true
	}
	if len(bootstrap.rawGenesis) == 0 || len(bootstrap.rawGenesis) > MaxCometGenesisBytes {
		response.Code, response.Log, response.Value = 1, "original complete bounded consensus Genesis is unavailable", nil
		return true
	}
	digest := sha256.Sum256(bootstrap.rawGenesis)
	if hex.EncodeToString(digest[:]) != bootstrap.record.CometGenesisSHA256 || !bytes.Equal(digest[:], bootstrap.genesisID) {
		response.Code, response.Log, response.Value = 1, "original consensus Genesis differs from independent bootstrap pin", nil
		return true
	}
	response.Value = bytes.Clone(bootstrap.rawGenesis)
	return true
}
