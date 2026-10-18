//go:build unix

package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
)

type options struct {
	serve                         bool
	files                         consensus.PQOperatorFiles
	transport                     consensus.PQRemoteTransport
	legacyKey, legacyState, vault string
	recoveryFD                    int
}

func parseOptions(args []string, diagnostics io.Writer) (options, error) {
	var o options
	f := flag.NewFlagSet("ynx-consensus-pq-remote-signer", flag.ContinueOnError)
	f.SetOutput(diagnostics)
	f.BoolVar(&o.serve, "serve", false, "explicitly serve one pinned remote signing session using original keys and HRS")
	f.StringVar(&o.files.Migration, "migration-state", "", "original bound complete migration JSON")
	f.StringVar(&o.files.Genesis, "genesis", "", "exact original Comet genesis")
	f.StringVar(&o.files.State, "abci-state", "", "read-only current committed application file")
	f.StringVar(&o.files.Pins.CometGenesisSHA256, "consensus-genesis-sha256", "", "independent exact Comet genesis SHA256")
	f.StringVar(&o.files.Pins.OriginalGenesisHash, "original-genesis-hash", "", "independent original native genesis pin")
	f.StringVar(&o.files.Pins.MigrationStateHash, "bound-migration-state-hash", "", "independent original migration hash")
	f.StringVar(&o.files.Schedule, "pq-engine-schedule", "", "canonical independently authorized activation schedule")
	f.StringVar(&o.files.ScheduleHash, "pq-engine-schedule-hash", "", "independent schedule hash")
	f.StringVar(&o.files.Binding, "pq-host-key-binding", "", "canonical complete public expected key and original HRS binding")
	f.StringVar(&o.vault, "pq-host-key-vault", "", "existing encrypted validator key envelope; resume only")
	f.StringVar(&o.legacyKey, "legacy-key", "", "original private Ed validator key file")
	f.StringVar(&o.legacyState, "legacy-state", "", "original Ed HRS file; absence is fatal")
	f.StringVar(&o.transport.Address, "listen", "", "explicit tcp:// listen endpoint for one SecretConnection session")
	f.StringVar(&o.transport.TransportKey, "pq-transport-key", "", "existing private operator transport key file")
	f.StringVar(&o.transport.PeerPin, "pq-engine-peer-pin", "", "file containing independent full engine transport public key")
	f.DurationVar(&o.transport.Timeout, "timeout", 5*time.Second, "bounded accept/handshake/request timeout; maximum 1m")
	f.IntVar(&o.recoveryFD, "recovery-fd", -1, "inherited private descriptor >=3 containing exactly 32 raw credential bytes and EOF")
	if err := f.Parse(args); err != nil {
		return o, err
	}
	if f.NArg() != 0 || !o.serve {
		return o, errors.New("explicit --serve and named operator configuration are required")
	}
	for _, v := range []string{o.files.Migration, o.files.Genesis, o.files.State, o.files.Pins.CometGenesisSHA256, o.files.Pins.OriginalGenesisHash, o.files.Pins.MigrationStateHash, o.files.Schedule, o.files.ScheduleHash, o.files.Binding, o.vault, o.legacyKey, o.legacyState} {
		if v == "" {
			return o, errors.New("remote signer requires every original file and independent genesis/migration/schedule/key binding pin")
		}
	}
	if o.recoveryFD < 3 {
		return o, errors.New("remote signer credential requires private inherited descriptor >=3")
	}
	return o, o.transport.Validate()
}

func serve(ctx context.Context, o options) (result error) {
	inputs, err := consensus.LoadPQOperatorInputs(o.files)
	if err != nil {
		return err
	}
	// Do not create an Application or acquire its writer lease on this host.
	// Only the original legacy HRS and durable PQ signer are writable here.
	source, err := consensus.NewPQEngineFileSource(inputs.Migration, o.files.State, inputs.Bootstrap, inputs.Authorization)
	if err != nil {
		return err
	}
	legacyLease, err := consensus.AcquireApplicationStateWriterLease(o.legacyState)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, legacyLease.Close()) }()
	legacy, err := consensus.LoadPQOriginalLegacyValidator(o.legacyKey, o.legacyState, inputs.Binding.Policy.ChainID)
	if err != nil {
		return err
	}
	defer clear(legacy.Key.PrivKey.Bytes())
	registry, err := consensus.NewPQCommittedSignerRegistry(source, inputs.Bootstrap)
	if err != nil {
		return err
	}
	credential, err := consensus.ReadPQRecoveryCredential(o.recoveryFD)
	if err != nil {
		return err
	}
	defer clear(credential)
	host, err := ynxconsensusauth.ResumeHostSigner(o.vault, credential, inputs.Binding, registry)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, host.Close()) }()
	signer, err := host.Signer()
	if err != nil {
		return err
	}
	pq, err := consensus.NewPQPrivValidator(signer, source)
	if err != nil {
		return err
	}
	transition, err := consensus.NewPQTransitionPrivValidator(legacy, pq, inputs.Bootstrap, inputs.Authorization)
	if err != nil {
		return err
	}
	return consensus.ListenPQRemoteSigner(ctx, o.transport, inputs.Binding.Policy.ChainID, source, transition)
}

func main() {
	o, err := parseOptions(os.Args[1:], os.Stderr)
	if err == nil {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		err = serve(ctx, o)
		stop()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
