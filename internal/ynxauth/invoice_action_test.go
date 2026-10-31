package ynxauth

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type invoiceActionCase struct {
	name, kind, domain string
	payload            any
	count              int
	numeric            []int
}

func invoiceActionCases() []invoiceActionCase {
	terms := InvoiceTermsPayload{
		InvoiceID: "invoice-001", SessionID: "session:001", Recipient: qaTo, Payer: qaFrom,
		AssetID: "YNXT", UnitVersion: "1", FeeRule: "native-transfer-fee-one/v1",
		KeyEpoch: 9007199254740993, Revision: 9007199254740995, Amount: 9007199254740997,
		MaxFee: 4294967303, ExpiresAt: math.MaxInt64,
	}
	open := terms
	open.Payer = ""
	return []invoiceActionCase{
		{"terms-specific-payer", ActionInvoiceTerms, InvoiceTermsDomain, terms, 19, []int{1, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18}},
		{"terms-open-payer", ActionInvoiceTerms, InvoiceTermsDomain, open, 19, []int{1, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18}},
		{"settle", ActionInvoiceSettle, InvoiceSettleDomain, InvoiceSettlePayload{Merchant: qaFrom, InvoiceID: terms.InvoiceID, TermsHash: bytes.Repeat([]byte{0xa5}, 32), Amount: terms.Amount}, 7, []int{1, 5, 6}},
		{"refund", ActionInvoiceRefund, InvoiceRefundDomain, InvoiceRefundPayload{InvoiceID: terms.InvoiceID, RefundID: "refund-001", TermsHash: bytes.Repeat([]byte{0xa5}, 32), SettlementHash: bytes.Repeat([]byte{0x5a}, 32), Amount: 4294967301}, 8, []int{1, 6, 7}},
	}
}

func invoiceVectorAction(t testing.TB, v invoiceActionCase) Action {
	t.Helper()
	payload, err := EncodeActionPayload(v.kind, v.payload)
	authOK(t, err)
	network := make([]byte, 32)
	for i := range network {
		network[i] = byte(i)
	}
	return Action{ChainID: network, NativeChainID: 9007199254740993, Owner: qaFrom,
		Nonce: math.MaxUint64, Fee: InvoiceActionFee, Kind: v.kind, Payload: payload}
}

func invoicePublicInput(payload any) map[string]string {
	values := make(map[string]string)
	v := reflect.ValueOf(payload)
	for i := 0; i < v.NumField(); i++ {
		name := v.Type().Field(i).Name
		name = strings.ToLower(name[:1]) + name[1:]
		f := v.Field(i)
		switch f.Kind() {
		case reflect.String:
			values[name] = f.String()
		case reflect.Uint64:
			values[name] = strconv.FormatUint(f.Uint(), 10)
		case reflect.Slice:
			values[name+"Hex"] = hex.EncodeToString(f.Bytes())
		}
	}
	return values
}

// This negative-test encoder intentionally performs no production validation.
// The checked-in vectors independently fix the order and exact E bytes.
func invoiceUncheckedPayload(t testing.TB, tc invoiceActionCase, payload any) []byte {
	t.Helper()
	f := [][]byte{[]byte(tc.domain), ynxbatch.U32(1)}
	v := reflect.ValueOf(payload)
	for i := 0; i < v.NumField(); i++ {
		switch p := v.Field(i); p.Kind() {
		case reflect.String:
			f = append(f, []byte(p.String()))
		case reflect.Uint64:
			f = append(f, ynxbatch.U32(uint32(p.Uint()>>32)), ynxbatch.U32(uint32(p.Uint())))
		case reflect.Slice:
			f = append(f, bytes.Clone(p.Bytes()))
		default:
			t.Fatal("unexpected test payload field")
		}
	}
	return authFrame(t, f)
}

func TestInvoiceActionPublicVectorsAndCanonicalRoundtrip(t *testing.T) {
	// The public fixture was encoded independently with literal U32BE framing;
	// it has no key, signature, execution permit or asserted historical hash.
	raw, err := os.ReadFile("testdata/invoice-action-v1.json")
	authOK(t, err)
	var fixture struct {
		Version, AlgorithmVersion, Purpose, Encoding, Note string
		Envelope                                           struct {
			NetworkHex, NativeChainID, Owner, Nonce, Fee string
		}
		Vectors []struct {
			Name, Kind, Domain, PayloadHex, MessageHex string
			Input                                      map[string]string
			PayloadFields, PayloadBytes, MessageBytes  int
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	authOK(t, decoder.Decode(&fixture))
	cases := invoiceActionCases()
	if fixture.Version != "YNX-INVOICE-ACTION-PUBLIC-VECTORS/v1" || fixture.AlgorithmVersion != ynxbatch.Version || fixture.Purpose != TransactionPurpose || len(fixture.Vectors) != len(cases) || fixture.Encoding == "" || fixture.Note == "" {
		t.Fatal("public vector profile differs")
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v, a := fixture.Vectors[i], invoiceVectorAction(t, tc)
			if fixture.Envelope.NetworkHex != hex.EncodeToString(a.ChainID) || fixture.Envelope.NativeChainID != strconv.FormatUint(a.NativeChainID, 10) || fixture.Envelope.Owner != a.Owner || fixture.Envelope.Nonce != strconv.FormatUint(a.Nonce, 10) || fixture.Envelope.Fee != strconv.FormatUint(a.Fee, 10) {
				t.Fatal("public envelope inputs differ")
			}
			if v.Name != tc.name || v.Kind != tc.kind || v.Domain != tc.domain || v.PayloadFields != tc.count || !reflect.DeepEqual(v.Input, invoicePublicInput(tc.payload)) {
				t.Fatal("public typed inputs or field count differ")
			}
			wire, err := a.SigningBytes()
			authOK(t, err)
			if hex.EncodeToString(a.Payload) != v.PayloadHex || hex.EncodeToString(wire) != v.MessageHex || len(a.Payload) != v.PayloadBytes || len(wire) != v.MessageBytes {
				t.Fatal("invoice wire differs from independent public vector")
			}
			p, err := DecodeActionPayload(tc.kind, a.Payload)
			authOK(t, err)
			if !reflect.DeepEqual(tc.payload, p) || !bytes.Equal(a.Payload, invoiceUncheckedPayload(t, tc, tc.payload)) {
				t.Fatal("payload lost, reordered or normalized a field")
			}
			decoded, err := DecodeAction(wire)
			authOK(t, err)
			if !reflect.DeepEqual(decoded, a) || !bytes.Equal(authFields(t, wire, 12)[11], a.Payload) {
				t.Fatal("complete payload is not inside the original Action v1")
			}
			clear(wire)
			if !reflect.DeepEqual(decoded, a) {
				t.Fatal("Action decoder retained caller bytes")
			}
			clear(a.Payload)
			if !reflect.DeepEqual(p, tc.payload) {
				t.Fatal("payload decoder retained caller bytes")
			}
		})
	}
}

func TestInvoiceActionStrictDispatchAndFraming(t *testing.T) {
	for _, tc := range invoiceActionCases() {
		t.Run(tc.name, func(t *testing.T) {
			a := invoiceVectorAction(t, tc)
			if !IsInvoiceAction(tc.kind) {
				t.Fatal("known invoice dispatch missing")
			}
			for _, kind := range []string{"", strings.ToUpper(tc.kind), tc.kind + " ", tc.kind + "\x00", "invoice_cancel", "invoice", ActionStake} {
				if IsInvoiceAction(kind) {
					t.Fatal("unsupported invoice dispatch accepted")
				}
				_, err := EncodeActionPayload(kind, tc.payload)
				actionReject(t, err)
				_, err = DecodeActionPayload(kind, a.Payload)
				actionReject(t, err)
			}
			pointer := reflect.New(reflect.TypeOf(tc.payload))
			pointer.Elem().Set(reflect.ValueOf(tc.payload))
			for _, value := range []any{nil, pointer.Interface(), map[string]any{"amount": 1}, a.Payload, uint64(1), StakePayload{1}} {
				_, err := EncodeActionPayload(tc.kind, value)
				actionReject(t, err)
			}
			for _, other := range invoiceActionCases() {
				if other.kind == tc.kind {
					continue
				}
				_, err := EncodeActionPayload(other.kind, tc.payload)
				actionReject(t, err)
				_, err = DecodeActionPayload(other.kind, a.Payload)
				actionReject(t, err)
			}
			f := authFields(t, a.Payload, tc.count)
			badCount, badLength := bytes.Clone(a.Payload), bytes.Clone(a.Payload)
			binary.BigEndian.PutUint32(badCount, math.MaxUint32)
			binary.BigEndian.PutUint32(badLength[4:], math.MaxUint32)
			for _, input := range [][]byte{nil, a.Payload[:3], a.Payload[:len(a.Payload)-1], append(bytes.Clone(a.Payload), 0), badCount, badLength, authFrame(t, f[:len(f)-1]), authFrame(t, append(f, f[0])), []byte(`{"amount":1,"amount":2}`), make([]byte, MaxActionPayloadBytes+1)} {
				_, err := DecodeActionPayload(tc.kind, input)
				actionReject(t, err)
			}
			for _, index := range tc.numeric {
				for _, width := range []int{0, 1, 3, 5, 8} {
					fields := authFields(t, a.Payload, tc.count)
					fields[index] = make([]byte, width)
					_, err := DecodeActionPayload(tc.kind, authFrame(t, fields))
					actionReject(t, err)
				}
			}
			for _, field := range []int{0, 1} {
				fields := authFields(t, a.Payload, tc.count)
				fields[field][len(fields[field])-1] ^= 1
				_, err := DecodeActionPayload(tc.kind, authFrame(t, fields))
				actionReject(t, err)
			}
			wire, err := a.SigningBytes()
			authOK(t, err)
			for _, fee := range []uint64{0, 2, 1 << 32, math.MaxInt64, math.MaxUint64} {
				bad := a
				bad.Fee = fee
				_, err := bad.SigningBytes()
				actionReject(t, err)
				fields := authFields(t, wire, 12)
				fields[8], fields[9] = ynxbatch.U32(uint32(fee>>32)), ynxbatch.U32(uint32(fee))
				_, err = DecodeAction(authFrame(t, fields))
				actionReject(t, err)
			}
		})
	}
}

func TestInvoiceActionEveryFieldBoundsAndInvalidValues(t *testing.T) {
	for _, tc := range invoiceActionCases() {
		base := reflect.ValueOf(tc.payload)
		for i := 0; i < base.NumField(); i++ {
			name := base.Type().Field(i).Name
			var invalid, valid []any
			switch field := base.Field(i); field.Kind() {
			case reflect.Uint64:
				invalid = []any{uint64(0), uint64(math.MaxInt64) + 1, uint64(math.MaxUint64)}
				valid = []any{uint64(1), uint64(1 << 32), uint64(9007199254740993), uint64(math.MaxInt64)}
			case reflect.Slice:
				invalid = []any{[]byte(nil), make([]byte, 32), bytes.Repeat([]byte{1}, 31), bytes.Repeat([]byte{1}, 33)}
				valid = []any{append(make([]byte, 31), 1)}
			case reflect.String:
				switch name {
				case "InvoiceID", "SessionID", "RefundID":
					invalid = []any{"", "Invoice", ".id", "id ", " id", "a b", "id\n", "a\x00b", "发票", "\xff", strings.Repeat("a", 65)}
					valid = []any{"a", "0", "a._:-9", strings.Repeat("a", 64)}
				case "Recipient", "Payer", "Merchant":
					invalid = []any{qaTo + " ", strings.ToUpper(qaTo), "ynx1not-a-canonical-address", qaTo[:41], qaTo + "0"}
					valid = []any{qaTo, qaFrom}
					if name == "Payer" {
						valid = append(valid, "")
					} else {
						invalid = append(invalid, "")
					}
				case "AssetID":
					invalid = []any{"", "ynxt", "YNX", "asset-test", "YNXT "}
				case "UnitVersion":
					invalid = []any{"", "01", "2", "1 "}
				case "FeeRule":
					invalid = []any{"", "native-transfer-fee-one/v2", "native-transfer-fee-one/v1 ", "1"}
				}
			}
			for j, value := range append(append([]any(nil), invalid...), valid...) {
				t.Run(fmt.Sprintf("%s/%s/%d", tc.name, name, j), func(t *testing.T) {
					p := reflect.New(base.Type()).Elem()
					p.Set(base)
					p.Field(i).Set(reflect.ValueOf(value))
					wire, err := EncodeActionPayload(tc.kind, p.Interface())
					if j < len(invalid) {
						actionReject(t, err)
						_, err = DecodeActionPayload(tc.kind, invoiceUncheckedPayload(t, tc, p.Interface()))
						actionReject(t, err)
						return
					}
					authOK(t, err)
					decoded, err := DecodeActionPayload(tc.kind, wire)
					authOK(t, err)
					if !reflect.DeepEqual(decoded, p.Interface()) {
						t.Fatal("valid field was narrowed or normalized")
					}
				})
			}
		}
	}
}

func TestInvoiceActionRealDualSignatureBindsAllFields(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f) // Genuine legacy approval and fresh dual-key PoP.
	cases := invoiceActionCases()
	messages := make([][]byte, len(cases)) // Four messages: original v0.1 power-of-two N.
	for i, tc := range cases {
		a := invoiceVectorAction(t, tc)
		a.ChainID, a.Owner = bytes.Clone(state.NetworkID), f.owner
		var err error
		messages[i], err = a.SigningBytes()
		authOK(t, err)
	}
	batch, err := ynxbatch.BatchSign(f.first, ynxbatch.Metadata{ChainID: state.NetworkID, Owner: f.owner, Purpose: TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	authOK(t, err)
	defer batch.Discard()
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			member, err := ynxbatch.Extract(batch, uint32(i))
			authOK(t, err)
			wire, err := ynxbatch.EncodeMember(member)
			authOK(t, err)
			authOK(t, state.VerifyMember(f.owner, TransactionPurpose, messages[i], wire, 20))
			authReject(t, state.VerifyMember(f.owner, TransactionPurpose, messages[i], wire, 19))
			authReject(t, state.VerifyMember(qaTo, TransactionPurpose, messages[i], wire, 20))
			authReject(t, state.VerifyMember(f.owner, MigrationPurpose, messages[i], wire, 20))
			for j, other := range cases {
				if other.kind == tc.kind {
					continue
				}
				m, err := ynxbatch.DecodeMember(wire)
				authOK(t, err)
				m.Message = bytes.Clone(messages[j]) // Another valid canonical action, same batch.
				forged, err := ynxbatch.EncodeMember(m)
				authOK(t, err)
				authReject(t, state.VerifyMember(f.owner, TransactionPurpose, messages[j], forged, 20))
			}
			// Every complete inner field is committed, including empty optional
			// payer and the fixed domain/version/unit/asset/fee rule.
			for field := 0; field < tc.count; field++ {
				outer := authFields(t, messages[i], 12)
				inner := authFields(t, outer[11], tc.count)
				if len(inner[field]) == 0 {
					inner[field] = []byte{1}
				} else {
					inner[field][len(inner[field])-1] ^= 1
				}
				outer[11] = authFrame(t, inner)
				changed := authFrame(t, outer)
				m, err := ynxbatch.DecodeMember(wire)
				authOK(t, err)
				m.Message = changed
				forged, err := ynxbatch.EncodeMember(m)
				authOK(t, err)
				authReject(t, state.VerifyMember(f.owner, TransactionPurpose, changed, forged, 20))
			}
			for field := 0; field < 11; field++ {
				outer := authFields(t, messages[i], 12)
				outer[field][len(outer[field])-1] ^= 1
				changed := authFrame(t, outer)
				m, err := ynxbatch.DecodeMember(wire)
				authOK(t, err)
				m.Message = changed
				forged, err := ynxbatch.EncodeMember(m)
				authOK(t, err)
				authReject(t, state.VerifyMember(f.owner, TransactionPurpose, changed, forged, 20))
			}
			for _, part := range []string{"signature A", "signature B", "path A", "path B", "index", "network"} {
				m, err := ynxbatch.DecodeMember(wire)
				authOK(t, err)
				switch part {
				case "signature A":
					m.Certificate.SigmaA[0] ^= 1
				case "signature B":
					m.Certificate.SigmaB[0] ^= 1
				case "path A":
					m.PathA[0][0] ^= 1
				case "path B":
					m.PathB[0][0] ^= 1
				case "index":
					m.Index ^= 1
				case "network":
					m.Certificate.ChainID[0] ^= 1
				}
				forged, err := ynxbatch.EncodeMember(m)
				authOK(t, err)
				if err := state.VerifyMember(f.owner, TransactionPurpose, messages[i], forged, 20); err == nil {
					t.Fatalf("invoice accepted corrupted %s", part)
				}
			}
			authOK(t, state.VerifyMember(f.owner, TransactionPurpose, messages[i], wire, 20))
		})
	}
	// This is signature/policy verification only. Expiry, payer/merchant roles,
	// epoch/revision, terms hash, slot occupancy, fee limits and refund totals
	// still require the ledger's actual current state; no execution is asserted.
}
