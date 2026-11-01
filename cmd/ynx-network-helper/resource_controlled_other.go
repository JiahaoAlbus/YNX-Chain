//go:build !unix

package main

import "github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"

var resourceWorkerSHA256 string

func runControlledWASM(path, dataDir, issuerPin, consentPin string) error {
	return contribution.ErrUnsupported
}
