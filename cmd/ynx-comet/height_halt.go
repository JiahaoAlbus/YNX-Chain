package main

import (
	"encoding/hex"
	"errors"
	"path/filepath"

	nm "github.com/cometbft/cometbft/node"
	"github.com/spf13/pflag"
)

func registerHeightHaltFlags(flags *pflag.FlagSet, options *pqOptions) {
	flags.Var(&initializationStringFlag{target: &options.heightHaltControl}, "height-halt-control", "preconfigured private single-use height halt request path")
	flags.Var(&initializationStringFlag{target: &options.heightHaltPlanHash}, "operator-plan-sha256", "independent full operator plan SHA256 for height halt identity")
	flags.Var(&initializationStringFlag{target: &options.heightHaltSessionID}, "height-halt-session-id", "independent exact session identity for height halt")
}

func (p pqOptions) heightHaltConfigured() bool {
	return p.heightHaltControl != "" || p.heightHaltPlanHash != "" || p.heightHaltSessionID != ""
}

func (p pqOptions) validateHeightHalt() error {
	if !p.heightHaltConfigured() {
		return nil
	}
	for _, pin := range []string{p.heightHaltPlanHash, p.heightHaltSessionID, p.genesisHash} {
		decoded, err := hex.DecodeString(pin)
		if err != nil || len(decoded) != 32 || hex.EncodeToString(decoded) != pin || pin == "0000000000000000000000000000000000000000000000000000000000000000" {
			return errors.New("height halt requires complete independent nonzero genesis, operator plan and session pins")
		}
	}
	if p.state == "" || !filepath.IsAbs(p.state) || filepath.Clean(p.state) != p.state || p.heightHaltControl != filepath.Join(filepath.Dir(p.state), "operator-height-halt-"+p.heightHaltSessionID+".json") {
		return errors.New("height halt requires the exact session path under the original application directory")
	}
	return nil
}

func configureOperatorHeightHalt(node *nm.Node, options pqOptions) error {
	if !options.heightHaltConfigured() {
		return nil
	}
	if err := options.validateHeightHalt(); err != nil {
		return err
	}
	if node == nil || node.GenesisDoc() == nil || node.GenesisDoc().ChainID == "" {
		return errors.New("height halt requires the actual pinned original node identity")
	}
	return node.ConfigureHeightHalt(nm.HeightHaltControl{Path: options.heightHaltControl, ChainID: node.GenesisDoc().ChainID, GenesisSHA256: options.genesisHash, OperatorPlanSHA256: options.heightHaltPlanHash, SessionID: options.heightHaltSessionID})
}
