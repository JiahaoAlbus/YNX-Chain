package main

import (
	"bytes"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func prepareProductDeviceChallenge(challenge, registration []byte, expected ynxbatch.ProductSessionDeviceV4Binding, capacity uint64) (productDevicePlan, resultCode) {
	if capacity != productDeviceMemberCapacity {
		return productDevicePlan{}, resultCapacity
	}
	if len(challenge) == 0 || len(challenge) > productDeviceOriginalMaximum || len(registration) == 0 || len(registration) > productDeviceOriginalMaximum {
		return productDevicePlan{}, resultBounds
	}
	p := productDevicePlan{kind: productDeviceChallenge, challenge: bytes.Clone(challenge), registration: bytes.Clone(registration),
		expected: copyProductDeviceBinding(expected)}
	_, message, err := productDeviceMessage(p)
	if err != nil {
		return productDevicePlan{}, resultPublicBinding
	}
	p.message = message
	return p, resultOK
}
