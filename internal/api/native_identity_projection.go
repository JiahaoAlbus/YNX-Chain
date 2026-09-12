package api

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const nativeIdentityProjectionVersion = "ynx-native-identity-projection-v1"

// nativeEVMIdentity preserves real account payloads. Native system identifiers
// have no Ethereum signing key; their stable domain-separated digest is a
// display-only address, never an account alias accepted by the ledger.
func nativeEVMIdentity(identity string) string {
	if address, err := accountaddress.Normalize(identity); err == nil {
		return address
	}
	digest := sha256.Sum256([]byte("YNX_NATIVE_IDENTITY_PROJECTION_V1\x00" + identity))
	return "0x" + hex.EncodeToString(digest[12:])
}

func nativeEVMRecipient(identity string) any {
	if identity == "" {
		return nil
	}
	return nativeEVMIdentity(identity)
}

func nativeTransactionProjection(tx chain.Transaction) map[string]any {
	return map[string]any{"type": tx.Type, "amountYNXT": strconv.FormatInt(tx.Amount, 10), "feeYNXT": strconv.FormatInt(tx.Fee, 10), "nonce": hexQuantity(tx.Nonce)}
}

func nativeIdentityProjection(tx chain.Transaction) map[string]any {
	_, fromErr := accountaddress.Normalize(tx.From)
	_, toErr := accountaddress.Normalize(tx.To)
	return map[string]any{
		"from": tx.From, "to": tx.To,
		"identityProjection": map[string]any{
			"version":             nativeIdentityProjectionVersion,
			"systemAddressScheme": "last-20-bytes-sha256-nul-domain-exact-native-identity",
			"systemAddressDomain": "YNX_NATIVE_IDENTITY_PROJECTION_V1",
			"fromSystemIdentity":  fromErr != nil, "toSystemIdentity": tx.To != "" && toErr != nil,
			"systemAddressesAreDisplayOnly": true,
		},
	}
}
