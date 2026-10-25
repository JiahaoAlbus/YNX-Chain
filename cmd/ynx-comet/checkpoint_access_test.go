package main

import (
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/pflag"
)

func TestPQCheckpointEngineFlagsRequireExplicitRemoteCustody(t *testing.T) {
	parse := func(args ...string) (pqOptions, error) {
		p := pqOptions{recoveryFD: -1}
		f := pflag.NewFlagSet("checkpoint", pflag.ContinueOnError)
		registerCheckpointAccessFlags(f, &p)
		err := f.Parse(args)
		return p, err
	}
	legacy, err := parse()
	if err != nil || legacy.enabled() || legacy.checkpointAccessConfigured() {
		t.Fatal("default changed", err)
	}
	args := []string{"--checkpoint-access-socket", "@ynx-pq-checkpoint-original-one", "--checkpoint-engine-uid", "1001", "--checkpoint-signer-uid", "1002", "--checkpoint-access-timeout", "12s"}
	p, err := parse(args...)
	if err != nil || !p.enabled() || p.validateCheckpointAccess() == nil {
		t.Fatal("nonremote access accepted", err)
	}
	p.remoteAddress = "tcp://127.0.0.1:27701"
	if err = p.validateCheckpointAccess(); err != nil || p.checkpointAccessConfig() != (consensus.PQCheckpointAccess{Address: args[1], EngineUID: 1001, SignerUID: 1002, Timeout: 12 * time.Second}) {
		t.Fatal("explicit pins changed", err)
	}
	for _, mutate := range []func(*pqOptions){func(q *pqOptions) { q.checkpointAccess.Address = "" }, func(q *pqOptions) { q.checkpointAccess.EngineUID = 0 }, func(q *pqOptions) { q.checkpointAccess.SignerUID = 1001 }, func(q *pqOptions) { q.checkpointAccess.Timeout = time.Minute + 1 }} {
		bad := p
		mutate(&bad)
		if bad.validateCheckpointAccess() == nil {
			t.Fatal("partial/unsafe capability silently accepted")
		}
	}
	partial, err := parse("--checkpoint-access-timeout", "1s")
	if err != nil || !partial.enabled() || partial.validate() == nil {
		t.Fatal("partial capability fell through to stock", err)
	}
	if _, err = parse("--checkpoint-startup-timeout", "10s"); err == nil {
		t.Fatal("signer startup flag accepted by engine")
	}
	for _, args := range [][]string{{"--checkpoint-engine-uid", "0"}, {"--checkpoint-access-socket", ""}, {"--checkpoint-access-timeout", "0s"}} {
		partial, err := parse(args...)
		if err != nil || !partial.enabled() || partial.validate() == nil {
			t.Fatal("explicit empty/zero capability fell through to stock", err)
		}
	}
}
