//go:build ynxslhexperiment

package ynxbatch

import (
	"errors"
	experiment "github.com/cloudflare/circl/experimental-slh/slhdsa"
	"github.com/cloudflare/circl/sign/slhdsa"
	"io"
	"sync"
)

// Test-only synthetic-key enrollment is defined in the tagged *_test.go file.
// Building this tag as an application cannot enroll any key, and fails closed.
var slhSyntheticKeys = struct {
	sync.RWMutex
	keys map[*slhdsa.PrivateKey]*experiment.PrivateKey
}{keys: make(map[*slhdsa.PrivateKey]*experiment.PrivateKey)}

func signProviderSLH(key *slhdsa.PrivateKey, entropy io.Reader, message []byte) ([]byte, error) {
	slhSyntheticKeys.RLock()
	candidate := slhSyntheticKeys.keys[key]
	slhSyntheticKeys.RUnlock()
	if candidate == nil {
		return nil, errors.New("SLH_EXPERIMENT_SYNTHETIC_TEST_KEY_REQUIRED")
	}
	return experiment.SignRandomizedScheduled(candidate, entropy, experiment.NewMessage(message), nil)
}
func slhProviderExperimentLabel() string {
	return " experimental scheduled fork; synthetic-test enrollment only"
}
func slhProviderExperimentSnapshot() any { return experiment.ExperimentSchedulingStats() }
