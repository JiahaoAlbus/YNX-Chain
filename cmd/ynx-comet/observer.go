package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

type observerOptions struct {
	home        string
	application pqOptions
}

func (o observerOptions) validate() error {
	p := o.application
	if o.home == "" || p.migration == "" || p.state == "" || p.genesisHash == "" || p.originalGenesisHash == "" || p.migrationHash == "" {
		return errors.New("observer requires original home/state/migration and all independent genesis pins")
	}
	if p.binding != "" || p.vault != "" || p.recoveryFD != -1 || p.remote() || p.heightHaltConfigured() || p.proofLiveConfigured() || p.checkpointAccessConfigured() || p.wireObservationConfigured() || p.commitObservationConfigured() || p.losslessConfigured() || p.startupTimings {
		return errors.New("observer forbids validator, signing and unrelated runtime controls")
	}
	if (p.schedule == "") != (p.scheduleHash == "") || (p.runtimePlan == "") != (p.runtimePlanHash == "") {
		return errors.New("observer requires complete independently pinned schedule/runtime pairs")
	}
	if err := p.validateInvoiceOptions(); err != nil {
		return err
	}
	return p.validateApplicationLayout()
}

// The observer has its own explicit normal command. No DefaultNewNode, key
// generation, inherited home environment or private-validator flag can select
// this role. This is not P09's bin/node no-argv runtime contract or permission.
func newObserverCommand() *cobra.Command {
	o := observerOptions{application: pqOptions{recoveryFD: -1}}
	c := &cobra.Command{Use: "start-observer", Short: "Run an original authenticated full node without a private validator", Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return o.validate() },
		RunE: func(c *cobra.Command, _ []string) error {
			return runObserverNode(c.Context(), o, log.NewTMLogger(log.NewSyncWriter(c.ErrOrStderr())))
		},
	}
	for _, f := range []struct {
		name     string
		value    *string
		required bool
	}{
		{"observer-home", &o.home, true}, {"migration-state", &o.application.migration, true}, {"abci-state", &o.application.state, true}, {"abci-state-layout", &o.application.stateLayout, false},
		{"consensus-genesis-sha256", &o.application.genesisHash, true}, {"original-genesis-hash", &o.application.originalGenesisHash, true}, {"bound-migration-state-hash", &o.application.migrationHash, true},
		{"pq-engine-schedule", &o.application.schedule, false}, {"pq-engine-schedule-hash", &o.application.scheduleHash, false}, {"runtime-upgrade-plan", &o.application.runtimePlan, false}, {"runtime-upgrade-plan-hash", &o.application.runtimePlanHash, false},
		{"pq-invoice-schedule", &o.application.invoiceSchedule, false}, {"pq-invoice-schedule-hash", &o.application.invoiceScheduleHash, false},
	} {
		c.Flags().Var(&initializationStringFlag{target: f.value}, f.name, "original protected observer input; no authority inferred from a peer")
		if f.required {
			if err := c.MarkFlagRequired(f.name); err != nil {
				panic(err)
			}
		}
	}
	return c
}

func observerWithin(home, path string) bool {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return false
	}
	rel, err := filepath.Rel(home, path)
	return err == nil && rel != "." && rel != ".." && !filepath.IsAbs(rel) && rel != "" && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func observerManagedPath(home, path string) error {
	if !observerWithin(home, path) {
		return errors.New("observer path must remain in its original managed home")
	}
	// Reject aliases at every existing component, including parents of a new
	// Comet DB directory. The operator retains exclusive custody of this home;
	// this preflight is not a claim of race-proof access to attacker-owned paths.
	for current := path; current != home; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || info.Mode()&os.ModeSymlink != 0 || current != path && !info.IsDir() {
			return errors.New("observer managed paths cannot traverse aliases or non-directories")
		}
	}
	return nil
}

func validateObserverHome(home string) error {
	if !filepath.IsAbs(home) || filepath.Clean(home) != home {
		return errors.New("observer home must be an existing exact absolute private directory")
	}
	real, err := filepath.EvalSymlinks(home)
	if err != nil || real != home {
		return errors.New("observer home cannot use a symlink or parent alias")
	}
	info, err := os.Stat(home)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("observer home must be private")
	}
	return nil
}

func validateObserverConfig(conf *cfg.Config, o observerOptions) error {
	if conf == nil || conf.RootDir != o.home || conf.PrivValidatorListenAddr != "" {
		return errors.New("original observer configuration without a private validator socket required")
	}
	if err := validateObserverHome(o.home); err != nil {
		return err
	}
	if err := conf.ValidateBasic(); err != nil {
		return err
	}
	for _, path := range []string{conf.GenesisFile(), conf.NodeKeyFile(), conf.DBDir(), conf.PrivValidatorKeyFile(), conf.PrivValidatorStateFile(), o.application.state} {
		if err := observerManagedPath(o.home, path); err != nil {
			return err
		}
	}
	for _, path := range []string{conf.PrivValidatorKeyFile(), conf.PrivValidatorStateFile()} {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			return errors.New("observer home must not contain validator keys or signing history")
		}
	}
	return nil
}

func loadObserverConfig(o observerOptions) (*cfg.Config, error) {
	if err := o.validate(); err != nil {
		return nil, err
	}
	if err := validateObserverHome(o.home); err != nil {
		return nil, err
	}
	path := filepath.Join(o.home, "config", "config.toml")
	if err := observerManagedPath(o.home, path); err != nil {
		return nil, err
	}
	raw, err := readInitializationInput(path, 1<<20)
	if err != nil {
		return nil, err
	}
	v := viper.New()
	v.SetConfigType("toml")
	if err = v.ReadConfig(bytes.NewReader(raw)); err != nil {
		return nil, err
	}
	conf := cfg.DefaultConfig()
	if err = v.Unmarshal(conf); err != nil {
		return nil, err
	}
	conf.SetRoot(o.home)
	if err = validateObserverConfig(conf, o); err != nil {
		return nil, err
	}
	return conf, nil
}

type observerCustody struct {
	p2p     []byte
	startup *consensus.PQObserverSourceStartup
	logger  log.Logger
}

func (c *observerCustody) Close() error {
	if c != nil {
		defer func() { clear(c.p2p); c.p2p = nil }()
		if c.startup != nil {
			c.startup.Close()
			// Caller stops the actual Node before closing custody. Source-only
			// failure is recorded without converting ordinary observer shutdown
			// into a profile admission failure.
			err := c.startup.Join(context.Background())
			if !c.startup.LocalComplete() {
				return err
			}
			if err != nil && c.logger != nil {
				c.logger.Info("optional original Source scope closed", "error", err)
			}
		}
		clear(c.p2p)
		c.p2p = nil
	}
	return nil
}

// Caller holds only the application writer lease; no HRS or signer is opened.
func constructObserverNode(process context.Context, conf *cfg.Config, logger log.Logger, o observerOptions) (_ *node.Node, _ io.Closer, result error) {
	if process == nil {
		return nil, nil, errors.New("observer requires its actual process before construction")
	}
	if err := process.Err(); err != nil {
		return nil, nil, err
	}
	if err := o.validate(); err != nil {
		return nil, nil, err
	}
	if logger == nil {
		return nil, nil, errors.New("observer logger required")
	}
	if err := validateObserverConfig(conf, o); err != nil {
		return nil, nil, err
	}
	migration, err := readInitializationMigration(o.application.migration, 1<<30, nil)
	if err != nil {
		return nil, nil, err
	}
	raw, err := readInitializationInput(conf.GenesisFile(), 64<<20)
	if err != nil {
		return nil, nil, err
	}
	bootstrap, err := consensus.NewConsensusBootstrap(raw, o.application.operatorFiles(conf).Pins, migration)
	if err != nil {
		return nil, nil, err
	}
	engine, err := readInspectionSchedule(o.application.schedule, o.application.scheduleHash)
	if err != nil {
		return nil, nil, err
	}
	// An observer start consumes an already initialized own ledger. It must not
	// turn an absent destination into a new migration or repair another node.
	if err = existingPrivateFile(o.application.state); err != nil {
		return nil, nil, fmt.Errorf("existing observer application state required: %w", err)
	}
	key, err := consensus.LoadPQExistingNodeKey(conf.NodeKeyFile())
	if err != nil {
		return nil, nil, err
	}
	custody := &observerCustody{p2p: key.PrivKey.Bytes(), logger: logger}
	defer func() {
		if result != nil {
			_ = custody.Close()
		}
	}()
	app, err := newOperatorApplication(migration, o.application.state, bootstrap, engine, o.application)
	if err != nil {
		return nil, nil, err
	}
	n, startup, err := consensus.NewPQObserverNodeWithOriginalSourceStartup(process, conf, app, key, logger)
	custody.startup = startup
	if err != nil {
		return nil, nil, err
	}
	return n, custody, nil
}

func runObserverNode(parent context.Context, o observerOptions, logger log.Logger) (result error) {
	if parent == nil {
		return errors.New("observer requires its original process context")
	}
	conf, err := loadObserverConfig(o)
	if err != nil {
		return err
	}
	lease, err := consensus.AcquireApplicationStateWriterLease(o.application.state)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, lease.Close()) }()
	ctx, stop := signal.NotifyContext(parent, os.Interrupt, syscall.SIGTERM)
	defer stop()
	n, custody, err := constructObserverNode(ctx, conf, logger, o)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, custody.Close()) }()
	if err = ctx.Err(); err != nil {
		n.OnStop()
		return err
	}
	if err = n.Start(); err != nil {
		n.OnStop()
		return err
	}
	select {
	case <-ctx.Done():
	case <-n.Quit():
	}
	// Actual Node/process termination remains independent of optional Source
	// retirement. Stop closes source children before the final profile Join.
	stop()
	return stopPQNodeWithObservations(n, nil, nil)
}
