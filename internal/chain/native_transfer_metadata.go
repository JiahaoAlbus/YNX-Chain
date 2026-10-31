package chain

import (
	"encoding/hex"
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

const (
	NativeTransferMetadataVersion = "ynx-native-transfer-metadata-v1"
	NativeTransferUnitVersion     = "1"
)

// This describes the EXISTING native integer ledger, not EVM display decimals.
// Unit version 1 names one original ledger integer as one atom. It introduces
// no scaling, new asset, fee rule, signed field, or historical state migration.
type NativeTransferMetadata struct {
	Version               string `json:"version"`
	NativeChainID         int64  `json:"nativeChainId,string"`
	Genesis               string `json:"genesis"`
	NetworkID32           string `json:"networkId32"`
	AssetID               string `json:"assetId"`
	UnitVersion           string `json:"unitVersion"`
	AtomsPerLedgerUnit    string `json:"atomsPerLedgerUnit"`
	MaxAmountPlusFeeAtoms string `json:"maxAmountPlusFeeAtoms"`
	TransferDomain        string `json:"transferDomain"`
	AmountWireEncoding    string `json:"amountWireEncoding"`
}

// Inputs must come from the normal ledger/bootstrap owner. Returning a valid
// descriptor never independently authenticates a remote RPC or its genesis.
func NewNativeTransferMetadata(chainID int64, genesis string) (NativeTransferMetadata, error) {
	b, err := hex.DecodeString(genesis)
	if chainID <= 0 || err != nil || len(b) != 32 || hex.EncodeToString(b) != genesis || genesis == strings.Repeat("0", 64) {
		return NativeTransferMetadata{}, errors.New("invalid original native chain identity")
	}
	return NativeTransferMetadata{
		Version: NativeTransferMetadataVersion, NativeChainID: chainID, Genesis: genesis, NetworkID32: genesis,
		AssetID: NativeDexAssetID, UnitVersion: NativeTransferUnitVersion, AtomsPerLedgerUnit: "1",
		MaxAmountPlusFeeAtoms: strconv.FormatInt(math.MaxInt64, 10), TransferDomain: ynxauth.TransferDomain,
		AmountWireEncoding: "two-framed-u32be-high-then-low",
	}, nil
}

// expectedChainID/genesis are independently admitted host inputs, never values
// copied out of the descriptor being checked. This is a value check, not trust.
func ValidateNativeTransferMetadata(v NativeTransferMetadata, expectedChainID int64, expectedGenesis string) error {
	expected, err := NewNativeTransferMetadata(expectedChainID, expectedGenesis)
	if err != nil || v != expected {
		return errors.New("native transfer metadata differs from the admitted chain or unit contract")
	}
	return nil
}

// ParseNativeTransferAtoms accepts exact decimal integer atoms, including zero
// for fees. Transfer.Validate still enforces positive amount, nonce and total.
// Fractions/exponents/leading zeros must never be rounded or rescaled here.
func ParseNativeTransferAtoms(unitVersion, value string) (uint64, error) {
	if unitVersion != NativeTransferUnitVersion || len(value) == 0 || len(value) > 19 {
		return 0, errors.New("unsupported native unit version or bounded integer")
	}
	n, err := strconv.ParseUint(value, 10, 63)
	if err != nil || strconv.FormatUint(n, 10) != value {
		return 0, errors.New("canonical native integer atoms required")
	}
	return n, nil
}

// NativeTransferMetadata uses the same original block-zero identity as account
// policy construction. No pending policy, caller-supplied chain or cache enters.
func (d *Devnet) NativeTransferMetadata() (NativeTransferMetadata, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if len(d.blocks) == 0 || d.blocks[0].Height != 0 {
		return NativeTransferMetadata{}, errors.New("original native genesis is unavailable")
	}
	return NewNativeTransferMetadata(d.cfg.ChainID, d.blocks[0].Hash)
}
