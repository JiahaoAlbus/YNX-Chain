package main

import (
	"bytes"
	"reflect"
	"runtime"
	"testing"
	"unsafe"
)

// PUBLIC allocation-only controls: no key generation, import, signing, account
// admission or synthetic authority. Call the actual exported Go/C ABI function
// using its reflected C types, as the existing migration bridge controls do.
type walletAliasSpan struct {
	Data unsafe.Pointer
	Size uintptr
}

type walletAliasTxExpected struct {
	Network, Owner             walletAliasSpan
	NativeChainID              uint64
	Revision, Height, PKA, PKB walletAliasSpan
}

type walletAliasTxRequest struct {
	Version                              uint32
	Size                                 uintptr
	Message, Policy                      walletAliasSpan
	Expected                             walletAliasTxExpected
	PrivateA, PrivateB, PublicA, PublicB walletAliasSpan
}

type walletAliasInitialExpected struct {
	Genesis, Network, Owner walletAliasSpan
	NativeChainID           uint64
	Height, PKA, PKB        walletAliasSpan
}

type walletAliasInitialRequest struct {
	Version                              uint32
	Size                                 uintptr
	Message, Genesis                     walletAliasSpan
	Expected                             walletAliasInitialExpected
	PrivateA, PrivateB, PublicA, PublicB walletAliasSpan
}

type walletAliasFixture struct {
	request         unsafe.Pointer
	keep            any
	public, private []*walletAliasSpan
}

func TestTransactionBatchCABIPUBLICSecretPublicAliasBoundary(t *testing.T) {
	walletSignAliasBoundary(t, YNXTransactionBatchSignV1, func(span func(int, int) walletAliasSpan) walletAliasFixture {
		r := &walletAliasTxRequest{Version: 1, Size: unsafe.Sizeof(walletAliasTxRequest{}), Message: span(0, 8), Policy: span(0, 8),
			Expected: walletAliasTxExpected{span(0, 32), span(0, 42), 6423, span(0, 1), span(0, 1), span(0, 2592), span(0, 64)},
			PrivateA: span(4096, 54), PrivateB: span(8192, 150), PublicA: span(0, 2592), PublicB: span(0, 64)}
		return walletAliasFixture{unsafe.Pointer(r), r,
			[]*walletAliasSpan{&r.Message, &r.Policy, &r.Expected.Network, &r.Expected.Owner, &r.Expected.Revision, &r.Expected.Height, &r.Expected.PKA, &r.Expected.PKB, &r.PublicA, &r.PublicB},
			[]*walletAliasSpan{&r.PrivateA, &r.PrivateB}}
	})
}

func TestAccountInitialCABIPUBLICSecretPublicAliasBoundary(t *testing.T) {
	walletSignAliasBoundary(t, YNXAccountInitialSignV1, func(span func(int, int) walletAliasSpan) walletAliasFixture {
		r := &walletAliasInitialRequest{Version: 1, Size: unsafe.Sizeof(walletAliasInitialRequest{}), Message: span(0, 8), Genesis: span(0, 8),
			Expected: walletAliasInitialExpected{span(0, 32), span(0, 32), span(0, 42), 6423, span(0, 1), span(0, 2592), span(0, 64)},
			PrivateA: span(4096, 54), PrivateB: span(8192, 150), PublicA: span(0, 2592), PublicB: span(0, 64)}
		return walletAliasFixture{unsafe.Pointer(r), r,
			[]*walletAliasSpan{&r.Message, &r.Genesis, &r.Expected.Genesis, &r.Expected.Network, &r.Expected.Owner, &r.Expected.Height, &r.Expected.PKA, &r.Expected.PKB, &r.PublicA, &r.PublicB},
			[]*walletAliasSpan{&r.PrivateA, &r.PrivateB}}
	})
}

func walletSignAliasBoundary(t *testing.T, exported any, fresh func(func(int, int) walletAliasSpan) walletAliasFixture) {
	t.Helper()
	arena := bytes.Repeat([]byte{0x35}, 16384)
	buffer := bytes.Repeat([]byte{0xa5}, txMemberCapacity+16)
	span := func(offset, size int) walletAliasSpan {
		return walletAliasSpan{unsafe.Pointer(&arena[offset]), uintptr(size)}
	}
	f := reflect.ValueOf(exported)
	fixture := fresh(span)
	if reflect.TypeOf(fixture.keep).Elem().Size() != f.Type().In(0).Elem().Size() {
		t.Fatal("test request differs from actual C ABI extent")
	}
	call := func(t *testing.T, r walletAliasFixture, want resultCode, layout bool) {
		t.Helper()
		before, input := bytes.Clone(buffer), bytes.Clone(arena)
		length, cleanup := uintptr(777), uint32(999)
		args := []reflect.Value{reflect.NewAt(f.Type().In(0).Elem(), r.request),
			reflect.NewAt(f.Type().In(1).Elem(), unsafe.Pointer(&buffer[0])), reflect.ValueOf(uintptr(txMemberCapacity)).Convert(f.Type().In(2)),
			reflect.NewAt(f.Type().In(3).Elem(), unsafe.Pointer(&length)), reflect.NewAt(f.Type().In(4).Elem(), unsafe.Pointer(&cleanup))}
		got := resultCode(f.Call(args)[0].Int())
		runtime.KeepAlive(r.keep)
		runtime.KeepAlive(arena)
		runtime.KeepAlive(buffer)
		if got != want {
			t.Fatalf("actual ABI result=%d, want=%d", got, want)
		}
		if !bytes.Equal(before, buffer) || !bytes.Equal(input, arena) {
			t.Fatal("refusal changed caller input or member buffer")
		}
		if layout {
			if length != 777 || cleanup != 999 {
				t.Fatal("layout refusal changed scalar outputs")
			}
		} else if length != 0 || cleanup != uint32(cleanupNotRequired) {
			t.Fatal("ordinary public refusal changed cleanup contract")
		}
	}
	for _, secret := range []struct {
		name         string
		offset, size int
	}{{"PKCS8-A", 4096, 54}, {"PKCS8-B", 8192, 150}} {
		for index, name := range []string{"message", "original", "expected-0", "expected-1", "expected-2", "height", "expected-A", "expected-B", "borrow-public-A", "borrow-public-B"} {
			for _, position := range []string{"same-start", "partial-before", "partial-after", "adjacent-before", "adjacent-after"} {
				t.Run(secret.name+"/"+name+"/"+position, func(t *testing.T) {
					r := fresh(span)
					target := r.public[index]
					size, offset, overlap := int(target.Size), secret.offset, true
					switch position {
					case "partial-before":
						offset -= size - 1
					case "partial-after":
						offset += secret.size - 1
					case "adjacent-before":
						offset -= size
						overlap = false
					case "adjacent-after":
						offset += secret.size
						overlap = false
					}
					*target = span(offset, size)
					want := resultPublicBinding
					if overlap {
						want = resultOverlap
					}
					call(t, r, want, overlap)
				})
			}
		}
	}
	t.Run("public-public-alias-remains-legal", func(t *testing.T) { call(t, fresh(span), resultPublicBinding, false) })
	t.Run("single-allocation-distinct-subregions", func(t *testing.T) {
		r := fresh(span)
		offset := 0
		for _, field := range r.public {
			size := int(field.Size)
			*field = span(offset, size)
			offset += size
		}
		*r.private[0], *r.private[1] = span(12000, 54), span(13000, 150)
		call(t, r, resultPublicBinding, false)
	})
	t.Run("private-private-alias-remains-legal", func(t *testing.T) {
		r := fresh(span)
		*r.private[1] = span(4096, 150)
		call(t, r, resultPublicBinding, false)
	})
	for index := 0; index < 12; index++ {
		t.Run("zero-length-span-"+string(rune('A'+index)), func(t *testing.T) {
			r := fresh(span)
			fields := append(r.public, r.private...)
			fields[index].Size = 0
			call(t, r, resultBounds, true)
		})
		t.Run("null-span-"+string(rune('A'+index)), func(t *testing.T) {
			r := fresh(span)
			fields := append(r.public, r.private...)
			fields[index].Data = nil
			call(t, r, resultBounds, true)
		})
	}
	t.Run("private-output-overlap-still-refused", func(t *testing.T) {
		r := fresh(span)
		r.private[0].Data = unsafe.Pointer(&buffer[0])
		call(t, r, resultOverlap, true)
	})
	t.Run("public-output-overlap-still-refused", func(t *testing.T) {
		r := fresh(span)
		r.public[0].Data = unsafe.Pointer(&buffer[0])
		call(t, r, resultOverlap, true)
	})
}
