package ynxauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type actionVector struct {
	kind       string
	payload    any
	count      int
	numeric    []int
	wireLength int
	sha256     string
}

// Expected wire hashes were produced by the independent BigInt/Buffer encoder
// reproduced in NATIVE_PQ_ACTION_WIRE_R1.md. These are public syntax vectors;
// their resource hashes do not assert a real quote or business authorization.
func actionVectors() []actionVector {
	const big = uint64(9007199254740995)
	policy, request := strings.Repeat("ab", 32), strings.Repeat("cd", 32)
	return []actionVector{
		{ActionStake, StakePayload{big}, 2, []int{0, 1}, 199, "1ebf8a43af751d8a487f0db90887a572bde7a62596a4181ca72d63d147e29d99"},
		{ActionResourceDelegate, ResourceDelegationPayload{qaFrom, qaTo, big, policy, "delegate-key", request}, 7, []int{2, 3}, 464, "c6774dcac539acbc6293b6c0e33c7c3ccc84f7daaf2e2d48132851f62c119c38"},
		{ActionResourceRent, ResourceRentalPayload{qaFrom, "ynx_protocol_resource_pool", big, 2, 3, 4, "0123456789abcdef01234567", "2030-01-02T03:04:05.123456789Z", policy, 9007199254740997, "rental-key", request}, 17, []int{2, 3, 4, 5, 6, 7, 8, 9, 13, 14}, 568, "98b520353982b5df558f76ac30b2c74b310a07506f3e5348aec57e0e50362b7e"},
		{ActionDexAssetCreate, DexAssetCreatePayload{"asset-test", "TEST", "Test 资产", 18, math.MaxInt64, big}, 8, []int{3, 4, 5, 6, 7}, 271, "48967ee1cd2233fd2d78892f7f47bc7310fc6b57392513a72eb0a8762d5d0e46"},
		{ActionDexAssetMint, DexAssetAmountPayload{"asset-test", big}, 3, []int{1, 2}, 222, "0492725896cef63f2ebbf3f246b23a922a21029e5c973069f2e91d23ca1202c9"},
		{ActionDexAssetTransfer, DexAssetTransferPayload{"asset-test", qaTo, big}, 4, []int{2, 3}, 272, "c13fe6896c6e466e019b271b621ee3126717c9ef1e58c5e6248e3cf2ac5ed58f"},
		{ActionDexPoolCreate, DexPoolCreatePayload{"dex_test", "YNXT", "asset-test", 1000}, 4, []int{3}, 235, "33cc4e44cf28ce118f20f788fae056b7a5c1f3897f1b17bc03ddd8ab7c5020df"},
		{ActionDexLiquidityAdd, DexLiquidityPayload{"dex_test", big, 2, 3, 1893456000}, 9, []int{1, 2, 3, 4, 5, 6, 7, 8}, 271, "fdccb08fd6ea1879136633e96b209206cb6f82dc583dbbfea6e26e443f93201b"},
		{ActionDexLiquidityRemove, DexLiquidityRemovePayload{"dex_test", big, 2, 3, 1893456000}, 9, []int{1, 2, 3, 4, 5, 6, 7, 8}, 274, "594a92566ae77230d7fffd747a631c70b37f68e8c2c58f2d468ac572f0926441"},
		{ActionDexSwapExactInput, DexSwapExactInputPayload{"dex_test", "YNXT", big, 2, 1893456000}, 8, []int{2, 3, 4, 5, 6, 7}, 266, "054d53ae2a5e6d6cc5bebeefc0dc559b3d5c6e690b0e7951f97390fee1fa381e"},
		{ActionDexSwapExactOutput, DexSwapExactOutputPayload{"dex_test", "asset-test", big, 2, 1893456000}, 8, []int{2, 3, 4, 5, 6, 7}, 273, "0993d58d7431485b678915a552952ed0a472506af04859d9d123a2277fea037e"},
	}
}

func vectorAction(t testing.TB, v actionVector) Action {
	t.Helper()
	payload, err := EncodeActionPayload(v.kind, v.payload)
	authOK(t, err)
	network := make([]byte, 32)
	for i := range network {
		network[i] = byte(i)
	}
	return Action{ChainID: network, NativeChainID: 9007199254740993, Owner: qaFrom, Nonce: math.MaxUint64, Fee: 7, Kind: v.kind, Payload: payload}
}

func actionReject(t testing.TB, err error) {
	t.Helper()
	if !errors.Is(err, ErrAction) {
		t.Fatalf("expected ErrAction, got %v", err)
	}
}

func TestActionIndependentVectorsAndCompleteRoundtrip(t *testing.T) {
	for _, v := range actionVectors() {
		t.Run(v.kind, func(t *testing.T) {
			a := vectorAction(t, v)
			wire, err := a.SigningBytes()
			authOK(t, err)
			hash := sha256.Sum256(wire)
			if len(wire) != v.wireLength || hex.EncodeToString(hash[:]) != v.sha256 {
				t.Fatalf("independent wire vector differs: size=%d hash=%x", len(wire), hash)
			}
			decoded, err := DecodeAction(wire)
			authOK(t, err)
			if !reflect.DeepEqual(decoded, a) {
				t.Fatal("action omitted or changed an execution field")
			}
			p, err := DecodeActionPayload(a.Kind, a.Payload)
			authOK(t, err)
			if !reflect.DeepEqual(p, v.payload) {
				t.Fatal("typed payload omitted or changed an execution field")
			}
			f := authFields(t, wire, 12)
			if !bytes.Equal(f[11], a.Payload) || bytes.Equal(f[11], hash[:]) {
				t.Fatal("complete nested payload missing from signing message")
			}
			if len(a.Payload) > MaxActionPayloadBytes || len(wire) > MaxActionBytes {
				t.Fatal("encoded action exceeds its declared limit")
			}
			clear(wire)
			if !reflect.DeepEqual(decoded, a) {
				t.Fatal("decoder retained mutable caller wire")
			}
		})
	}
	// Exact bytes in addition to digest vectors, including >2^53 high/low words.
	a := vectorAction(t, actionVectors()[0])
	wire, err := a.SigningBytes()
	authOK(t, err)
	const stakeHex = "0000000c00000014594e582d4e41544956452d414354494f4e2f7631000000040000000100000020000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f000000040020000000000004000000010000002a30783132333435363738393061626364656631323334353637383930616263646566313233343536373800000004ffffffff00000004ffffffff00000004000000000000000400000007000000057374616b65000000140000000200000004002000000000000400000003"
	if hex.EncodeToString(wire) != stakeHex {
		t.Fatal("stake differs byte-for-byte from independent encoder")
	}
}

func TestActionBindsEveryEnvelopeFieldAndOwner(t *testing.T) {
	original := vectorAction(t, actionVectors()[0])
	wire, err := original.SigningBytes()
	authOK(t, err)
	for name, change := range map[string]func(*Action){
		"network":      func(a *Action) { a.ChainID[0] ^= 1 },
		"native chain": func(a *Action) { a.NativeChainID += 1 << 32 },
		"owner":        func(a *Action) { a.Owner = qaTo },
		"nonce":        func(a *Action) { a.Nonce -= 1 << 32 },
		"fee":          func(a *Action) { a.Fee += 1 << 32 },
		"full payload": func(a *Action) { a.Payload, _ = EncodeActionPayload(ActionStake, StakePayload{9007199254740997}) },
	} {
		t.Run(name, func(t *testing.T) {
			a := original
			a.ChainID = bytes.Clone(original.ChainID)
			change(&a)
			other, err := a.SigningBytes()
			authOK(t, err)
			if bytes.Equal(wire, other) {
				t.Fatal("signing bytes did not bind envelope field")
			}
		})
	}
	// These two schemas happen to have compatible values/widths; the kind must
	// still distinguish their otherwise identical full payload bytes.
	add := vectorAction(t, actionVectors()[7])
	remove := add
	remove.Kind = ActionDexLiquidityRemove
	w1, err := add.SigningBytes()
	authOK(t, err)
	w2, err := remove.SigningBytes()
	authOK(t, err)
	if bytes.Equal(w1, w2) {
		t.Fatal("action discriminator omitted from signing bytes")
	}
	for _, index := range []int{1, 2} {
		a := vectorAction(t, actionVectors()[index])
		a.Owner = qaTo
		_, err := a.SigningBytes()
		actionReject(t, err)
	}
}

func TestActionRejectsMalformedEnvelopeAndUnsupportedDispatch(t *testing.T) {
	a := vectorAction(t, actionVectors()[0])
	wire, err := a.SigningBytes()
	authOK(t, err)
	for name, change := range map[string]func([][]byte){
		"domain":       func(f [][]byte) { f[0] = []byte(TransferDomain) },
		"version":      func(f [][]byte) { f[1] = ynxbatch.U32(2) },
		"network":      func(f [][]byte) { f[2] = make([]byte, 31) },
		"chain zero":   func(f [][]byte) { f[3], f[4] = ynxbatch.U32(0), ynxbatch.U32(0) },
		"chain large":  func(f [][]byte) { f[3] = ynxbatch.U32(1 << 31) },
		"owner case":   func(f [][]byte) { f[5] = []byte(strings.ToUpper(qaFrom)) },
		"owner alias":  func(f [][]byte) { f[5] = []byte("ynx1not-an-evm-address") },
		"nonce zero":   func(f [][]byte) { f[6], f[7] = ynxbatch.U32(0), ynxbatch.U32(0) },
		"fee overflow": func(f [][]byte) { f[8] = ynxbatch.U32(1 << 31) },
		"kind default": func(f [][]byte) { f[10] = nil },
		"kind case":    func(f [][]byte) { f[10] = []byte("Stake") },
		"payload JSON": func(f [][]byte) { f[11] = []byte(`{"amount":1,"amount":2}`) },
		"payload hash": func(f [][]byte) { f[11] = make([]byte, 32) },
		"payload huge": func(f [][]byte) { f[11] = make([]byte, MaxActionPayloadBytes+1) },
	} {
		t.Run(name, func(t *testing.T) {
			f := authFields(t, wire, 12)
			change(f)
			_, err := DecodeAction(authFrame(t, f))
			actionReject(t, err)
		})
	}
	for _, index := range []int{1, 3, 4, 6, 7, 8, 9} {
		for _, length := range []int{0, 3, 5, 8} {
			f := authFields(t, wire, 12)
			f[index] = make([]byte, length)
			_, err := DecodeAction(authFrame(t, f))
			actionReject(t, err)
		}
	}
	badLength := bytes.Clone(wire)
	binary.BigEndian.PutUint32(badLength[4:], math.MaxUint32)
	f := authFields(t, wire, 12)
	for _, input := range [][]byte{nil, wire[:3], wire[:len(wire)-1], append(bytes.Clone(wire), 0), badLength, authFrame(t, f[:11]), authFrame(t, append(f, f[11])), make([]byte, MaxActionBytes+1)} {
		_, err := DecodeAction(input)
		actionReject(t, err)
	}
	for _, kind := range []string{"", "transfer", "contract_deploy", "contract_call", "resource_pool_create", "resource_pool_fund", "resource_pool_policy", "resource_pool_status", "resource_sponsor", " stake", "stake\x00", "arbitrary_callback"} {
		_, err := EncodeActionPayload(kind, StakePayload{1})
		actionReject(t, err)
		_, err = DecodeActionPayload(kind, a.Payload)
		actionReject(t, err)
		bad := a
		bad.Kind = kind
		_, err = bad.SigningBytes()
		actionReject(t, err)
	}
	for _, payload := range []any{nil, &StakePayload{1}, uint64(1), map[string]any{"amount": 1}, []byte(`{"amount":1}`), DexAssetAmountPayload{"asset-test", 1}} {
		_, err := EncodeActionPayload(ActionStake, payload)
		actionReject(t, err)
	}
}

func TestActionRejectsEveryPayloadIntegerWidthAndExtraField(t *testing.T) {
	for _, v := range actionVectors() {
		t.Run(v.kind, func(t *testing.T) {
			a := vectorAction(t, v)
			for _, index := range v.numeric {
				for _, length := range []int{0, 3, 5, 8} {
					f := authFields(t, a.Payload, v.count)
					f[index] = make([]byte, length)
					_, err := DecodeActionPayload(v.kind, authFrame(t, f))
					actionReject(t, err)
				}
			}
			f := authFields(t, a.Payload, v.count)
			for _, input := range [][]byte{nil, a.Payload[:3], a.Payload[:len(a.Payload)-1], append(bytes.Clone(a.Payload), 0), authFrame(t, f[:len(f)-1]), authFrame(t, append(f, f[0])), make([]byte, MaxActionPayloadBytes+1)} {
				_, err := DecodeActionPayload(v.kind, input)
				actionReject(t, err)
			}
		})
	}
}

func TestActionRejectsNoncanonicalOrOverflowPayloadFields(t *testing.T) {
	for _, tc := range []struct {
		vector int
		field  string
		value  any
	}{
		{0, "Amount", uint64(0)}, {0, "Amount", uint64(math.MaxInt64) + 1},
		{1, "Provider", qaTo + " "}, {1, "Beneficiary", "a b"}, {1, "Beneficiary", "a\x00b"}, {1, "AmountYNXT", uint64(0)},
		{1, "PolicyHash", strings.Repeat("AB", 32)}, {1, "RequestHash", strings.Repeat("0", 63)}, {1, "IdempotencyKey", " a "}, {1, "IdempotencyKey", "a\nb"}, {1, "IdempotencyKey", strings.Repeat("a", 129)},
		{2, "Address", ""}, {2, "Provider", ""}, {2, "Provider", strings.Repeat("a", 129)}, {2, "Bandwidth", uint64(math.MaxInt64) + 1}, {2, "Compute", uint64(math.MaxUint64)}, {2, "AICredits", uint64(math.MaxUint64)}, {2, "TrustCredits", uint64(math.MaxUint64)},
		{2, "QuoteID", "0123456789ABCDEF01234567"}, {2, "QuoteID", "0123"}, {2, "MaxPriceYNXT", uint64(0)}, {2, "MaxPriceYNXT", uint64(math.MaxUint64)},
		{2, "QuoteExpiresAt", "2030-01-02T03:04:05+00:00"}, {2, "QuoteExpiresAt", "2030-01-02T03:04:05.000Z"}, {2, "QuoteExpiresAt", "2030-01-02T03:04:05,123Z"}, {2, "QuoteExpiresAt", "2030-01-02T03:04:05.1234567890Z"}, {2, "QuoteExpiresAt", "0001-01-01T00:00:00Z"}, {2, "QuoteExpiresAt", "0000-01-01T00:00:00Z"},
		{3, "AssetID", "YNXT"}, {3, "AssetID", "ASSET"}, {3, "AssetID", "ab"}, {3, "Symbol", "test"}, {3, "Symbol", strings.Repeat("A", 13)}, {3, "Name", " Test"}, {3, "Name", "Test\nasset"}, {3, "Name", "\xff"}, {3, "Name", strings.Repeat("资", 27)},
		{3, "Decimals", uint32(19)}, {3, "MaxSupply", uint64(math.MaxUint64)}, {3, "MaxSupply", uint64(1)}, {3, "InitialSupply", uint64(0)},
		{4, "AssetID", "YNXT"}, {4, "Amount", uint64(math.MaxUint64)},
		{5, "AssetID", "YNXT"}, {5, "Recipient", strings.ToUpper(qaTo)}, {5, "Amount", uint64(0)},
		{6, "PoolID", "dex_ab"}, {6, "PoolID", "DEX_test"}, {6, "Asset0", "asset-test"}, {6, "Asset1", "YNXT"}, {6, "Asset1", "ynxt "}, {6, "FeeBps", uint32(0)}, {6, "FeeBps", uint32(1001)}, {6, "FeeBps", uint32(math.MaxUint32)},
		{7, "Amount0", uint64(0)}, {7, "Amount1", uint64(math.MaxUint64)}, {7, "MinShares", uint64(0)}, {7, "DeadlineUnix", uint64(math.MaxUint64)},
		{8, "Shares", uint64(0)}, {8, "MinAmount0", uint64(math.MaxUint64)}, {8, "MinAmount1", uint64(math.MaxUint64)}, {8, "DeadlineUnix", uint64(0)},
		{9, "AssetIn", "ynxt "}, {9, "AmountIn", uint64(0)}, {9, "MinAmountOut", uint64(0)}, {9, "DeadlineUnix", uint64(0)},
		{10, "AssetOut", ""}, {10, "AmountOut", uint64(0)}, {10, "MaxAmountIn", uint64(0)}, {10, "DeadlineUnix", uint64(0)},
	} {
		v := actionVectors()[tc.vector]
		t.Run(v.kind+"/"+tc.field, func(t *testing.T) {
			p := reflect.New(reflect.TypeOf(v.payload)).Elem()
			p.Set(reflect.ValueOf(v.payload))
			p.FieldByName(tc.field).Set(reflect.ValueOf(tc.value))
			_, err := EncodeActionPayload(v.kind, p.Interface())
			actionReject(t, err)
		})
	}
	// Decode checks semantic ranges before narrowing to uint8/uint16/int64.
	for _, tc := range []struct {
		vector, field int
		value         uint32
	}{{0, 0, 1 << 31}, {3, 3, 256}, {6, 3, 65536}} {
		v := actionVectors()[tc.vector]
		a := vectorAction(t, v)
		f := authFields(t, a.Payload, v.count)
		f[tc.field] = ynxbatch.U32(tc.value)
		_, err := DecodeActionPayload(v.kind, authFrame(t, f))
		actionReject(t, err)
	}
}

func TestActionLeavesBusinessAuthorityWithCaller(t *testing.T) {
	// Pure syntax cannot decide current fee, quote expiry, resource-account
	// existence, request-hash derivation, balance, nonce or DEX permissions.
	rental := actionVectors()[2].payload.(ResourceRentalPayload)
	rental.Bandwidth, rental.Compute, rental.AICredits, rental.TrustCredits = 0, 0, 0, 0
	_, err := EncodeActionPayload(ActionResourceRent, rental)
	actionReject(t, err)
	rental.Bandwidth, rental.QuoteExpiresAt = 1, "2000-01-01T00:00:00Z"
	rental.Provider = "merchant:fixture"
	_, err = EncodeActionPayload(ActionResourceRent, rental)
	authOK(t, err)
	remove := DexLiquidityRemovePayload{"dex_test", 1, 0, 0, 1}
	_, err = EncodeActionPayload(ActionDexLiquidityRemove, remove)
	authOK(t, err)
	a := vectorAction(t, actionVectors()[0])
	for _, fee := range []uint64{0, 1, math.MaxInt64} {
		a.Fee = fee
		_, err := a.SigningBytes()
		authOK(t, err)
	}
}

func FuzzActionCanonicalDecode(f *testing.F) {
	for _, v := range actionVectors() {
		a := vectorAction(f, v)
		wire, err := a.SigningBytes()
		authOK(f, err)
		f.Add(wire)
	}
	f.Fuzz(func(t *testing.T, wire []byte) {
		a, err := DecodeAction(wire)
		if err != nil {
			return
		}
		canonical, err := a.SigningBytes()
		authOK(t, err)
		if !bytes.Equal(canonical, wire) {
			t.Fatal("decoder accepted a noncanonical action")
		}
	})
}
