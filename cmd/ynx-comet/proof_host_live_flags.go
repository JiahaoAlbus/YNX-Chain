package main

import (
	"context"
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"

	"github.com/spf13/pflag"
)

type operatorProofHostLive interface {
	Start(context.Context) error
	Close() error
	Done() <-chan struct{}
	Err() error
}

func registerProofHostLiveFlags(flags *pflag.FlagSet, p *pqOptions) {
	flags.Var(&initializationStringFlag{target: &p.proofLivePolicy}, "proof-host-live-policy", "optional independently pinned single-use public DATA capture policy; no Native grant")
	flags.Var(&initializationStringFlag{target: &p.proofLivePolicyHash}, "proof-host-live-policy-sha256", "independent SHA256 of the complete original live DATA policy")
}
func (p pqOptions) proofLiveConfigured() bool {
	return p.proofLivePolicy != "" || p.proofLivePolicyHash != ""
}
func (p pqOptions) validateProofHostLive() error {
	if !p.proofLiveConfigured() {
		return nil
	}
	h, e := hex.DecodeString(p.proofLivePolicyHash)
	if e != nil || len(h) != 32 || hex.EncodeToString(h) != p.proofLivePolicyHash || p.proofLivePolicyHash == strings.Repeat("0", 64) || !filepath.IsAbs(p.proofLivePolicy) || filepath.Clean(p.proofLivePolicy) != p.proofLivePolicy || p.schedule == "" || p.scheduleHash == "" {
		return errors.New("live DATA capture requires an explicit complete policy pin and normal PQ schedule; no stock/bootstrap fallback")
	}
	return nil
}
