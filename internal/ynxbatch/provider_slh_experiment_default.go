//go:build !ynxslhexperiment

package ynxbatch

import (
	"github.com/cloudflare/circl/sign/slhdsa"
	"io"
)

// Normal builds always retain the original pinned upstream serial backend.
func signProviderSLH(key *slhdsa.PrivateKey, entropy io.Reader, message []byte) ([]byte, error) {
	return slhdsa.SignRandomized(key, entropy, slhdsa.NewMessage(message), nil)
}
func slhProviderExperimentLabel() string { return "" }
func slhProviderExperimentSnapshot() any { return nil }
