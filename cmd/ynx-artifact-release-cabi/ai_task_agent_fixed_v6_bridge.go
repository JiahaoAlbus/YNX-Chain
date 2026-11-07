package main

/*
#include "ai_task_agent_fixed_v6.h"
*/
import "C"
import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"unsafe"
)

type aiAgentRange struct{ p, n uintptr }

func (r aiAgentRange) valid() bool                  { return r.p != 0 && r.n != 0 && r.p+r.n >= r.p }
func (r aiAgentRange) overlaps(s aiAgentRange) bool { return r.p < s.p+s.n && s.p < r.p+r.n }

//export YNXAITaskActionAgentFixedSignV6
func YNXAITaskActionAgentFixedSignV6(r *C.YNXAITaskAgentFixedSignRequestV6, b *C.uint8_t, cap C.size_t, n *C.size_t, cleanup *C.uint32_t) (code C.int32_t) {
	if r == nil || b == nil || n == nil || cleanup == nil {
		return 1
	}
	if uintptr(unsafe.Pointer(r))%unsafe.Alignof(*r) != 0 || uintptr(unsafe.Pointer(n))%unsafe.Alignof(*n) != 0 || uintptr(unsafe.Pointer(cleanup))%unsafe.Alignof(*cleanup) != 0 {
		return 1
	}
	if r.version != 6 || r.struct_size != C.size_t(unsafe.Sizeof(*r)) || cap != 98304 {
		return 1
	}
	spans := []C.YNXAITaskAgentBytesV6{r.unsigned_original, r.message_original, r.network_hex, r.key_epoch, r.public_a, r.public_b, r.pkcs8_a, r.pkcs8_b}
	limits := [][2]uintptr{{1, 16384}, {1, 16384}, {64, 64}, {1, 20}, {2592, 2592}, {64, 64}, {54, 54}, {150, 150}}
	outputs := []aiAgentRange{{uintptr(unsafe.Pointer(b)), uintptr(cap)}, {uintptr(unsafe.Pointer(n)), unsafe.Sizeof(*n)}, {uintptr(unsafe.Pointer(cleanup)), unsafe.Sizeof(*cleanup)}}
	inputs := []aiAgentRange{{uintptr(unsafe.Pointer(r)), unsafe.Sizeof(*r)}}
	for i, s := range spans {
		q := aiAgentRange{uintptr(unsafe.Pointer(s.bytes)), uintptr(s.length)}
		if !q.valid() || q.n < limits[i][0] || q.n > limits[i][1] {
			return 1
		}
		inputs = append(inputs, q)
	}
	for i, q := range outputs {
		if !q.valid() {
			return 1
		}
		for _, v := range inputs {
			if q.overlaps(v) {
				return 1
			}
		}
		for _, v := range outputs[:i] {
			if q.overlaps(v) {
				return 1
			}
		}
	}
	*n = 0
	*cleanup = 2
	var member []byte
	defer func() {
		if recover() != nil {
			code = 7
			*cleanup = 0
		}
		clear(member)
	}()
	borrow := func(s C.YNXAITaskAgentBytesV6) []byte {
		return unsafe.Slice((*byte)(unsafe.Pointer(s.bytes)), int(s.length))
	}
	in := ynxbatch.AITaskV6FixedSignInput{UnsignedOriginal: borrow(r.unsigned_original), MessageOriginal: borrow(r.message_original), NetworkHex: borrow(r.network_hex), KeyEpoch: borrow(r.key_epoch), Material: ynxbatch.KeyMaterial{PKA: borrow(r.public_a), PKB: borrow(r.public_b), PKCS8A: borrow(r.pkcs8_a), PKCS8B: borrow(r.pkcs8_b)}}
	out := ynxbatch.SignOriginalAITaskActionV6FixedMath(in)
	member = out.Member
	if len(member) > int(cap) {
		*cleanup = C.uint32_t(out.Cleanup)
		return 4
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(b)), int(cap)), member)
	*n = C.size_t(len(member))
	*cleanup = C.uint32_t(out.Cleanup)
	return C.int32_t(out.Code)
}
