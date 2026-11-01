package main

import (
	"context"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	dbm "github.com/cometbft/cometbft-db"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

// Exercise the original normal launcher, including the real Node.Start and
// Node.OnStop. All listeners use ephemeral loopback ports; no peer is dialed,
// no quorum can form and no existing chain or custody is opened.
func TestPQNodeNormalCancellationReturnsAfterOwnedStop(t *testing.T) {
	f := newWireObservationFixture(t)
	f.options.wireObservationOutput, f.options.wireObservationScope = "", ""
	viper.Reset()
	t.Cleanup(viper.Reset)
	t.Setenv("CMTHOME", "")
	t.Setenv("TMHOME", "")
	viper.SetConfigFile(f.config.RootDir + "/config/config.toml")
	if err := viper.ReadInConfig(); err != nil {
		t.Fatal(err)
	}
	viper.Set("p2p.laddr", "tcp://127.0.0.1:0")
	viper.Set("rpc.laddr", "tcp://127.0.0.1:0")
	viper.Set("p2p.persistent_peers", "")
	viper.Set("p2p.seeds", "")
	viper.Set("log_level", "error")
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Normal cancellation immediately after the actual startup.
	command := &cobra.Command{Use: "start"}
	command.Flags().String("home", f.config.RootDir, "synthetic isolated home")
	command.SetContext(ctx)
	if err := runPQNode(command, f.options); err != nil {
		t.Fatal("normal Node.Stop returned a second proxy-stop failure", err)
	}
	// Successful process cleanup includes releasing both normal writer leases
	// and the original state database. It is distinct from a proof/finality.
	for _, path := range []string{f.options.state, f.config.PrivValidatorStateFile()} {
		lease, err := consensus.AcquireApplicationStateWriterLease(path)
		if err != nil {
			t.Fatal("normal shutdown retained a writer lease", err)
		}
		if err := lease.Close(); err != nil {
			t.Fatal(err)
		}
	}
	stateDB, err := dbm.NewGoLevelDBWithOpts("state", f.config.DBDir(), &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
	if err != nil {
		t.Fatal("normal Node.Stop did not release its real database", err)
	}
	if err := stateDB.Close(); err != nil {
		t.Fatal(err)
	}
}
