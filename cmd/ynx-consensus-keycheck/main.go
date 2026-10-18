package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Each option may occur once. In particular, an explicitly empty validator
// path is still an attempted local-custody option in node-only mode.
type keycheckOption struct {
	value         string
	seen, boolean bool
}

func (o *keycheckOption) String() string   { return o.value }
func (o *keycheckOption) IsBoolFlag() bool { return o.boolean }
func (o *keycheckOption) Set(value string) error {
	if o.seen {
		return errors.New("repeated keycheck option")
	}
	o.seen = true
	if o.boolean && value != "true" {
		return errors.New("node-only is an explicit true-only mode")
	}
	o.value = value
	return nil
}

func runKeyCheck(args []string, output, diagnostics io.Writer) int {
	options := flag.NewFlagSet("ynx-consensus-keycheck", flag.ContinueOnError)
	options.SetOutput(io.Discard)
	var roleManifest, privateValidatorKey, nodeKey keycheckOption
	nodeOnly := keycheckOption{boolean: true}
	options.Var(&roleManifest, "role-manifest", "approved public production role manifest")
	options.Var(&privateValidatorKey, "private-validator-key", "host-local CometBFT private validator key file")
	options.Var(&nodeKey, "node-key", "host-local CometBFT node key file")
	options.Var(&nodeOnly, "node-only", "check only the existing local P2P identity; no consensus signing authority")
	if err := options.Parse(args); err != nil || options.NArg() != 0 {
		fmt.Fprintln(diagnostics, "invalid, repeated or positional keycheck option")
		return 1
	}
	if nodeOnly.seen && privateValidatorKey.seen {
		fmt.Fprintln(diagnostics, "-node-only forbids -private-validator-key, including an empty value")
		return 1
	}
	for label, value := range map[string]string{"-role-manifest": roleManifest.value, "-node-key": nodeKey.value} {
		if strings.TrimSpace(value) == "" {
			fmt.Fprintf(diagnostics, "%s is required\n", label)
			return 1
		}
	}
	if nodeOnly.seen {
		if err := consensus.VerifyProductionNodeKeyFile(roleManifest.value, nodeKey.value); err != nil {
			fmt.Fprintln(diagnostics, err)
			return 1
		}
		fmt.Fprintln(output, "production node key matches the approved public role manifest (P2P identity only)")
		return 0
	}
	if strings.TrimSpace(privateValidatorKey.value) == "" {
		fmt.Fprintln(diagnostics, "-private-validator-key is required")
		return 1
	}
	if err := consensus.VerifyProductionKeyFiles(roleManifest.value, privateValidatorKey.value, nodeKey.value); err != nil {
		fmt.Fprintln(diagnostics, err)
		return 1
	}
	fmt.Fprintln(output, "production validator and node keys match the approved public role manifest")
	return 0
}

func main() { os.Exit(runKeyCheck(os.Args[1:], os.Stdout, os.Stderr)) }
