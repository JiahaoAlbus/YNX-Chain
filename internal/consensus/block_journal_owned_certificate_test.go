package consensus

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Frozen original strict-decode followed by a full private clone.
func originalStrictNativeCertificate(payload []byte) (CommittedState, bool, error) {
	var canonical CommittedState
	if err := decodeStrictJSON(payload, &canonical); err != nil {
		return CommittedState{}, false, err
	}
	private, ok := cloneNativeCommittedState(canonical)
	if ok {
		return private, true, nil
	}
	return canonical, false, nil
}

func TestBlockJournalOwnedCertificatePreservesStrictDecodeAndFallback(t *testing.T) {
	expected := CommittedState{Accounts: []chain.ConsensusAccount{{Address: "a"}}, FeeEvents: []BFTFeeEvent{{ID: "fee"}}}
	for _, payload := range []string{
		`null`, `{}`, `{"accounts":null,"feeEvents":null}`, `{"accounts":[],"feeEvents":[]}`,
		`{"accounts":[{"address":"a","lots":{"x":1}}],"feeEvents":[{"id":"fee"}]}`,
		`{"accounts":[{},{}],"feeEvents":[{},{},{}]}`,
		`{"accounts":[{"address":"old"}],"accounts":[{}],"feeEvents":[{}]}`,
		`{"accounts":[{}],"feeEvents":[{"id":"old"}],"feeEvents":[{}]}`,
		`{"Accounts":[{}],"FeeEvents":[{}]}`,
		`{"accounts":[{"unknown":true}]}`, `{"feeEvents":[{"grossFeeYnxt":"bad"}]}`,
		`{"unknown":1}`, `{"accounts":[`, `{} {}`, `{} trailing`,
	} {
		want, wantNative, before := originalStrictNativeCertificate([]byte(payload))
		got, owned, after := decodeOwnedNativeCertificate([]byte(payload), expected)
		if (before == nil) != (after == nil) || (before != nil && before.Error() != after.Error()) {
			t.Fatalf("strict first error changed for %q: %v / %v", payload, before, after)
		}
		if before != nil {
			continue
		}
		if !owned {
			if private, ok := cloneNativeCommittedState(got); ok {
				got = private
			} else if wantNative {
				t.Fatal("native eligibility changed")
			}
		} else if !wantNative {
			t.Fatal("unsupported native state adopted")
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("decoded nil/empty/value identity changed for %q", payload)
		}
	}
	// A populated unsupported domain must remain in the original fallback.
	unsupported := expected
	unsupported.AIPermissions = []BFTAIPermission{{}}
	payload, err := json.Marshal(unsupported)
	if err != nil {
		t.Fatal(err)
	}
	if _, owned, err := decodeOwnedNativeCertificate(payload, unsupported); err != nil || owned {
		t.Fatal("unsupported domain adopted", err)
	}
}

func TestBlockJournalOwnedCertificateRetainedRealStateOwnsOutputAndCapacity(t *testing.T) {
	migration, state := retainedSealFixture(t)
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	want, _, err := originalStrictNativeCertificate(raw)
	if err != nil {
		t.Fatal(err)
	}
	d := &BlockJournalPrefixDecoder{nativeClone: true}
	certificate, err := d.makePrefixCertificate([]byte("prefix"), BlockJournalReadback{State: state, SnapshotJSON: raw, CompleteBytes: 6}, 16, nil)
	if err != nil || certificate.native == nil || !reflect.DeepEqual(*certificate.native, want) {
		t.Fatal("private state changed", err)
	}
	got := certificate.native
	if cap(got.Accounts) != len(got.Accounts) || cap(got.FeeEvents) != len(got.FeeEvents) {
		t.Fatal("retained capacity grew")
	}
	originalPayload := append([]byte(nil), certificate.payload...)
	raw[0] ^= 1
	state.Accounts[0].Balance++
	state.Accounts[0].Lots = map[string]int64{"caller": 99}
	state.FeeEvents[len(state.FeeEvents)-1].AuditHash = "caller"
	if !bytes.Equal(certificate.payload, originalPayload) || !reflect.DeepEqual(*got, want) {
		t.Fatal("caller owns private certificate storage")
	}
	if err := got.Validate(migration); err != nil {
		t.Fatal("private full validation failed", err)
	}
	// The ordinary public clone API must still allocate independent mutable data.
	clone, ok := cloneNativeCommittedState(*got)
	if !ok {
		t.Fatal("native eligibility changed")
	}
	clone.Accounts[0].Balance++
	clone.FeeEvents[0].AuditHash = "caller"
	if !reflect.DeepEqual(*got, want) {
		t.Fatal("reused caller output mutated private certificate")
	}
}

var ownedNativeCertificateSink CommittedState

func BenchmarkBlockJournalOwnedCertificateActualHistory(b *testing.B) {
	_, state := retainedSealFixture(b)
	raw, err := json.Marshal(state)
	if err != nil {
		b.Fatal(err)
	}
	want, _, err := originalStrictNativeCertificate(raw)
	if err != nil {
		b.Fatal(err)
	}
	for index, mode := range []bool{false, true, true, false, false, true} {
		name := "original_decode_then_clone"
		if mode {
			name = "owned_exact_capacity_decode"
		}
		b.Run(fmt.Sprintf("%02d_%s", index, name), func(b *testing.B) {
			decode := func() (CommittedState, error) {
				if !mode {
					s, _, err := originalStrictNativeCertificate(raw)
					return s, err
				}
				s, owned, err := decodeOwnedNativeCertificate(raw, state)
				if err == nil && !owned {
					b.Fatal("actual matching history did not exercise owned decode")
				}
				if err == nil {
					copyNativeAccountLots(&s)
				}
				return s, err
			}
			got, err := decode()
			if err != nil || !reflect.DeepEqual(got, want) {
				b.Fatal("actual complete state changed", err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				ownedNativeCertificateSink, err = decode()
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
