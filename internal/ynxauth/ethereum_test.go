package ynxauth

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func ethereumIntentFixture(kind uint32) EthereumValueIntent {
	network := make([]byte, 32)
	for i := range network {
		network[i] = byte(i)
	}
	v := EthereumValueIntent{
		Profile: EthereumABCIIntegerGasProfile, ChainID: network, NativeChainID: 1<<53 + 1,
		Owner: qaFrom, TxType: kind, To: qaTo, Value: 1<<53 + 3, Nonce: math.MaxUint64,
		GasLimit: 21_000, GasPrice: 3,
	}
	if kind == 2 {
		v.GasPrice, v.MaxPriorityFeePerGas, v.MaxFeePerGas = 0, 1<<34+3, 1<<34+9
	}
	return v
}

func ethereumIntentRejected(t testing.TB, err error) {
	t.Helper()
	if !errors.Is(err, ErrEthereumValueIntent) {
		t.Fatalf("expected ErrEthereumValueIntent, got %v", err)
	}
}

func TestEthereumValueIntentWireAndUint64Roundtrip(t *testing.T) {
	for _, kind := range []uint32{0, 1, 2} {
		for _, nonce := range []uint64{0, 1<<53 + 3, math.MaxUint64} {
			t.Run(fmt.Sprintf("type%d/nonce%d", kind, nonce), func(t *testing.T) {
				original := ethereumIntentFixture(kind)
				original.Nonce = nonce
				wire, err := original.SigningBytes()
				authOK(t, err)
				if len(wire) != 316 || len(wire) != MaxEthereumValueIntentBytes {
					t.Fatalf("fixed profile wire size differs: %d", len(wire))
				}
				decoded, err := DecodeEthereumValueIntent(wire)
				authOK(t, err)
				if !reflect.DeepEqual(original, decoded) {
					t.Fatal("roundtrip changed or omitted an execution field")
				}
				fields := authFields(t, wire, 23)
				if string(fields[2]) != "ABCI-INTEGER-GAS/v1" || len(fields[21]) != 0 || len(fields[22]) != 0 {
					t.Fatal("profile or independent empty data/access-list fields differ")
				}
				for _, index := range []int{1, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20} {
					if len(fields[index]) != 4 {
						t.Fatalf("field %d is not one U32", index)
					}
				}
				clear(wire)
				if !reflect.DeepEqual(original, decoded) {
					t.Fatal("decoded intent aliases caller wire")
				}
			})
		}
	}
	// Independent public syntax vector assembled as literal field hex using
	// U32(count) || U32(byteLength(field)) || field, without the Go codec.
	const expectedHex = "0000001700000015594e582d455448455245554d2d56414c55452f7631000000040000000100000013414243492d494e54454745522d4741532f763100000020000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f000000040020000000000004000000010000002a30783132333435363738393061626364656631323334353637383930616263646566313233343536373800000004000000000000002a3078616263646566313233343536373839306162636465663132333435363738393061626364656631320000000400200000000000040000000300000004ffffffff00000004ffffffff000000040000000000000004000052080000000400000000000000040000000300000004000000000000000400000000000000040000000000000004000000000000000000000000"
	original := ethereumIntentFixture(0)
	wire, err := original.SigningBytes()
	authOK(t, err)
	if hex.EncodeToString(wire) != expectedHex {
		t.Fatal("complete message differs from independent fixed field vector")
	}
	original.ChainID[0] ^= 1
	if hex.EncodeToString(wire) != expectedHex {
		t.Fatal("signing bytes alias the input network")
	}
	// Zero-length representations have one wire spelling, with no RLP marker.
	original.Data, original.AccessList = []byte{}, []byte{}
	_, err = original.SigningBytes()
	authOK(t, err)
}

func TestEthereumValueIntentRejectsUnsupportedAndOverflow(t *testing.T) {
	for name, change := range map[string]func(*EthereumValueIntent){
		"empty profile":       func(v *EthereumValueIntent) { v.Profile = "" },
		"wei profile":         func(v *EthereumValueIntent) { v.Profile = "DEVNET-WEI-FIXED1/v1" },
		"network short":       func(v *EthereumValueIntent) { v.ChainID = v.ChainID[:31] },
		"network long":        func(v *EthereumValueIntent) { v.ChainID = append(v.ChainID, 0) },
		"chain zero":          func(v *EthereumValueIntent) { v.NativeChainID = 0 },
		"chain overflow":      func(v *EthereumValueIntent) { v.NativeChainID = math.MaxUint64 },
		"type0 chain range":   func(v *EthereumValueIntent) { v.NativeChainID = (math.MaxUint64-36)/2 + 1 },
		"owner uppercase":     func(v *EthereumValueIntent) { v.Owner = strings.ToUpper(v.Owner) },
		"owner whitespace":    func(v *EthereumValueIntent) { v.Owner = " " + v.Owner },
		"recipient alias":     func(v *EthereumValueIntent) { v.To = "ynx1not-a-canonical-address" },
		"same owner and to":   func(v *EthereumValueIntent) { v.To = v.Owner },
		"unknown type":        func(v *EthereumValueIntent) { v.TxType = 3 },
		"large type":          func(v *EthereumValueIntent) { v.TxType = math.MaxUint32 },
		"zero value":          func(v *EthereumValueIntent) { v.Value = 0 },
		"value overflow":      func(v *EthereumValueIntent) { v.Value = uint64(math.MaxInt64) + 1 },
		"combined overflow":   func(v *EthereumValueIntent) { v.Value = math.MaxInt64 },
		"zero gas":            func(v *EthereumValueIntent) { v.GasLimit = 0 },
		"different gas":       func(v *EthereumValueIntent) { v.GasLimit++ },
		"large gas":           func(v *EthereumValueIntent) { v.GasLimit = math.MaxUint64 },
		"zero gas price":      func(v *EthereumValueIntent) { v.GasPrice = 0 },
		"fee multiply limit":  func(v *EthereumValueIntent) { v.GasPrice = uint64(math.MaxInt64)/21_000 + 1 },
		"fee unsigned wrap":   func(v *EthereumValueIntent) { v.GasPrice = math.MaxUint64 },
		"legacy priority":     func(v *EthereumValueIntent) { v.MaxPriorityFeePerGas = 1 },
		"legacy max price":    func(v *EthereumValueIntent) { v.MaxFeePerGas = 1 },
		"calldata":            func(v *EthereumValueIntent) { v.Data = []byte{1} },
		"access list":         func(v *EthereumValueIntent) { v.AccessList = []byte{1} },
		"RLP empty list":      func(v *EthereumValueIntent) { v.AccessList = []byte{0xc0} },
		"nested E empty list": func(v *EthereumValueIntent) { v.AccessList = ynxbatch.U32(0) },
	} {
		t.Run(name, func(t *testing.T) {
			v := ethereumIntentFixture(0)
			change(&v)
			ethereumIntentRejected(t, v.Validate())
			wire, err := v.SigningBytes()
			ethereumIntentRejected(t, err)
			if wire != nil {
				t.Fatal("invalid intent returned usable signing bytes")
			}
		})
	}
	for name, change := range map[string]func(*EthereumValueIntent){
		"redundant gas price": func(v *EthereumValueIntent) { v.GasPrice = v.MaxPriorityFeePerGas },
		"zero priority":       func(v *EthereumValueIntent) { v.MaxPriorityFeePerGas = 0 },
		"zero cap":            func(v *EthereumValueIntent) { v.MaxFeePerGas = 0 },
		"priority above cap":  func(v *EthereumValueIntent) { v.MaxPriorityFeePerGas = v.MaxFeePerGas + 1 },
		"exposure overflow":   func(v *EthereumValueIntent) { v.MaxFeePerGas = uint64(math.MaxInt64)/21_000 + 1 },
		"combined exposure":   func(v *EthereumValueIntent) { v.Value = uint64(math.MaxInt64) - v.MaxPriorityFeePerGas*v.GasLimit },
	} {
		t.Run("type2/"+name, func(t *testing.T) {
			v := ethereumIntentFixture(2)
			change(&v)
			ethereumIntentRejected(t, v.Validate())
		})
	}
	// Exact signed-ledger sum boundary is accepted, the next integer is not.
	for _, kind := range []uint32{0, 1, 2} {
		v := ethereumIntentFixture(kind)
		price := v.GasPrice
		if kind == 2 {
			price = v.MaxFeePerGas
		}
		v.Value = uint64(math.MaxInt64) - price*v.GasLimit
		authOK(t, v.Validate())
		v.Value++
		ethereumIntentRejected(t, v.Validate())
	}
	// Typed envelopes retain their original positive int64 chain-ID range.
	for _, kind := range []uint32{1, 2} {
		v := ethereumIntentFixture(kind)
		v.NativeChainID = math.MaxInt64
		authOK(t, v.Validate())
	}
}

func TestEthereumValueIntentRejectsNoncanonicalWire(t *testing.T) {
	wire, err := ethereumIntentFixture(0).SigningBytes()
	authOK(t, err)
	for name, change := range map[string]func([][]byte){
		"domain":          func(f [][]byte) { f[0] = []byte(TransferDomain) },
		"version":         func(f [][]byte) { f[1] = ynxbatch.U32(2) },
		"profile":         func(f [][]byte) { f[2][0] ^= 1 },
		"network":         func(f [][]byte) { f[3] = f[3][:31] },
		"native chain":    func(f [][]byte) { f[4], f[5] = ynxbatch.U32(0), ynxbatch.U32(0) },
		"owner":           func(f [][]byte) { f[6] = []byte(strings.ToUpper(qaFrom)) },
		"type":            func(f [][]byte) { f[7] = ynxbatch.U32(3) },
		"self transfer":   func(f [][]byte) { f[8] = bytes.Clone(f[6]) },
		"value sign bit":  func(f [][]byte) { f[9] = ynxbatch.U32(1 << 31) },
		"data":            func(f [][]byte) { f[21] = []byte{0} },
		"access list":     func(f [][]byte) { f[22] = []byte{0xc0} },
		"type2 old price": func(f [][]byte) { f[7] = ynxbatch.U32(2) },
	} {
		t.Run(name, func(t *testing.T) {
			fields := authFields(t, wire, 23)
			change(fields)
			_, err := DecodeEthereumValueIntent(authFrame(t, fields))
			ethereumIntentRejected(t, err)
		})
	}
	for _, index := range []int{1, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20} {
		for _, length := range []int{0, 1, 3, 5, 8} {
			fields := authFields(t, wire, 23)
			fields[index] = make([]byte, length)
			_, err := DecodeEthereumValueIntent(authFrame(t, fields))
			ethereumIntentRejected(t, err)
		}
	}
	for _, count := range []int{22, 24} {
		fields := authFields(t, wire, 23)
		fields = append(fields, nil)
		_, err := DecodeEthereumValueIntent(authFrame(t, fields[:count]))
		ethereumIntentRejected(t, err)
	}
	for end := 0; end < len(wire); end++ {
		_, err := DecodeEthereumValueIntent(wire[:end])
		ethereumIntentRejected(t, err)
	}
	for _, malformed := range [][]byte{append(bytes.Clone(wire), 0), make([]byte, MaxEthereumValueIntentBytes+1), {0xff, 0xff, 0xff, 0xff}} {
		_, err := DecodeEthereumValueIntent(malformed)
		ethereumIntentRejected(t, err)
	}
	lengthOverflow := bytes.Clone(wire)
	copy(lengthOverflow[4:8], []byte{0xff, 0xff, 0xff, 0xff})
	_, err = DecodeEthereumValueIntent(lengthOverflow)
	ethereumIntentRejected(t, err)
}

func TestEthereumValueIntentBindsEveryVariableExecutionField(t *testing.T) {
	for _, kind := range []uint32{0, 1, 2} {
		original := ethereumIntentFixture(kind)
		wire, err := original.SigningBytes()
		authOK(t, err)
		changes := map[string]func(*EthereumValueIntent){
			"network": func(v *EthereumValueIntent) { v.ChainID[0] ^= 1 },
			"chain":   func(v *EthereumValueIntent) { v.NativeChainID += 1 << 32 },
			"owner":   func(v *EthereumValueIntent) { v.Owner = "0x3333333333333333333333333333333333333333" },
			"to":      func(v *EthereumValueIntent) { v.To = "0x4444444444444444444444444444444444444444" },
			"value":   func(v *EthereumValueIntent) { v.Value += 1 << 32 },
			"nonce":   func(v *EthereumValueIntent) { v.Nonce -= 1 << 32 },
		}
		if kind == 2 {
			changes["priority"] = func(v *EthereumValueIntent) { v.MaxPriorityFeePerGas++ }
			changes["max fee"] = func(v *EthereumValueIntent) { v.MaxFeePerGas += 1 << 32 }
		} else {
			changes["gas price"] = func(v *EthereumValueIntent) { v.GasPrice += 1 << 32 }
			changes["type"] = func(v *EthereumValueIntent) { v.TxType = 1 - v.TxType }
		}
		for name, change := range changes {
			t.Run(fmt.Sprintf("type%d/%s", kind, name), func(t *testing.T) {
				changed := original
				changed.ChainID = bytes.Clone(original.ChainID)
				change(&changed)
				other, err := changed.SigningBytes()
				authOK(t, err)
				if bytes.Equal(other, wire) {
					t.Fatal("signing message omitted an execution field")
				}
			})
		}
	}
}

func TestEthereumValueIntentActualDualProofAndPolicy(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	for _, kind := range []uint32{0, 1, 2} {
		intent := ethereumIntentFixture(kind)
		intent.ChainID, intent.Owner = bytes.Clone(state.NetworkID), f.owner
		message, err := intent.SigningBytes()
		authOK(t, err)
		_, wire := authProof(t, f.first, state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
		authOK(t, state.VerifyMember(f.owner, TransactionPurpose, message, wire, 20))
		authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, wire, 19))
		authReject(t, state.VerifyMember(qaFrom, TransactionPurpose, message, wire, 20))
		authReject(t, state.VerifyMember(f.owner, MigrationPurpose, message, wire, 20))
		for _, branch := range []string{"A", "B"} {
			member, err := ynxbatch.DecodeMember(wire)
			authOK(t, err)
			if branch == "A" {
				member.Certificate.SigmaA[0] ^= 1
			} else {
				member.Certificate.SigmaB[0] ^= 1
			}
			bad, err := ynxbatch.EncodeMember(member)
			authOK(t, err)
			authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, bad, 20))
		}
		intent.Value++
		changed, err := intent.SigningBytes()
		authOK(t, err)
		member, err := ynxbatch.DecodeMember(wire)
		authOK(t, err)
		member.Message = changed
		bad, err := ynxbatch.EncodeMember(member)
		authOK(t, err)
		authReject(t, state.VerifyMember(f.owner, TransactionPurpose, changed, bad, 20))
	}
}
