package consensus

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cometed25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmttypes "github.com/cometbft/cometbft/types"
)

func BuildCometGenesis(state chain.ConsensusMigrationState, genesisTime time.Time) (*cmttypes.GenesisDoc, error) {
	if err := state.ValidateConsensusValidatorKeys(); err != nil {
		return nil, fmt.Errorf("validate consensus validator key bindings: %w", err)
	}
	appState, err := state.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	appHash, err := hex.DecodeString(state.StateHash)
	if err != nil {
		return nil, fmt.Errorf("decode migration AppHash: %w", err)
	}
	validators := make([]cmttypes.GenesisValidator, 0, len(state.Validators))
	for _, validator := range state.Validators {
		if !validator.Active {
			continue
		}
		publicKeyBytes, err := base64.StdEncoding.DecodeString(validator.ConsensusPubKey)
		if err != nil {
			return nil, fmt.Errorf("decode validator %s public key: %w", validator.Address, err)
		}
		publicKey := cometed25519.PubKey(publicKeyBytes)
		consensusAddress, err := hex.DecodeString(validator.ConsensusAddress)
		if err != nil {
			return nil, fmt.Errorf("decode validator %s consensus address: %w", validator.Address, err)
		}
		validators = append(validators, cmttypes.GenesisValidator{
			Address: consensusAddress,
			PubKey:  publicKey,
			Power:   validator.VotingPower,
			Name:    validator.Address,
		})
	}
	params := cmttypes.DefaultConsensusParams()
	params.Version.App = ApplicationVersion
	genesis := &cmttypes.GenesisDoc{
		GenesisTime:     genesisTime.UTC(),
		ChainID:         fmt.Sprintf("ynx_%d-1", state.Network.ChainID),
		InitialHeight:   int64(state.Height) + 1,
		ConsensusParams: params,
		Validators:      validators,
		AppHash:         appHash,
		AppState:        json.RawMessage(appState),
	}
	if err := genesis.ValidateAndComplete(); err != nil {
		return nil, fmt.Errorf("validate CometBFT genesis: %w", err)
	}
	return genesis, nil
}
