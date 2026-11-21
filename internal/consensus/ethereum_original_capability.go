package consensus

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

const EthereumOriginalCapabilityPath = "/evm/original-native-adapter-capability/v1"
const EthereumOriginalObservationVersion = "ynx-bft-original-native-observation-v1"

// This is a single configured-ABCI observation, not an independent header
// proof, signing permission or a claim about a particular account's policy.
type EthereumOriginalObservation struct {
	Version                      string `json:"version"`
	Source                       string `json:"source"`
	NativeChainID                int64  `json:"nativeChainId,string"`
	NativeGenesisHash            string `json:"nativeGenesisHash"`
	CometChainID                 string `json:"cometChainId"`
	CometGenesisSHA256           string `json:"cometGenesisSHA256"`
	MigrationStateHash           string `json:"migrationStateHash"`
	CommittedHeight              int64  `json:"committedHeight,string"`
	CommittedAppHash             string `json:"committedAppHash"`
	PolicyEnableAt               uint64 `json:"policyEnableAt,string"`
	AccountAuthorizationRequired bool   `json:"accountAuthorizationRequired"`
	IndependentFinality          bool   `json:"independentFinality"`
}

func ValidateEthereumOriginalObservation(v EthereumOriginalObservation, queryHeight int64) error {
	if v.Version != EthereumOriginalObservationVersion || v.Source != "configured-abci-bootstrap" || v.NativeChainID <= 0 || v.CometChainID != fmt.Sprintf("ynx_%d-1", v.NativeChainID) || v.CommittedHeight != queryHeight || queryHeight <= 0 || queryHeight == math.MaxInt64 || v.PolicyEnableAt == 0 || !v.AccountAuthorizationRequired || v.IndependentFinality {
		return errors.New("original Ethereum capability observation identity is invalid")
	}
	for _, hash := range []string{v.NativeGenesisHash, v.CometGenesisSHA256, v.MigrationStateHash, v.CommittedAppHash} {
		if _, err := canonicalBootstrapHash(hash); err != nil {
			return err
		}
	}
	return nil
}

func queryEthereumOriginalCapability(response *abci.ResponseQuery, req *abci.RequestQuery, state CommittedState, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap) bool {
	if req.Path != EthereumOriginalCapabilityPath {
		return false
	}
	fail := func(err error) { response.Code, response.Log, response.Value = 1, err.Error(), nil }
	if req.Prove || len(req.Data) != 0 || req.Height < 0 || req.Height != 0 && req.Height != state.Height {
		fail(errors.New("original Ethereum capability supports only exact current state without proof/data"))
		return true
	}
	identityResponse := &abci.ResponseQuery{Height: state.Height}
	queryPQIdentity(identityResponse, &abci.RequestQuery{Path: PQWalletIdentityPath}, state, migration, bootstrap)
	if identityResponse.Code != 0 || len(identityResponse.Value) == 0 || state.AccountPolicy == nil {
		fail(errors.New("original Ethereum capability requires complete bootstrap identity and account policy"))
		return true
	}
	var identity PQWalletIdentityView
	if json.Unmarshal(identityResponse.Value, &identity) != nil || ValidatePQWalletIdentityView(identity, state.Height) != nil {
		fail(errors.New("original Ethereum capability identity is invalid"))
		return true
	}
	network, err := hex.DecodeString(identity.NativeGenesisHash)
	if err != nil || state.AccountPolicy.Validate(network) != nil {
		fail(errors.New("original Ethereum capability account policy differs from native genesis"))
		return true
	}
	observation := EthereumOriginalObservation{Version: EthereumOriginalObservationVersion, Source: "configured-abci-bootstrap", NativeChainID: identity.NativeChainID, NativeGenesisHash: identity.NativeGenesisHash, CometChainID: identity.CometChainID, CometGenesisSHA256: identity.CometGenesisSHA256, MigrationStateHash: identity.MigrationStateHash, CommittedHeight: identity.CurrentStateHeight, CommittedAppHash: identity.CurrentStateAppHash, PolicyEnableAt: state.AccountPolicy.EnableAt, AccountAuthorizationRequired: true, IndependentFinality: false}
	if err := ValidateEthereumOriginalObservation(observation, response.Height); err != nil {
		fail(err)
		return true
	}
	encoded, err := json.Marshal(observation)
	if err != nil || len(encoded) > 4096 {
		fail(errors.New("original Ethereum capability observation exceeds bound"))
		return true
	}
	response.Value = encoded
	return true
}
