package ynxauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type stakingActionVector struct {
	kind, payloadHex, wireHex, sha256 string
	payload                           any
	fields, wireLength                int
}

// Public syntax vectors use an independent literal E encoder (Ruby Array#pack
// with big-endian U32 lengths/words), not the implementation under test. The
// amount exceeds JSON's exact-integer range. No validator membership, ledger,
// signature, staking permission or execution is asserted by these vectors.
func stakingActionVectors() []stakingActionVector {
	const big = uint64(9007199254740995)
	const id = "0123456789abcdef01234567"
	return []stakingActionVector{
		{kind: ActionStakeDelegate, payload: StakeDelegatePayload{Validator: "ynx_validator_0", AmountYNXT: big}, fields: 3, wireLength: 227,
			payloadHex: "000000030000000f796e785f76616c696461746f725f3000000004002000000000000400000003",
			wireHex:    "0000000c00000014594e582d4e41544956452d414354494f4e2f7631000000040000000100000020000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f000000040020000000000004000000010000002a30783132333435363738393061626364656631323334353637383930616263646566313233343536373800000004ffffffff00000004ffffffff000000040000000000000004000000010000000e7374616b655f64656c656761746500000027000000030000000f796e785f76616c696461746f725f3000000004002000000000000400000003",
			sha256:     "84880acbd84f8d98466123f4cfc5750921bf9c2b108000268026952729d8e486"},
		{kind: ActionStakeUnbond, payload: StakeUnbondPayload{DelegationID: id, AmountYNXT: big}, fields: 3, wireLength: 234,
			payloadHex: "000000030000001830313233343536373839616263646566303132333435363700000004002000000000000400000003",
			wireHex:    "0000000c00000014594e582d4e41544956452d414354494f4e2f7631000000040000000100000020000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f000000040020000000000004000000010000002a30783132333435363738393061626364656631323334353637383930616263646566313233343536373800000004ffffffff00000004ffffffff000000040000000000000004000000010000000c7374616b655f756e626f6e6400000030000000030000001830313233343536373839616263646566303132333435363700000004002000000000000400000003",
			sha256:     "4306d6b5c268e2a98cd0c152364be9c65fab29d005e0a4df2c0f76f95d2de57f"},
		{kind: ActionStakeWithdraw, payload: StakeWithdrawPayload{UnbondingID: id}, fields: 1, wireLength: 220,
			payloadHex: "0000000100000018303132333435363738396162636465663031323334353637",
			wireHex:    "0000000c00000014594e582d4e41544956452d414354494f4e2f7631000000040000000100000020000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f000000040020000000000004000000010000002a30783132333435363738393061626364656631323334353637383930616263646566313233343536373800000004ffffffff00000004ffffffff000000040000000000000004000000010000000e7374616b655f7769746864726177000000200000000100000018303132333435363738396162636465663031323334353637",
			sha256:     "f111011fecafdc9074d54ced21d93c8cd8c3ced3a82decf2948fdbc9f6e0670b"},
	}
}

func stakingVectorAction(t *testing.T, v stakingActionVector) Action {
	t.Helper()
	payload, err := EncodeActionPayload(v.kind, v.payload)
	authOK(t, err)
	network := make([]byte, 32)
	for i := range network {
		network[i] = byte(i)
	}
	return Action{ChainID: network, NativeChainID: 9007199254740993, Owner: qaFrom, Nonce: math.MaxUint64, Fee: StakingActionFee, Kind: v.kind, Payload: payload}
}

func TestStakingActionIndependentVectorsAndCanonicalRoundtrip(t *testing.T) {
	for _, v := range stakingActionVectors() {
		t.Run(v.kind, func(t *testing.T) {
			a := stakingVectorAction(t, v)
			if hex.EncodeToString(a.Payload) != v.payloadHex {
				t.Fatal("typed staking payload differs from independent E bytes")
			}
			wire, err := a.SigningBytes()
			authOK(t, err)
			digest := sha256.Sum256(wire)
			if len(wire) != v.wireLength || hex.EncodeToString(wire) != v.wireHex || hex.EncodeToString(digest[:]) != v.sha256 {
				t.Fatalf("independent staking vector differs: bytes=%d sha256=%x", len(wire), digest)
			}
			fields := authFields(t, wire, 12)
			if !bytes.Equal(fields[0], []byte("YNX-NATIVE-ACTION/v1")) || !bytes.Equal(fields[1], ynxbatch.U32(1)) || !bytes.Equal(fields[10], []byte(v.kind)) || !bytes.Equal(fields[11], a.Payload) {
				t.Fatal("staking action changed the original domain, twelve-field frame or complete payload")
			}
			decoded, err := DecodeAction(wire)
			authOK(t, err)
			payload, err := DecodeActionPayload(v.kind, a.Payload)
			authOK(t, err)
			if !reflect.DeepEqual(a, decoded) || !reflect.DeepEqual(v.payload, payload) {
				t.Fatal("staking action lost an exact typed field or uint64 value")
			}
			clear(wire)
			if !reflect.DeepEqual(a, decoded) {
				t.Fatal("decoded staking action retained caller wire aliases")
			}
		})
	}
}

func TestStakingActionRejectsWrongTypedDispatchAndKind(t *testing.T) {
	type aliasDelegate StakeDelegatePayload
	for _, v := range stakingActionVectors() {
		t.Run(v.kind, func(t *testing.T) {
			for _, payload := range []any{nil, &StakeDelegatePayload{"ynx_validator_0", 1}, &StakeUnbondPayload{"0123456789abcdef01234567", 1}, &StakeWithdrawPayload{"0123456789abcdef01234567"}, aliasDelegate{"ynx_validator_0", 1}, StakePayload{1}, map[string]any{"validator": "ynx_validator_0", "amountYNXT": 1}, []byte(`{"amountYNXT":1}`), `{"amountYNXT":1}`, uint64(1)} {
				_, err := EncodeActionPayload(v.kind, payload)
				actionReject(t, err)
			}
			for _, other := range stakingActionVectors() {
				if other.kind != v.kind {
					_, err := EncodeActionPayload(other.kind, v.payload)
					actionReject(t, err)
				}
			}
			a := stakingVectorAction(t, v)
			for _, kind := range []string{"", "Stake_delegate", "stake-delegate", " stake_delegate", "stake_delegate\x00", "stake_unbond_extra", "stake_withdraw_extra", "arbitrary_callback", ActionStake} {
				_, err := EncodeActionPayload(kind, v.payload)
				actionReject(t, err)
				_, err = DecodeActionPayload(kind, a.Payload)
				actionReject(t, err)
				bad := a
				bad.Kind = kind
				_, err = bad.SigningBytes()
				actionReject(t, err)
			}
		})
	}
}

func TestStakingActionRejectsMalformedFramesAndIntegerWidths(t *testing.T) {
	for _, v := range stakingActionVectors() {
		t.Run(v.kind, func(t *testing.T) {
			a := stakingVectorAction(t, v)
			fields := authFields(t, a.Payload, v.fields)
			badCount := bytes.Clone(a.Payload)
			binary.BigEndian.PutUint32(badCount, math.MaxUint32)
			badLength := bytes.Clone(a.Payload)
			binary.BigEndian.PutUint32(badLength[4:], math.MaxUint32)
			for _, raw := range [][]byte{nil, a.Payload[:3], a.Payload[:len(a.Payload)-1], append(bytes.Clone(a.Payload), 0), authFrame(t, fields[:len(fields)-1]), authFrame(t, append(fields, fields[0])), badCount, badLength, []byte(`{"amountYNXT":1,"amountYNXT":2}`), make([]byte, MaxActionPayloadBytes+1)} {
				_, err := DecodeActionPayload(v.kind, raw)
				actionReject(t, err)
			}
			if v.kind != ActionStakeWithdraw {
				for _, index := range []int{1, 2} {
					for _, width := range []int{0, 1, 3, 5, 8} {
						f := authFields(t, a.Payload, v.fields)
						f[index] = make([]byte, width)
						_, err := DecodeActionPayload(v.kind, authFrame(t, f))
						actionReject(t, err)
					}
				}
				for _, amount := range []uint64{0, uint64(math.MaxInt64) + 1, math.MaxUint64} {
					f := authFields(t, a.Payload, v.fields)
					f[1], f[2] = ynxbatch.U32(uint32(amount>>32)), ynxbatch.U32(uint32(amount))
					_, err := DecodeActionPayload(v.kind, authFrame(t, f))
					actionReject(t, err)
				}
			}
			wire, err := a.SigningBytes()
			authOK(t, err)
			for _, fee := range []uint64{0, 2, math.MaxInt64, math.MaxUint64} {
				bad := a
				bad.Fee = fee
				_, err := bad.SigningBytes()
				actionReject(t, err)
				f := authFields(t, wire, 12)
				f[8], f[9] = ynxbatch.U32(uint32(fee>>32)), ynxbatch.U32(uint32(fee))
				_, err = DecodeAction(authFrame(t, f))
				actionReject(t, err)
			}
		})
	}
}

func TestStakingActionPreservesOpaqueValidatorAndCanonicalRecordIDs(t *testing.T) {
	for _, validator := range []string{"v", "ynx_validator_0", "验证者_0", strings.Repeat("v", 128), strings.Repeat("界", 42) + "ab"} {
		p := StakeDelegatePayload{Validator: validator, AmountYNXT: 1}
		wire, err := EncodeActionPayload(ActionStakeDelegate, p)
		authOK(t, err)
		decoded, err := DecodeActionPayload(ActionStakeDelegate, wire)
		authOK(t, err)
		if !reflect.DeepEqual(p, decoded) {
			t.Fatal("opaque validator ID was normalized or converted to an account")
		}
	}
	for _, validator := range []string{"", strings.Repeat("v", 129), strings.Repeat("界", 43), " v", "v ", "v\u00a0", "v\n", "v\x00", string([]byte{0xff})} {
		_, err := EncodeActionPayload(ActionStakeDelegate, StakeDelegatePayload{Validator: validator, AmountYNXT: 1})
		actionReject(t, err)
		wire := authFrame(t, append([][]byte{[]byte(validator)}, pair(1)...))
		_, err = DecodeActionPayload(ActionStakeDelegate, wire)
		actionReject(t, err)
	}
	for _, id := range []string{"0123456789abcdef01234567", strings.Repeat("0", 24)} {
		for _, p := range []any{StakeUnbondPayload{DelegationID: id, AmountYNXT: 1}, StakeWithdrawPayload{UnbondingID: id}} {
			kind := ActionStakeUnbond
			if _, ok := p.(StakeWithdrawPayload); ok {
				kind = ActionStakeWithdraw
			}
			wire, err := EncodeActionPayload(kind, p)
			authOK(t, err)
			decoded, err := DecodeActionPayload(kind, wire)
			authOK(t, err)
			if !reflect.DeepEqual(p, decoded) {
				t.Fatal("canonical record ID was changed")
			}
		}
	}
	for _, id := range []string{"", strings.Repeat("a", 23), strings.Repeat("a", 25), "0123456789ABCDEF01234567", "0x0123456789abcdef01234567", " 123456789abcdef01234567", "0123456789abcdef0123456 ", "g123456789abcdef01234567", string(bytes.Repeat([]byte{0xff}, 24))} {
		for _, kind := range []string{ActionStakeUnbond, ActionStakeWithdraw} {
			var payload any = StakeUnbondPayload{DelegationID: id, AmountYNXT: 1}
			fields := append([][]byte{[]byte(id)}, pair(1)...)
			if kind == ActionStakeWithdraw {
				payload, fields = StakeWithdrawPayload{UnbondingID: id}, [][]byte{[]byte(id)}
			}
			_, err := EncodeActionPayload(kind, payload)
			actionReject(t, err)
			_, err = DecodeActionPayload(kind, authFrame(t, fields))
			actionReject(t, err)
		}
	}
	for _, amount := range []uint64{1, 1 << 32, 9007199254740995, math.MaxInt64} {
		for _, tc := range []struct {
			kind string
			p    any
		}{{ActionStakeDelegate, StakeDelegatePayload{"ynx_validator_0", amount}}, {ActionStakeUnbond, StakeUnbondPayload{"0123456789abcdef01234567", amount}}} {
			wire, err := EncodeActionPayload(tc.kind, tc.p)
			authOK(t, err)
			decoded, err := DecodeActionPayload(tc.kind, wire)
			authOK(t, err)
			if !reflect.DeepEqual(tc.p, decoded) {
				t.Fatal("valid high/low amount was narrowed")
			}
		}
	}
	for _, amount := range []uint64{0, uint64(math.MaxInt64) + 1, math.MaxUint64} {
		_, err := EncodeActionPayload(ActionStakeDelegate, StakeDelegatePayload{"ynx_validator_0", amount})
		actionReject(t, err)
		_, err = EncodeActionPayload(ActionStakeUnbond, StakeUnbondPayload{"0123456789abcdef01234567", amount})
		actionReject(t, err)
	}
}

func TestStakingActionBindsKindAcrossCompatiblePayloadFields(t *testing.T) {
	const id = "0123456789abcdef01234567"
	delegate := stakingVectorAction(t, stakingActionVectors()[0])
	var err error
	delegate.Payload, err = EncodeActionPayload(ActionStakeDelegate, StakeDelegatePayload{id, 1})
	authOK(t, err)
	unbond := delegate
	unbond.Kind = ActionStakeUnbond
	unbond.Payload, err = EncodeActionPayload(ActionStakeUnbond, StakeUnbondPayload{id, 1})
	authOK(t, err)
	if !bytes.Equal(delegate.Payload, unbond.Payload) {
		t.Fatal("compatible E fields unexpectedly changed the specified payload ABI")
	}
	d, err := delegate.SigningBytes()
	authOK(t, err)
	u, err := unbond.SigningBytes()
	authOK(t, err)
	if bytes.Equal(d, u) {
		t.Fatal("complete signing message failed to bind the staking action kind")
	}
	for _, fee := range []uint64{0, 7, math.MaxInt64} {
		legacy := vectorAction(t, actionVectors()[0])
		legacy.Fee = fee
		_, err := legacy.SigningBytes()
		authOK(t, err)
	}
}
