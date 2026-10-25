package main

import (
	"errors"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/pflag"
)

func (p pqOptions) checkpointAccessConfigured() bool {
	a := p.checkpointAccess
	return p.checkpointAccessRequested || a.Address != "" || a.EngineUID != 0 || a.SignerUID != 0 || a.Timeout != 0
}

func (p pqOptions) checkpointAccessConfig() consensus.PQCheckpointAccess {
	a := p.checkpointAccess
	if a.Timeout == 0 {
		a.Timeout = 5 * time.Second
	}
	return a
}

func (p pqOptions) validateCheckpointAccess() error {
	if !p.checkpointAccessConfigured() {
		return nil
	}
	if !p.remote() {
		return errors.New("checkpoint descriptor capability is only valid for explicit remote custody")
	}
	return p.checkpointAccessConfig().Validate()
}

func registerCheckpointAccessFlags(f *pflag.FlagSet, p *pqOptions) {
	f.StringVar(&p.checkpointAccess.Address, "checkpoint-access-socket", "", "explicit Linux abstract endpoint for original read-only committed state")
	f.Uint32Var(&p.checkpointAccess.EngineUID, "checkpoint-engine-uid", 0, "independent non-root engine UID pin")
	f.Uint32Var(&p.checkpointAccess.SignerUID, "checkpoint-signer-uid", 0, "independent distinct non-root signer UID pin")
	f.DurationVar(&p.checkpointAccess.Timeout, "checkpoint-access-timeout", 0, "checkpoint capture timeout; default 5s when explicitly enabled, maximum 1m")
	for _, name := range []string{"checkpoint-access-socket", "checkpoint-engine-uid", "checkpoint-signer-uid", "checkpoint-access-timeout"} {
		flag := f.Lookup(name)
		flag.Value = checkpointRequestedFlag{flag.Value, &p.checkpointAccessRequested}
	}
}

type checkpointRequestedFlag struct {
	pflag.Value
	requested *bool
}

func (v checkpointRequestedFlag) Set(value string) error {
	*v.requested = true
	return v.Value.Set(value)
}

func startOperatorCheckpointAccess(p pqOptions) (*consensus.PQCheckpointAccessServer, error) {
	if !p.checkpointAccessConfigured() {
		return nil, nil
	}
	if err := p.validateCheckpointAccess(); err != nil {
		return nil, err
	}
	return consensus.StartPQCheckpointAccess(p.state, p.checkpointAccessConfig())
}

type checkpointRemoteCustody struct {
	*consensus.PQRemotePrivValidator
	source *consensus.PQCheckpointAccessServer
}

func (c *checkpointRemoteCustody) Close() error {
	// End signing first, then join the read-only file broker before the owning
	// command releases its original Application writer lease.
	return errors.Join(c.PQRemotePrivValidator.Close(), c.source.Close())
}
