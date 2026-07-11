package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func main() {
	roleManifest := flag.String("role-manifest", "", "approved public production role manifest")
	privateValidatorKey := flag.String("private-validator-key", "", "host-local CometBFT private validator key file")
	nodeKey := flag.String("node-key", "", "host-local CometBFT node key file")
	flag.Parse()
	for label, value := range map[string]string{"-role-manifest": *roleManifest, "-private-validator-key": *privateValidatorKey, "-node-key": *nodeKey} {
		if strings.TrimSpace(value) == "" {
			fmt.Fprintf(os.Stderr, "%s is required\n", label)
			os.Exit(1)
		}
	}
	if err := consensus.VerifyProductionKeyFiles(*roleManifest, *privateValidatorKey, *nodeKey); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("production validator and node keys match the approved public role manifest")
}
