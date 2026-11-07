package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/cometbft/cometbft/cmd/cometbft/commands"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/cli"
	nm "github.com/cometbft/cometbft/node"
	"github.com/spf13/viper"
)

// Parse the original normal Comet start flags/config; never run its constructor
// or Node.Start. Every restart gets the same pinned launcher argv. Removing the
// one bootstrap-only override restores the unchanged default config for P/U/A.
func TestBootstrapQuietRegistrationNormalConfig(t *testing.T) {
	t.Setenv("CMTHOME", "")
	t.Setenv("TMHOME", "")
	home := t.TempDir()
	cfg.EnsureRoot(home)
	configPath := filepath.Join(home, "config", "config.toml")
	original, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name  string
		quiet bool
	}{{"default", false}, {"bootstrap", true}, {"bootstrap-restart", true}, {"activate-normal", false}} {
		t.Run(tc.name, func(t *testing.T) {
			viper.Reset()
			defer viper.Reset()
			command := commands.NewRunNodeCmd(nm.DefaultNewNode)
			command.Flags().String(cli.HomeFlag, home, "existing synthetic home")
			if tc.quiet {
				if err := command.Flags().Set("consensus.create_empty_blocks", "false"); err != nil {
					t.Fatal(err)
				}
			}
			if err := viper.BindPFlags(command.Flags()); err != nil {
				t.Fatal(err)
			}
			viper.SetConfigFile(configPath)
			if err := viper.ReadInConfig(); err != nil {
				t.Fatal(err)
			}
			c, err := commands.ParseConfig(command)
			if err != nil || c.Consensus.CreateEmptyBlocks == tc.quiet || c.Consensus.CreateEmptyBlocksInterval != 0 {
				t.Fatal("normal startup did not retain/restore exact quiet profile", err)
			}
			after, err := os.ReadFile(configPath)
			if err != nil || string(after) != string(original) {
				t.Fatal("normal flag parse rewrote original home config", err)
			}
		})
	}
}
