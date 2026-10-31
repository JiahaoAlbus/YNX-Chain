package transportlab

import (
	"bytes"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/types"
)

// Actual production encoder -> temporary transport codec -> original owned C.
// This neither validates a signed native wire nor measures any physical hop.
func TestLosslessHexProductionCanonicalEncoderRoundTripAndTxHash(t *testing.T) {
	codec, err := mempool.NewLosslessHexCodec(1<<20, mempool.LosslessHexLimits{})
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{consensus.PQTransferType, consensus.PQMigrationType, consensus.PQRevocationType, consensus.PQWholeType, consensus.PQEthereumValueType, consensus.PQInitialRegistrationType} {
		t.Run(kind, func(t *testing.T) {
			wire := []byte{0, 1, 2, 0xff, 0xab, 0xcd, 0x7f}
			original, err := consensus.EncodePQTransaction(kind, wire)
			if err != nil {
				t.Fatal(err)
			}
			before := bytes.Clone(original)
			originalID := types.Tx(original).Hash()
			frame, eligible, err := codec.Pack(original)
			if err != nil || !eligible {
				t.Fatal("actual encoder not eligible", eligible, err)
			}
			restored, err := codec.Restore(frame)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(restored, before) || !bytes.Equal(types.Tx(restored).Hash(), originalID) {
				t.Fatal("original C or Comet Tx hash changed")
			}
			envelope, restoredWire, err := consensus.DecodePQTransaction(restored)
			if err != nil || envelope.Type != kind || !bytes.Equal(restoredWire, wire) {
				t.Fatal("restored C no longer enters original decoder", err)
			}
			for i := range frame {
				frame[i] ^= 0xff
			}
			original[0] ^= 0xff
			if !bytes.Equal(restored, before) {
				t.Fatal("restored bytes alias original or packed allocation")
			}
		})
	}
}
