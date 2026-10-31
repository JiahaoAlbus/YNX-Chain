package chain

import (
	"bytes"
	"encoding/hex"
	"math"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func TestNativeTransferMetadataBindsOriginalGenesisAndColdRecovery(t *testing.T) {
	dir := t.TempDir()
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	v, err := d.NativeTransferMetadata()
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateNativeTransferMetadata(v, d.cfg.ChainID, d.blocks[0].Hash); err != nil {
		t.Fatal(err)
	}
	if v.Genesis != v.NetworkID32 || v.UnitVersion != "1" || v.AtomsPerLedgerUnit != "1" || v.MaxAmountPlusFeeAtoms != strconv.FormatInt(math.MaxInt64, 10) {
		t.Fatal("metadata changed original integer ledger meaning", v)
	}
	d.ProduceBlock()
	reopened, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	got, err := reopened.NativeTransferMetadata()
	if err != nil || got != v {
		t.Fatal("immutable unit/genesis changed across restart", got, err)
	}
	for _, mutate := range []func(*NativeTransferMetadata){
		func(x *NativeTransferMetadata) { x.Genesis = strings.Repeat("a", 64) },
		func(x *NativeTransferMetadata) { x.NetworkID32 = strings.Repeat("b", 64) },
		func(x *NativeTransferMetadata) { x.NativeChainID++ },
		func(x *NativeTransferMetadata) { x.UnitVersion = "2" },
		func(x *NativeTransferMetadata) { x.AtomsPerLedgerUnit = "1000000000000000000" },
		func(x *NativeTransferMetadata) { x.AssetID = "other" },
		func(x *NativeTransferMetadata) { x.TransferDomain = "other" },
		func(x *NativeTransferMetadata) { x.AmountWireEncoding = "u64be" },
	} {
		changed := v
		mutate(&changed)
		if ValidateNativeTransferMetadata(changed, v.NativeChainID, v.Genesis) == nil {
			t.Fatal("untrusted metadata substitution accepted", changed)
		}
	}
	for _, invalid := range []string{"", strings.Repeat("0", 64), strings.Repeat("A", 64), "0x" + v.Genesis} {
		if _, err := NewNativeTransferMetadata(v.NativeChainID, invalid); err == nil {
			t.Fatal("invalid genesis accepted", invalid)
		}
	}
}

func TestNativeTransferMetadataAtomsPreserveExistingWireAndBounds(t *testing.T) {
	network := bytes.Repeat([]byte{0x42}, 32)
	for _, text := range []string{"0", "1", "100", "9007199254740993", "9223372036854775807"} {
		n, err := ParseNativeTransferAtoms("1", text)
		if err != nil || strconv.FormatUint(n, 10) != text {
			t.Fatal("integer atoms changed", text, n, err)
		}
		if n == 0 {
			continue
		}
		input := ynxauth.Transfer{ChainID: network, NativeChainID: 6423, From: "0x" + strings.Repeat("1", 40), To: "0x" + strings.Repeat("2", 40), Amount: n, Fee: 0, Nonce: 7}
		wire, err := input.SigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := ynxauth.DecodeTransfer(wire)
		if err != nil || decoded.Amount != n || decoded.Fee != 0 || !bytes.Equal(decoded.ChainID, network) {
			t.Fatal("versioned metadata rescaled original wire", text, err)
		}
		if n == math.MaxInt64 {
			input.Fee = 1
			if _, err := input.SigningBytes(); err == nil {
				t.Fatal("amount plus fee overflow accepted")
			}
		}
	}
	for _, text := range []string{"", "01", "+1", "-1", "1.0", "0.1", "1e3", " 1", "1 ", "9223372036854775808", "18446744073709551615"} {
		if _, err := ParseNativeTransferAtoms("1", text); err == nil {
			t.Fatal("noncanonical/fraction/overflow accepted", text)
		}
	}
	if _, err := ParseNativeTransferAtoms("2", "1"); err == nil {
		t.Fatal("unknown unit version accepted")
	}
	v, err := NewNativeTransferMetadata(6423, hex.EncodeToString(network))
	if err != nil || v.TransferDomain != ynxauth.TransferDomain {
		t.Fatal("descriptor not bound to original codec", err)
	}
}
