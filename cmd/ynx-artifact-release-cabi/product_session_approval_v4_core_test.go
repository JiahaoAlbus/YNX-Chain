package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type approvalV4CExpected struct{ Network, Owner, PKA, PKB, Revision walletAliasSpan }
type approvalV4CRequest struct {
	Version              uint32
	Size                 uintptr
	E5                   walletAliasSpan
	Expected             approvalV4CExpected
	DERA, DERB, PKA, PKB walletAliasSpan
}

func approvalV4TestMessage(t *testing.T, e ynxbatch.ProductSessionApprovalV4Binding) []byte {
	t.Helper()
	account, err := accountaddress.Encode(e.Owner)
	if err != nil {
		t.Fatal("synthetic account")
	}
	r := map[string]any{"version": "4", "chainId": "ynx_6423-1", "productId": "wallet", "clientId": "com.ynx.wallet.android", "platform": "android", "applicationId": "com.ynx.wallet", "bundleId": nil, "packageId": "com.ynx.wallet", "origin": "app://android/com.ynx.wallet", "callback": "ynxwallet://callback", "deviceId": "PUBLIC-device-v4", "deviceAlgorithm": ynxbatch.Suite, "deviceRegistrationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "deviceRegistrationRevision": "1", "deviceRegistrationDigest": strings.Repeat("a", 64), "nonce": strings.Repeat("A", 32), "state": strings.Repeat("B", 32), "scopes": []string{"profile.read"}, "purpose": "PUBLIC synthetic account review", "issuedAt": "2026-11-13T08:00:00.000Z", "expiresAt": "2026-11-13T08:05:00.000Z"}
	rb, _ := json.Marshal(r)
	digest := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_REQUEST_V4\n"), rb...))
	a := map[string]any{}
	for k, v := range r {
		if k != "purpose" {
			a[k] = v
		}
	}
	a["account"], a["result"], a["requestDigest"], a["issuedAt"] = account, "approved", hex.EncodeToString(digest[:]), "2026-11-13T08:00:01.000Z"
	a["accountAuthorization"] = map[string]any{"policyVersion": "YNX-ACCOUNT-POLICY/v1", "algorithmVersion": ynxbatch.Version, "networkId": hex.EncodeToString(e.NetworkID), "canonicalOwner": e.Owner, "revision": e.KeyRevision, "registeredAt": "0", "activeFrom": "1", "pkA": hex.EncodeToString(e.PKA), "pkB": hex.EncodeToString(e.PKB)}
	body, _ := json.Marshal(map[string]any{"approval": a, "request": r})
	msg, err := ynxbatch.EncodeFields([]byte(ynxbatch.ProductSessionApprovalV4MessageVersion), ynxbatch.U32(4), e.NetworkID, []byte(e.Owner), body)
	if err != nil {
		t.Fatal("synthetic fixed E5")
	}
	return msg
}
func approvalV4TestBinding() ynxbatch.ProductSessionApprovalV4Binding {
	return ynxbatch.ProductSessionApprovalV4Binding{NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: "0x" + strings.Repeat("11", 20), PKA: bytes.Repeat([]byte{0x31}, 2592), PKB: bytes.Repeat([]byte{0x32}, 64), KeyRevision: "18446744073709551615"}
}

// Calls the actual Go-exported C entrypoint using its actual reflected C types.
// This is CGO package coverage, not an external Android/foreign-C link claim.
func approvalV4Call(r *approvalV4CRequest, out []byte, capacity uintptr, n *uintptr, clean *uint32) resultCode {
	f := reflect.ValueOf(YNXProductSessionApprovalSignV4)
	var rp, bp, lp, cp reflect.Value
	ptr := func(typ reflect.Type, p unsafe.Pointer) reflect.Value {
		if p == nil {
			return reflect.Zero(typ)
		}
		return reflect.NewAt(typ.Elem(), p)
	}
	rp = ptr(f.Type().In(0), unsafe.Pointer(r))
	var b unsafe.Pointer
	if len(out) > 0 {
		b = unsafe.Pointer(&out[0])
	}
	bp = ptr(f.Type().In(1), b)
	lp = ptr(f.Type().In(3), unsafe.Pointer(n))
	cp = ptr(f.Type().In(4), unsafe.Pointer(clean))
	got := resultCode(f.Call([]reflect.Value{rp, bp, reflect.ValueOf(capacity).Convert(f.Type().In(2)), lp, cp})[0].Int())
	runtime.KeepAlive(r)
	runtime.KeepAlive(out)
	return got
}
func approvalV4AllocatedRequest(msg []byte, e ynxbatch.ProductSessionApprovalV4Binding, m ynxbatch.KeyMaterial) (*approvalV4CRequest, []byte) {
	// All borrowed inputs occupy disjoint subregions of ONE caller allocation.
	// DER A and B are adjacent. Expected/supplied public pair may intentionally alias.
	arena := make([]byte, len(msg)+32+42+2592+64+len(e.KeyRevision)+54+150+2592)
	offset := 0
	take := func(b []byte, n int) walletAliasSpan {
		copy(arena[offset:offset+n], b)
		s := walletAliasSpan{unsafe.Pointer(&arena[offset]), uintptr(n)}
		offset += n
		return s
	}
	r := &approvalV4CRequest{Version: 4, Size: unsafe.Sizeof(approvalV4CRequest{})}
	r.E5 = take(msg, len(msg))
	r.Expected = approvalV4CExpected{take(e.NetworkID, 32), take([]byte(e.Owner), 42), take(e.PKA, 2592), take(e.PKB, 64), take([]byte(e.KeyRevision), len(e.KeyRevision))}
	r.DERA = take(m.PKCS8A, 54)
	r.DERB = take(m.PKCS8B, 150)
	r.PKA, r.PKB = r.Expected.PKA, r.Expected.PKB
	return r, arena
}
func TestProductSessionApprovalV4ActualCGOAndAND(t *testing.T) {
	key, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal("synthetic KeyGen")
	}
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	if err != nil {
		t.Fatal("synthetic export")
	}
	defer material.Clear()
	e := approvalV4TestBinding()
	e.PKA, e.PKB = pub.PKA, pub.PKB
	msg := approvalV4TestMessage(t, e)
	plan, code := prepareProductApprovalV4(msg, e, productApprovalV4Capacity)
	if code != resultOK {
		t.Fatal("fixed plan refused")
	}
	r, arena := approvalV4AllocatedRequest(msg, e, material)
	defer clear(arena)
	before := bytes.Clone(arena)
	defer clear(before)
	out := bytes.Repeat([]byte{0xa5}, productApprovalV4Capacity)
	defer clear(out)
	n, clean := uintptr(999), uint32(999)
	if r.Size != 176 || reflect.TypeOf(YNXProductSessionApprovalSignV4).In(0).Elem().Size() != r.Size {
		t.Fatal("actual C request layout")
	}
	rc := approvalV4Call(r, out, uintptr(len(out)), &n, &clean)
	if rc != resultOK || clean != uint32(cleanupLogicalComplete) || n == 0 || n > uintptr(len(out)) {
		t.Fatalf("actual fixed call rc=%d cleanup=%d bytes=%d", rc, clean, n)
	}
	if !bytes.Equal(arena, before) {
		t.Fatal("borrow changed")
	}
	member := bytes.Clone(out[:n])
	defer clear(member)
	if verifyProductApprovalV4AND(member, plan) != nil {
		t.Fatal("actual AND verification")
	}
	decoded, err := ynxbatch.InspectProductSessionApprovalV4Member(member, msg, e)
	if err != nil || decoded.Certificate.N != 1 || decoded.Index != 0 {
		t.Fatal("exact N1 index0")
	}
	for _, kind := range []string{"branchA", "branchB", "purpose", "message", "pairA", "pairB", "revision"} {
		t.Run(kind, func(t *testing.T) {
			bad, _ := ynxbatch.DecodeMember(member)
			p := productApprovalV4Plan{message: bytes.Clone(plan.message), expected: copyApprovalV4Binding(plan.expected)}
			switch kind {
			case "branchA":
				bad.Certificate.SigmaA[0] ^= 1
			case "branchB":
				bad.Certificate.SigmaB[0] ^= 1
			case "purpose":
				bad.Certificate.Purpose = "TX"
			case "message":
				bad.Message[len(bad.Message)-1] ^= 1
			case "pairA":
				p.expected.PKA[0] ^= 1
			case "pairB":
				p.expected.PKB[0] ^= 1
			case "revision":
				p.expected.KeyRevision = "1"
			}
			raw, er := ynxbatch.EncodeMember(bad)
			if er == nil && verifyProductApprovalV4AND(raw, p) == nil {
				t.Fatal("changed AND/binding accepted")
			}
		})
	}
	for _, kind := range []string{"DER-A-OID", "DER-A-seed", "DER-B-seed", "DER-B-root", "public-A", "public-B"} {
		t.Run(kind, func(t *testing.T) {
			bad := ynxbatch.KeyMaterial{PKCS8A: bytes.Clone(material.PKCS8A), PKCS8B: bytes.Clone(material.PKCS8B), PKA: bytes.Clone(material.PKA), PKB: bytes.Clone(material.PKB)}
			defer bad.Clear()
			expectedClean := cleanupLogicalComplete
			switch kind {
			case "DER-A-OID":
				bad.PKCS8A[18] ^= 1
			case "DER-A-seed":
				bad.PKCS8A[53] ^= 1
			case "DER-B-seed":
				bad.PKCS8B[22] ^= 1
			case "DER-B-root":
				bad.PKCS8B[149] ^= 1
			case "public-A":
				bad.PKA[0] ^= 1
				expectedClean = cleanupNotRequired
			case "public-B":
				bad.PKB[0] ^= 1
				expectedClean = cleanupNotRequired
			}
			raw, rc, c := signProductApprovalV4(plan, bad)
			if len(raw) != 0 || rc != resultKeyMaterial || c != expectedClean {
				t.Fatalf("invalid material rc=%d cleanup=%d bytes=%d", rc, c, len(raw))
			}
		})
	}
	t.Run("postcondition-firstcause-and-cleanup-partial", func(t *testing.T) {
		steps := 0
		raw, rc, c := signProductApprovalV4WithChecks(plan, material, &productApprovalV4Checks{postcondition: func([]byte, productApprovalV4Plan) error { return errors.New("public test refusal") }, cleanup: func(fs ...func()) bool {
			for _, f := range fs {
				f()
				steps++
			}
			return false
		}})
		defer clear(raw)
		if rc != resultOutputValidation || c != cleanupFailed || steps != 3 || len(raw) == 0 {
			t.Fatalf("lost firstcause/partial rc=%d cleanup=%d steps=%d bytes=%d", rc, c, steps, len(raw))
		}
		if verifyProductApprovalV4AND(raw, plan) != nil {
			t.Fatal("produced partial was not actual member")
		}
		retained := make([]byte, productApprovalV4Capacity)
		defer clear(retained)
		written, final := retainDeviceHTTPOutcome(retained, raw, rc, c)
		if written != len(raw) || final != resultOutputValidation || !bytes.Equal(retained[:written], raw) {
			t.Fatal("caller cannot retain partial first")
		}
	})
	t.Run("panic-after-production-retains-partial", func(t *testing.T) {
		raw, rc, c := signProductApprovalV4WithChecks(plan, material, &productApprovalV4Checks{postcondition: func([]byte, productApprovalV4Plan) error { panic("public test panic") }})
		defer clear(raw)
		if rc != resultInternal || c != cleanupUnknown || len(raw) == 0 {
			t.Fatal("panic partial/unknown lost")
		}
	})
	runtime.KeepAlive(arena)
}
func TestProductSessionApprovalV4MemoryAndPublicPreflight(t *testing.T) {
	e := approvalV4TestBinding()
	msg := approvalV4TestMessage(t, e)
	out := bytes.Repeat([]byte{0xa5}, productApprovalV4Capacity+32)
	cases := []string{"public-before-private", "bad-version", "bad-struct", "capacity-low", "capacity-high", "null-request", "null-buffer", "null-length", "null-cleanup", "zero-message", "zero-private", "null-private", "extent-overflow", "private-request", "length-request", "private-B-public", "output-request", "length-buffer", "cleanup-buffer", "length-cleanup", "length-unaligned", "cleanup-unaligned"}
	for i := 0; i < 8; i++ {
		cases = append(cases, "private-public-"+string(rune('0'+i)))
	}
	for _, kind := range cases {
		t.Run(kind, func(t *testing.T) {
			r, arena := approvalV4AllocatedRequest(msg, e, ynxbatch.KeyMaterial{})
			defer clear(arena)
			// Private DER is deliberately invalid. No success or signer occurs here.
			public := []*walletAliasSpan{&r.E5, &r.Expected.Network, &r.Expected.Owner, &r.Expected.PKA, &r.Expected.PKB, &r.Expected.Revision, &r.PKA, &r.PKB}
			r.Expected.Revision.Data = unsafe.Pointer(&arena[0]) // wrong public revision before any import
			n, c := uintptr(777), uint32(999)
			np, cp := &n, &c
			buffer := out[:productApprovalV4Capacity]
			capacity := uintptr(len(buffer))
			want := resultPublicBinding
			layout := true
			switch kind {
			case "public-before-private":
				layout = false
			case "bad-version":
				r.Version = 3
				want = resultInvalidArgument
			case "bad-struct":
				r.Size--
				want = resultInvalidArgument
			case "capacity-low":
				capacity--
				want = resultCapacity
			case "capacity-high":
				capacity++
				want = resultCapacity
			case "null-request":
				r = nil
				want = resultInvalidArgument
			case "null-buffer":
				buffer = nil
				want = resultInvalidArgument
			case "null-length":
				np = nil
				want = resultInvalidArgument
			case "null-cleanup":
				cp = nil
				want = resultInvalidArgument
			case "zero-message":
				r.E5.Size = 0
				want = resultBounds
			case "zero-private":
				r.DERA.Size = 0
				want = resultBounds
			case "null-private":
				r.DERA.Data = nil
				want = resultBounds
			case "extent-overflow":
				r.DERA.Data = unsafe.Pointer(^uintptr(0) - 8)
				want = resultBounds
			case "private-request":
				r.DERA.Data = unsafe.Pointer(r)
				want = resultOverlap
			case "length-request":
				np = &r.Size
				want = resultOverlap
			case "private-B-public":
				r.Expected.PKA.Data = r.DERB.Data
				want = resultOverlap
			case "output-request":
				r.E5 = walletAliasSpan{unsafe.Pointer(&buffer[0]), 16}
				want = resultOverlap
			case "length-buffer":
				np = (*uintptr)(unsafe.Pointer(&buffer[0]))
				want = resultOverlap
			case "cleanup-buffer":
				cp = (*uint32)(unsafe.Pointer(&buffer[0]))
				want = resultOverlap
			case "length-cleanup":
				cp = (*uint32)(unsafe.Pointer(&n))
				want = resultOverlap
			case "length-unaligned":
				np = (*uintptr)(unsafe.Pointer(&buffer[1]))
				want = resultBounds
			case "cleanup-unaligned":
				cp = (*uint32)(unsafe.Pointer(&buffer[1]))
				want = resultBounds
			default:
				i := int(kind[len(kind)-1] - '0')
				public[i].Data = r.DERA.Data
				want = resultOverlap
			}
			before := bytes.Clone(out)
			input := bytes.Clone(arena)
			defer clear(input)
			rc := approvalV4Call(r, buffer, capacity, np, cp)
			if rc != want {
				t.Fatalf("refusal rc=%d want=%d", rc, want)
			}
			if !bytes.Equal(out, before) || !bytes.Equal(arena, input) {
				t.Fatal("refusal mutated caller storage")
			}
			if layout {
				if n != 777 || c != 999 {
					t.Fatal("layout refusal wrote scalars")
				}
			} else if n != 0 || c != uint32(cleanupNotRequired) {
				t.Fatal("public preflight did not report not-required cleanup")
			}
			runtime.KeepAlive(arena)
		})
	}
	t.Run("private-private-alias-is-not-layout-authority", func(t *testing.T) {
		r, arena := approvalV4AllocatedRequest(msg, e, ynxbatch.KeyMaterial{})
		defer clear(arena)
		r.DERA.Data = r.DERB.Data
		n, c := uintptr(0), uint32(0)
		if got := approvalV4Call(r, out[:productApprovalV4Capacity], productApprovalV4Capacity, &n, &c); got != resultKeyMaterial || n != 0 || c != uint32(cleanupLogicalComplete) {
			t.Fatalf("private alias rc=%d cleanup=%d", got, c)
		}
		runtime.KeepAlive(arena)
	})
	t.Run("same-allocation-adjacent-private-and-public-alias-legal", func(t *testing.T) {
		r, arena := approvalV4AllocatedRequest(msg, e, ynxbatch.KeyMaterial{})
		defer clear(arena)
		n, c := uintptr(0), uint32(0)
		if got := approvalV4Call(r, out[:productApprovalV4Capacity], productApprovalV4Capacity, &n, &c); got != resultKeyMaterial || n != 0 || c != uint32(cleanupLogicalComplete) {
			t.Fatalf("legal allocation rejected rc=%d cleanup=%d", got, c)
		}
		runtime.KeepAlive(arena)
	})
}
