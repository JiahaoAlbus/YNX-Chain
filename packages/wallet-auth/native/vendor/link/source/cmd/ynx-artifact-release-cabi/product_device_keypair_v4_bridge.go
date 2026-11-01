package main

/*
#include "product_device_keypair_v4.h"
*/
import "C"

import (
	"unsafe"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func checkProductDeviceKeypairRequestV4(req *C.YNXProductSessionDeviceKeypairRequestV4, outcome *C.YNXProductSessionDeviceKeypairOutcomeV4) resultCode {
	if req == nil || outcome == nil {
		return resultInvalidArgument
	}
	request := memoryRange{uintptr(unsafe.Pointer(req)), unsafe.Sizeof(*req)}
	if !request.valid() || request.start%unsafe.Alignof(*req) != 0 || uintptr(unsafe.Pointer(outcome))%unsafe.Alignof(*outcome) != 0 {
		return resultBounds
	}
	if req.version != productDeviceKeypairVersion || req.struct_size != C.size_t(unsafe.Sizeof(*req)) {
		return resultInvalidArgument
	}
	buffers := []C.YNXProductDeviceKeypairBufferV4{req.pkcs8_a, req.pkcs8_b, req.pk_a, req.pk_b}
	sizes := []uintptr{ynxbatch.PKCS8ASize, ynxbatch.PKCS8BSize, ynxbatch.PublicKeyASize, ynxbatch.PublicKeyBSize}
	outputs := []memoryRange{{uintptr(unsafe.Pointer(outcome)), unsafe.Sizeof(*outcome)}}
	for i, buffer := range buffers {
		if uintptr(buffer.capacity) != sizes[i] {
			return resultCapacity
		}
		outputs = append(outputs, memoryRange{uintptr(unsafe.Pointer(buffer.bytes)), uintptr(buffer.capacity)})
	}
	return checkMemoryLayout(request, nil, outputs)
}

//export YNXProductSessionDeviceKeypairGenerateV4
func YNXProductSessionDeviceKeypairGenerateV4(req *C.YNXProductSessionDeviceKeypairRequestV4, outcome *C.YNXProductSessionDeviceKeypairOutcomeV4) (result C.int32_t) {
	if code := checkProductDeviceKeypairRequestV4(req, outcome); code != resultOK {
		return C.int32_t(code)
	}
	buffers := [][]byte{
		unsafe.Slice((*byte)(unsafe.Pointer(req.pkcs8_a.bytes)), ynxbatch.PKCS8ASize),
		unsafe.Slice((*byte)(unsafe.Pointer(req.pkcs8_b.bytes)), ynxbatch.PKCS8BSize),
		unsafe.Slice((*byte)(unsafe.Pointer(req.pk_a.bytes)), ynxbatch.PublicKeyASize),
		unsafe.Slice((*byte)(unsafe.Pointer(req.pk_b.bytes)), ynxbatch.PublicKeyBSize),
	}
	for _, buffer := range buffers {
		clear(buffer)
	}
	*outcome = C.YNXProductSessionDeviceKeypairOutcomeV4{}
	outcome.cleanup_status = C.uint32_t(cleanupNotRequired)
	var material ynxbatch.KeyMaterial
	code, cleanup := resultInternal, cleanupUnknown
	began, complete := false, false
	defer func() {
		panicked := recover() != nil
		clean := runLogicalCleanup(func() { material.Clear() })
		var state uint32
		code, cleanup, state = finishProductDeviceKeypairTransferV4(code, cleanup, began, complete, panicked, clean)
		if !began {
			for _, buffer := range buffers {
				clear(buffer)
			}
			outcome.pkcs8_a_length, outcome.pkcs8_b_length, outcome.pk_a_length, outcome.pk_b_length = 0, 0, 0, 0
		}
		outcome.cleanup_status, outcome.output_state = C.uint32_t(cleanup), C.uint32_t(state)
		result = C.int32_t(code)
	}()
	material, code, cleanup = generateProductDeviceKeypairV4()
	if code != resultOK || cleanup != cleanupLogicalComplete {
		return C.int32_t(code)
	}
	if !productDeviceKeypairMaterialComplete(material) {
		code = resultOutputValidation
		return C.int32_t(code)
	}
	began = true
	outcome.output_state = C.uint32_t(productDeviceKeypairUnknown)
	copy(buffers[0], material.PKCS8A)
	outcome.pkcs8_a_length = C.size_t(ynxbatch.PKCS8ASize)
	copy(buffers[1], material.PKCS8B)
	outcome.pkcs8_b_length = C.size_t(ynxbatch.PKCS8BSize)
	copy(buffers[2], material.PKA)
	outcome.pk_a_length = C.size_t(ynxbatch.PublicKeyASize)
	copy(buffers[3], material.PKB)
	outcome.pk_b_length = C.size_t(ynxbatch.PublicKeyBSize)
	complete = true
	return C.int32_t(code)
}
