package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
	"unsafe"
)

func pendingQueryPUBLICJSON(t *testing.T, x any) []byte {
	t.Helper()
	raw, err := json.Marshal(x)
	must(t, err)
	return raw
}
func pendingQueryPUBLICInputs(t *testing.T, p ynxbatch.PublicKey) pendingQueryInputs {
	t.Helper()
	owner := "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
	actor := map[string]any{"networkId": strings.Repeat("ab", 32), "canonicalOwner": owner, "productId": "developer", "clientId": "com.ynx.developer.macos", "platform": "macos", "applicationId": "com.ynx.developer", "bundleId": "com.ynx.developer", "packageId": nil, "origin": "https://developer.ynxweb4.com", "callback": "ynxdeveloper://callback", "deviceId": "PUBLIC-pending-device"}
	d := sha256.Sum256(pendingQueryPUBLICJSON(t, actor))
	r := map[string]any{}
	for k, v := range actor {
		r[k] = v
	}
	for k, v := range map[string]any{"version": "4", "registrationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "revision": "18446744073709551615", "generation": "18446744073709551615", "pkA": hex.EncodeToString(p.PKA), "pkB": hex.EncodeToString(p.PKB), "registeredAt": "2026-11-01T07:00:00.000Z", "expiresAt": "2026-11-01T09:00:00.000Z", "revokedAt": nil} {
		r[k] = v
	}
	registration := pendingQueryPUBLICJSON(t, r)
	// The retained POST is PUBLIC syntactic DATA, not a real account approval
	// or an invented protected row. Only the new query proof does real math.
	post := pendingQueryPUBLICJSON(t, map[string]any{"operationId": strings.Repeat("a", 64), "registrationOriginal": string(registration), "registrationMember": "PUBLIC-old-post-no-grant", "request": map[string]any{}, "approval": map[string]any{}})
	h := sha256.Sum256(post)
	q := pendingQueryPUBLICJSON(t, map[string]any{"version": "1", "operationId": strings.Repeat("a", 64), "originalRequestBodyDigest": hex.EncodeToString(h[:])})
	instant, err := time.Parse(time.RFC3339Nano, "2026-11-01T08:00:00.000Z")
	must(t, err)
	at := uint64(instant.UnixMilli())
	return pendingQueryInputs{q, registration, post, ynxbatch.ProductPairPendingOriginalQueryBinding{NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: owner, PKA: bytes.Clone(p.PKA), PKB: bytes.Clone(p.PKB), ActorDigest: hex.EncodeToString(d[:]), Origin: "https://wallet-auth.ynxweb4.com", Nonce: strings.Repeat("n", 43), IssuedAt: "2026-11-01T08:00:00.000Z", ExpiresAt: "2026-11-01T08:00:30.000Z", AtMS: at, SourceIssuedAtMS: at - 60000, SourceExpiresAtMS: at + 60000}}
}

func TestPendingOriginalQueryCABIPUBLICPreflightBeforePrivateRead(t *testing.T) {
	in := pendingQueryPUBLICInputs(t, ynxbatch.PublicKey{PKA: bytes.Repeat([]byte{0x31}, 2592), PKB: bytes.Repeat([]byte{0x32}, 64)})
	for _, cap := range []uint64{0, pendingQueryCapacity - 1, pendingQueryCapacity + 1} {
		if _, code := preparePendingQuery(in, cap); code != resultCapacity {
			t.Fatal("capacity admitted", code)
		}
	}
	for name, change := range map[string]func(*pendingQueryInputs){
		"query-unknown-session": func(x *pendingQueryInputs) {
			x.query = append([]byte(`{"sessionBinding":"`+strings.Repeat("0", 64)+`",`), x.query[1:]...)
		},
		"empty-post":     func(x *pendingQueryInputs) { x.originalPair = nil },
		"post-bounds":    func(x *pendingQueryInputs) { x.originalPair = make([]byte, 393217) },
		"post-digest":    func(x *pendingQueryInputs) { x.originalPair = append(bytes.Clone(x.originalPair), ' ') },
		"actor":          func(x *pendingQueryInputs) { x.expected.ActorDigest = strings.Repeat("c", 64) },
		"network":        func(x *pendingQueryInputs) { x.expected.NetworkID = make([]byte, 32) },
		"different-pair": func(x *pendingQueryInputs) { x.expected.PKB = make([]byte, 64) },
	} {
		t.Run(name, func(t *testing.T) {
			x := in
			change(&x)
			if _, code := preparePendingQuery(x, pendingQueryCapacity); code == resultOK {
				t.Fatal("invalid public input admitted")
			}
		})
	}
}

// One fresh synthetic pair is reused through all mathematical and Cgo cases.
// No persistent/user key, registered Source, SQL row, HTTP call or session is
// created. Cleanup never logs or formats material.
func TestPendingOriginalQueryCABIPUBLICActualANDAndTypedBridge(t *testing.T) {
	key, pub, err := ynxbatch.KeyGen()
	must(t, err)
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	must(t, err)
	defer material.Clear()
	before := cloneMaterial(material)
	defer before.Clear()
	in := pendingQueryPUBLICInputs(t, pub)
	plan, code := preparePendingQuery(in, pendingQueryCapacity)
	if code != resultOK {
		t.Fatal("prepare", code)
	}
	var wire []byte
	t.Run("both-real-branches-and-no-other-purpose", func(t *testing.T) {
		var clean cleanupCode
		wire, code, clean = signPendingQueryPrepared(plan, material)
		if code != resultOK || clean != cleanupLogicalComplete {
			t.Fatal("AND sign", code, clean)
		}
		must(t, inspectPendingQuery(plan, wire))
		m, err := ynxbatch.DecodeMember(wire)
		must(t, err)
		if m.Certificate.Purpose != ynxbatch.ProductPairPendingOriginalQueryPurpose || m.Certificate.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 {
			t.Fatal("fixed N1 query context")
		}
		for _, branch := range []string{"A", "B", "purpose", "message"} {
			bad, err := ynxbatch.DecodeMember(wire)
			must(t, err)
			switch branch {
			case "A":
				bad.Certificate.SigmaA[0] ^= 1
			case "B":
				bad.Certificate.SigmaB[0] ^= 1
			case "purpose":
				bad.Certificate.Purpose = ynxbatch.ProductSessionHTTPPurpose
			case "message":
				bad.Message[len(bad.Message)-1] ^= 1
			}
			raw, err := ynxbatch.EncodeMember(bad)
			must(t, err)
			if inspectPendingQuery(plan, raw) == nil {
				t.Fatal("corrupted branch or cross-purpose accepted", branch)
			}
		}
		if _, err = ynxbatch.InspectProductSessionHTTPMember(wire, ynxbatch.ProductSessionHTTPBinding{NetworkID: in.expected.NetworkID, Owner: in.expected.Owner, PKA: pub.PKA, PKB: pub.PKB}, in.query); err == nil {
			t.Fatal("pending query became HTTP session proof")
		}
	})
	defer clear(wire)
	t.Run("owned-public-plan-and-borrow-preserved", func(t *testing.T) {
		in.query[0] ^= 1
		in.registration[0] ^= 1
		in.originalPair[0] ^= 1
		in.expected.PKA[0] ^= 1
		must(t, inspectPendingQuery(plan, wire))
		equalMaterial(t, material, before)
	})
	t.Run("wrong-private-material-no-retained-handle", func(t *testing.T) {
		bad := cloneMaterial(material)
		defer bad.Clear()
		clear(bad.PKCS8A)
		out, code, clean := signPendingQueryPrepared(plan, bad)
		if len(out) != 0 || code != resultKeyMaterial || clean != cleanupLogicalComplete {
			t.Fatal("private failure retained handle or output", code, clean)
		}
	})
	t.Run("late-failure-preserves-original-and-first-cause", func(t *testing.T) {
		calls := 0
		out, code, clean := signPendingQueryPreparedWithChecks(plan, material, &pendingQueryChecks{inspect: func(p pendingQueryPlan, b []byte) error {
			must(t, inspectPendingQuery(p, b))
			return errors.New("PUBLIC postcondition failure")
		}, cleanup: func(fs ...func()) bool { calls = len(fs); runLogicalCleanup(fs...); return false }})
		defer clear(out)
		if len(out) == 0 || code != resultOutputValidation || clean != cleanupFailed || calls != 3 {
			t.Fatal("first cause/original/cleanup lost", code, clean, calls)
		}
		buffer := make([]byte, pendingQueryCapacity)
		n, final := retainDeviceHTTPOutcome(buffer, out, code, clean)
		if n != len(out) || final != resultOutputValidation || !bytes.Equal(buffer[:n], out) {
			t.Fatal("UNKNOWN original discarded")
		}
	})
	t.Run("actual-exported-Cgo-call", func(t *testing.T) { pendingQueryPUBLICBridgeExercise(t, plan, material) })
	equalMaterial(t, material, before)
}

type pendingQueryPUBLICSpan struct {
	Pointer unsafe.Pointer
	Length  uintptr
}
type pendingQueryPUBLICExpected struct {
	Network, Owner, A, B, Actor, Origin, Nonce, Issued, Expires pendingQueryPUBLICSpan
	AtMS, SourceIssuedAtMS, SourceExpiresAtMS                   uint64
}
type pendingQueryPUBLICRequest struct {
	Version                              uint32
	Size                                 uintptr
	Query, Registration, Pair            pendingQueryPUBLICSpan
	Expected                             pendingQueryPUBLICExpected
	PrivateA, PrivateB, PublicA, PublicB pendingQueryPUBLICSpan
}

func pendingQueryPUBLICSpanOf(b []byte) pendingQueryPUBLICSpan {
	return pendingQueryPUBLICSpan{unsafe.Pointer(unsafe.SliceData(b)), uintptr(len(b))}
}
func pendingQueryPUBLICCall(r *pendingQueryPUBLICRequest, b []byte, cap uintptr, n *uintptr, cleanup *uint32) int32 {
	f := reflect.ValueOf(YNXProductPairPendingOriginalQuerySignV1)
	p := func(index int, ptr unsafe.Pointer) reflect.Value {
		if ptr == nil {
			return reflect.Zero(f.Type().In(index))
		}
		return reflect.NewAt(f.Type().In(index).Elem(), ptr)
	}
	out := f.Call([]reflect.Value{p(0, unsafe.Pointer(r)), p(1, unsafe.Pointer(unsafe.SliceData(b))), reflect.ValueOf(cap).Convert(f.Type().In(2)), p(3, unsafe.Pointer(n)), p(4, unsafe.Pointer(cleanup))})
	runtime.KeepAlive(r)
	runtime.KeepAlive(b)
	return int32(out[0].Int())
}
func pendingQueryPUBLICBridgeExercise(t *testing.T, plan pendingQueryPlan, m ynxbatch.KeyMaterial) {
	t.Helper()
	i := plan.inputs
	e := i.expected
	actor, err := hex.DecodeString(e.ActorDigest)
	must(t, err)
	r := pendingQueryPUBLICRequest{Version: 1, Size: unsafe.Sizeof(pendingQueryPUBLICRequest{}), Query: pendingQueryPUBLICSpanOf(i.query), Registration: pendingQueryPUBLICSpanOf(i.registration), Pair: pendingQueryPUBLICSpanOf(i.originalPair), Expected: pendingQueryPUBLICExpected{pendingQueryPUBLICSpanOf(e.NetworkID), pendingQueryPUBLICSpanOf([]byte(e.Owner)), pendingQueryPUBLICSpanOf(e.PKA), pendingQueryPUBLICSpanOf(e.PKB), pendingQueryPUBLICSpanOf(actor), pendingQueryPUBLICSpanOf([]byte(e.Origin)), pendingQueryPUBLICSpanOf([]byte(e.Nonce)), pendingQueryPUBLICSpanOf([]byte(e.IssuedAt)), pendingQueryPUBLICSpanOf([]byte(e.ExpiresAt)), e.AtMS, e.SourceIssuedAtMS, e.SourceExpiresAtMS}, PrivateA: pendingQueryPUBLICSpanOf(m.PKCS8A), PrivateB: pendingQueryPUBLICSpanOf(m.PKCS8B), PublicA: pendingQueryPUBLICSpanOf(m.PKA), PublicB: pendingQueryPUBLICSpanOf(m.PKB)}
	if r.Size != 296 || reflect.TypeOf(YNXProductPairPendingOriginalQuerySignV1).In(0).Elem().Size() != r.Size {
		t.Fatal("ABI64 request shape")
	}
	buffer := bytes.Repeat([]byte{0xa5}, pendingQueryCapacity+16)
	n, cleanup := uintptr(777), uint32(999)
	shared := make([]byte, ynxbatch.MaxProductPairPendingOriginalBodyBytes)
	for publicIndex := 0; publicIndex < 14; publicIndex++ {
		for secretIndex := 0; secretIndex < 2; secretIndex++ {
			x := r
			spans := []*pendingQueryPUBLICSpan{&x.Query, &x.Registration, &x.Pair, &x.Expected.Network, &x.Expected.Owner, &x.Expected.A, &x.Expected.B, &x.Expected.Actor, &x.Expected.Origin, &x.Expected.Nonce, &x.Expected.Issued, &x.Expected.Expires, &x.PublicA, &x.PublicB}
			spans[publicIndex].Pointer = unsafe.Pointer(&shared[0])
			if secretIndex == 0 {
				x.PrivateA = pendingQueryPUBLICSpanOf(shared[:54])
			} else {
				x.PrivateB = pendingQueryPUBLICSpanOf(shared[:150])
			}
			n, cleanup = 777, 999
			if got := pendingQueryPUBLICCall(&x, buffer, pendingQueryCapacity, &n, &cleanup); got != int32(resultOverlap) || n != 777 || cleanup != 999 || !bytes.Equal(buffer, bytes.Repeat([]byte{0xa5}, len(buffer))) {
				t.Fatal("actual public/private span overlap was read or wrote output", publicIndex, secretIndex, got)
			}
		}
	}
	for _, cap := range []uintptr{pendingQueryCapacity - 1, pendingQueryCapacity + 1} {
		n, cleanup = 777, 999
		if got := pendingQueryPUBLICCall(&r, buffer, cap, &n, &cleanup); got != int32(resultCapacity) || n != 777 || cleanup != 999 {
			t.Fatal("actual fixed capacity guard", got)
		}
	}
	if got := pendingQueryPUBLICCall(nil, buffer, pendingQueryCapacity, &n, &cleanup); got != int32(resultInvalidArgument) {
		t.Fatal("null request accepted", got)
	}
	for _, tc := range []struct {
		name   string
		edit   func(*pendingQueryPUBLICRequest)
		want   resultCode
		layout bool
	}{
		{"version", func(x *pendingQueryPUBLICRequest) { x.Version = 4 }, resultInvalidArgument, true},
		{"public-secret-alias", func(x *pendingQueryPUBLICRequest) { x.Query = pendingQueryPUBLICSpanOf(m.PKCS8A) }, resultOverlap, true},
		{"private-output-alias", func(x *pendingQueryPUBLICRequest) { x.PrivateA = pendingQueryPUBLICSpanOf(buffer[:54]) }, resultOverlap, true},
		{"private-request-alias", func(x *pendingQueryPUBLICRequest) { x.PrivateA = pendingQueryPUBLICSpan{unsafe.Pointer(x), 54} }, resultOverlap, true},
		{"invalid-body-before-private", func(x *pendingQueryPUBLICRequest) { x.Query = pendingQueryPUBLICSpanOf([]byte(`{}`)) }, resultPublicBinding, false},
		{"private-DER", func(x *pendingQueryPUBLICRequest) { x.PrivateB = pendingQueryPUBLICSpanOf(make([]byte, 150)) }, resultKeyMaterial, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			x := r
			tc.edit(&x)
			n, cleanup = 777, 999
			before := bytes.Clone(buffer)
			got := pendingQueryPUBLICCall(&x, buffer, pendingQueryCapacity, &n, &cleanup)
			if got != int32(tc.want) || !bytes.Equal(before, buffer) {
				t.Fatal("bridge failure", got)
			}
			if tc.layout {
				if n != 777 || cleanup != 999 {
					t.Fatal("layout wrote outputs")
				}
			} else if n != 0 || tc.want == resultPublicBinding && cleanup != uint32(cleanupNotRequired) || tc.want == resultKeyMaterial && cleanup != uint32(cleanupLogicalComplete) {
				t.Fatal("admitted cleanup state")
			}
		})
	}
	n, cleanup = 0, 0
	if got := pendingQueryPUBLICCall(&r, buffer, pendingQueryCapacity, &n, &cleanup); got != 0 || n == 0 || n > pendingQueryCapacity || cleanup != uint32(cleanupLogicalComplete) {
		t.Fatal("actual bridge sign", got)
	}
	must(t, inspectPendingQuery(plan, buffer[:n]))
	if !bytes.Equal(buffer[n:], bytes.Repeat([]byte{0xa5}, len(buffer)-int(n))) {
		t.Fatal("unused output written")
	}
	runtime.KeepAlive(plan)
	runtime.KeepAlive(m)
	runtime.KeepAlive(actor)
	runtime.KeepAlive(shared)
}

// Integer-only layout controls cannot read a private key or make an invalid C
// pointer safe. The final typed bridge separately checks each fixed span size.
func TestPendingOriginalQueryCABIPUBLICSecretPublicAliasBoundary(t *testing.T) {
	request := memoryRange{0x1000, 0x100}
	public := []memoryRange{{0x2000, 64}, {0x3000, 32}, {0x4000, 42}}
	private := []memoryRange{{0x5000, 54}, {0x6000, 150}}
	outputs := []memoryRange{{0x10000, 98304}, {0x30000, 8}, {0x40000, 4}}
	if code := checkPendingQueryLayout(request, public, private, outputs); code != resultOK {
		t.Fatal("disjoint public layout rejected", code)
	}
	requestAlias := append([]memoryRange(nil), private...)
	requestAlias[0].start = request.start
	if code := checkPendingQueryLayout(request, public, requestAlias, outputs); code != resultOverlap {
		t.Fatal("private/request alias accepted", code)
	}
	for i := range public {
		for j := range private {
			for _, start := range []uintptr{private[j].start, private[j].start + private[j].length - 1} {
				changed := append([]memoryRange(nil), public...)
				changed[i].start = start
				if code := checkPendingQueryLayout(request, changed, private, outputs); code != resultOverlap {
					t.Fatal("public/private overlap accepted", i, j, code)
				}
			}
		}
	}
	for i := range outputs {
		for _, input := range append(append([]memoryRange{request}, public...), private...) {
			changed := append([]memoryRange(nil), outputs...)
			changed[i].start = input.start
			if code := checkPendingQueryLayout(request, public, private, changed); code != resultOverlap {
				t.Fatal("output/input overlap accepted", i, code)
			}
		}
	}
	for _, invalid := range []memoryRange{{0, 32}, {^uintptr(0) - 15, 32}} {
		changed := append([]memoryRange(nil), public...)
		changed[0] = invalid
		if code := checkPendingQueryLayout(request, changed, private, outputs); code != resultBounds {
			t.Fatal("invalid public extent accepted", code)
		}
		secrets := append([]memoryRange(nil), private...)
		secrets[0] = invalid
		if code := checkPendingQueryLayout(request, public, secrets, outputs); code != resultBounds {
			t.Fatal("invalid private extent accepted", code)
		}
	}
	// Read-only same-category aliases and adjacent public/private extents stay
	// valid. Disjoint categories, not blanket input alias bans, are required.
	aliases := append([]memoryRange(nil), public...)
	aliases[1] = aliases[0]
	secrets := append([]memoryRange(nil), private...)
	secrets[1] = secrets[0]
	if code := checkPendingQueryLayout(request, aliases, secrets, outputs); code != resultOK {
		t.Fatal("same-category aliases rejected", code)
	}
	adjacent := append([]memoryRange(nil), public...)
	adjacent[0].start = private[0].start - adjacent[0].length
	if code := checkPendingQueryLayout(request, adjacent, private, outputs); code != resultOK {
		t.Fatal("adjacent extents rejected", code)
	}
}
