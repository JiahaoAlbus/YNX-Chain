//go:build !unix

package ynxconsensusauth

import (
	"errors"
	"os"
)

func acquireSignerLock(string) (*os.File, error) {
	return nil, errors.New("durable consensus signer requires supported OS process locking")
}

func openSignerState(string) (*os.File, error) {
	return nil, errors.New("durable consensus signer requires supported OS state opening")
}
