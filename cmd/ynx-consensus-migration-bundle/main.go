package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func main() {
	verify := flag.String("verify", "", "verify an existing bundle without changing it")
	source := flag.String("source-snapshot", "", "private frozen native v2 snapshot path; read only")
	output := flag.String("output", "", "new private output directory; must not already exist")
	flag.Parse()
	if *verify != "" && (*source != "" || *output != "") {
		fmt.Fprintln(os.Stderr, "-verify cannot be combined with export flags")
		os.Exit(2)
	}
	if *verify == "" && (*source == "" || *output == "") {
		fmt.Fprintln(os.Stderr, "-source-snapshot and -output are required")
		os.Exit(2)
	}
	var state chain.ConsensusMigrationState
	var err error
	if *verify != "" {
		state, _, err = chain.LoadConsensusMigrationBundle(*verify)
	} else {
		state, err = chain.SaveConsensusMigrationBundleFromSnapshot(*source, *output)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// The archive is retained without claiming all legacy records already have
	// BFT execution adapters or that any live consensus switch has occurred.
	result := map[string]any{"migrationVersion": state.Version, "chainId": state.Network.ChainID, "height": state.Height, "lastBlockHash": state.LastBlockHash, "stateHash": state.StateHash, "sourceArchiveRoot": state.SourceArchiveRoot, "nativeHistoryRetained": true, "legacyExecutionAdaptersComplete": false, "productionCutoverPerformed": false}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
