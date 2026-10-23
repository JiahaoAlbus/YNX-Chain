//go:build unix

package main

import (
	"errors"
	"flag"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func parseCheckpointUID(raw string, target *uint32) error {
	n, err := strconv.ParseUint(raw, 10, 32)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != raw {
		return errors.New("checkpoint UID requires a canonical positive decimal uint32")
	}
	*target = uint32(n)
	return nil
}

func (o options) checkpointAccessConfigured() bool {
	a := o.checkpointAccess
	return o.checkpointAccessRequested || a.Address != "" || a.EngineUID != 0 || a.SignerUID != 0 || a.Timeout != 0 || o.checkpointStartup != 0
}

func (o options) checkpointAccessConfig() consensus.PQCheckpointAccess {
	a := o.checkpointAccess
	if a.Timeout == 0 {
		a.Timeout = 5 * time.Second
	}
	return a
}

func (o options) validateCheckpointAccess() error {
	if !o.checkpointAccessConfigured() {
		return nil
	}
	if o.checkpointStartup < time.Second || o.checkpointStartup > 10*time.Minute {
		return errors.New("explicit checkpoint access requires an independently configured startup timeout in [1s,10m]")
	}
	return o.checkpointAccessConfig().Validate()
}

func registerCheckpointAccessOptions(f *flag.FlagSet, o *options) {
	f.StringVar(&o.checkpointAccess.Address, "checkpoint-access-socket", "", "explicit Linux abstract endpoint for the original engine-owned committed state")
	f.Func("checkpoint-engine-uid", "independent non-root engine UID pin", func(raw string) error {
		return parseCheckpointUID(raw, &o.checkpointAccess.EngineUID)
	})
	f.Func("checkpoint-signer-uid", "independent distinct non-root signer UID pin", func(raw string) error {
		return parseCheckpointUID(raw, &o.checkpointAccess.SignerUID)
	})
	f.DurationVar(&o.checkpointAccess.Timeout, "checkpoint-access-timeout", 0, "checkpoint capture timeout; default 5s when explicitly enabled, maximum 1m")
	f.DurationVar(&o.checkpointStartup, "checkpoint-startup-timeout", 0, "independent one-accept startup budget, required for split UID mode, maximum 10m")
}

func (o options) newCheckpointSource(inputs *consensus.PQOperatorInputs, runtime *consensus.RuntimeUpgradeAuthorization) (*consensus.PQEngineFileSource, error) {
	if err := o.validateCheckpointAccess(); err != nil {
		return nil, err
	}
	if o.checkpointAccessConfigured() {
		return consensus.NewPQEngineCheckpointAccessSource(inputs.Migration, o.files.State, inputs.Bootstrap, inputs.Authorization, runtime, o.checkpointAccessConfig())
	}
	return consensus.NewPQEngineFileSourceWithRuntimeUpgrade(inputs.Migration, o.files.State, inputs.Bootstrap, inputs.Authorization, runtime)
}

func checkpointSystemdReady() error {
	// NOTIFY_SOCKET is only a systemd lifecycle destination, never key material
	// or a source of trust pins. No notification occurs before TCP Listen.
	address := os.Getenv("NOTIFY_SOCKET")
	if address == "" || (!strings.HasPrefix(address, "/") && !strings.HasPrefix(address, "@")) || strings.ContainsRune(address, '\x00') {
		return errors.New("split UID signer requires its systemd readiness notification socket")
	}
	c, err := net.DialUnix("unixgram", nil, &net.UnixAddr{Name: address, Net: "unixgram"})
	if err != nil {
		return err
	}
	defer c.Close()
	if err = c.SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
		return err
	}
	message := []byte("READY=1\nSTATUS=Original custody loaded; waiting for one pinned engine session")
	n, err := c.Write(message)
	if err != nil || n != len(message) {
		return errors.New("systemd signer readiness notification was not delivered")
	}
	return nil
}
