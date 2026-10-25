//go:build unix

package main

import (
	"io"
	"testing"
)

func remoteOperatorArgs() []string {
	return []string{"--serve", "--migration-state", "migration.json", "--genesis", "genesis.json", "--abci-state", "committed.json", "--consensus-genesis-sha256", "pin", "--original-genesis-hash", "native-pin", "--bound-migration-state-hash", "migration-pin", "--pq-engine-schedule", "schedule.json", "--pq-engine-schedule-hash", "schedule-pin", "--pq-host-key-binding", "binding.json", "--pq-host-key-vault", "existing.vault", "--legacy-key", "existing.ed-key", "--legacy-state", "existing.ed-hrs", "--listen", "tcp://127.0.0.1:27701", "--pq-transport-key", "existing.transport", "--pq-engine-peer-pin", "engine.pub", "--recovery-fd", "3"}
}
func TestRemoteSignerCLIRequiresExplicitResumeOnlyOperatorConfiguration(t *testing.T) {
	args := remoteOperatorArgs()
	o, err := parseOptions(args, io.Discard)
	if err != nil || !o.serve || o.recoveryFD != 3 {
		t.Fatal(err)
	}
	for _, bad := range [][]string{nil, {"--serve"}, args[1:], append(append([]string{}, args...), "--recovery-fd", "0"), append(append([]string{}, args...), "--listen", "http://peer"), append(append([]string{}, args...), "--timeout", "2m"), append(append([]string{}, args...), "--new-key"), append(append([]string{}, args...), "--credential", "secret-must-not-be-accepted")} {
		if _, err = parseOptions(bad, io.Discard); err == nil {
			t.Fatal("partial/unsafe remote invocation accepted")
		}
	}
}
