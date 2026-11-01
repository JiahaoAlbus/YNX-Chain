// Command gen deterministically constructs the one owned histogram module.
// It uses only the WebAssembly 1.0 binary format, not an external WAT compiler.
package main

import (
	"crypto/sha256"
	"fmt"
	"os"
)

func u32(v uint32) []byte {
	var out []byte
	for {
		b := byte(v & 0x7f)
		v >>= 7
		if v != 0 {
			b |= 0x80
		}
		out = append(out, b)
		if v == 0 {
			return out
		}
	}
}

func s32(v int32) []byte {
	var out []byte
	for {
		b := byte(v & 0x7f)
		v >>= 7
		done := v == 0 && b&0x40 == 0 || v == -1 && b&0x40 != 0
		if !done {
			b |= 0x80
		}
		out = append(out, b)
		if done {
			return out
		}
	}
}

func section(id byte, body []byte) []byte {
	out := []byte{id}
	out = append(out, u32(uint32(len(body)))...)
	return append(out, body...)
}

func main() {
	wasm := []byte{0, 'a', 's', 'm', 1, 0, 0, 0}
	wasm = append(wasm, section(1, []byte{1, 0x60, 2, 0x7f, 0x7f, 0})...) // (i32,i32)->()
	wasm = append(wasm, section(3, []byte{1, 0})...)                      // one function, type 0
	mem := []byte{1, 1}                                                   // one memory, explicit min/max
	mem = append(mem, u32(129)...)
	mem = append(mem, u32(129)...)
	wasm = append(wasm, section(5, mem)...)
	exports := []byte{2, 6, 'm', 'e', 'm', 'o', 'r', 'y', 2, 0, 3, 'r', 'u', 'n', 0, 0}
	wasm = append(wasm, section(7, exports)...)

	// run(ptr,len) only increments counts[256] at offset 0. A fresh module's
	// memory is zeroed. The native executor calls it with disjoint small slices.
	// Parameters are independently checked here, so even direct internal calls
	// have a loop bound <=4MiB and cannot overlap the count table.
	body := []byte{1, 2, 0x7f} // local i and bucket address, both i32
	get := func(n byte) { body = append(body, 0x20, n) }
	con := func(n int32) { body = append(body, 0x41); body = append(body, s32(n)...) }
	trapIf := func() { body = append(body, 0x04, 0x40, 0x00, 0x0b) }
	get(0)
	con(4096)
	body = append(body, 0x49) // ptr <u 4096
	trapIf()
	get(0)
	con(4096 + 4*1024*1024)
	body = append(body, 0x4b) // ptr >u end
	trapIf()
	get(1)
	con(4 * 1024 * 1024)
	body = append(body, 0x4b) // len >u 4MiB
	trapIf()
	get(1)
	con(4096 + 4*1024*1024)
	get(0)
	body = append(body, 0x6b, 0x4b) // len >u end-ptr, no wraparound
	trapIf()

	body = append(body, 0x02, 0x40, 0x03, 0x40) // block; loop
	get(2)
	get(1)
	body = append(body, 0x4f, 0x0d, 1) // i >=u len -> br_if outer block
	get(0)
	get(2)
	body = append(body, 0x6a, 0x2d, 0, 0) // load8_u(ptr+i)
	con(2)
	body = append(body, 0x74, 0x22, 3) // address = byte << 2, local.tee
	get(3)
	body = append(body, 0x28, 2, 0) // load count
	con(1)
	body = append(body, 0x6a, 0x36, 2, 0) // count++
	get(2)
	con(1)
	body = append(body, 0x6a, 0x21, 2, 0x0c, 0, 0x0b, 0x0b, 0x0b) // i++; br loop; end
	code := []byte{1}
	code = append(code, u32(uint32(len(body)))...)
	code = append(code, body...)
	wasm = append(wasm, section(10, code)...)
	if err := os.WriteFile("histogram.wasm", wasm, 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("%x  histogram.wasm (%d bytes)\n", sha256.Sum256(wasm), len(wasm))
}
