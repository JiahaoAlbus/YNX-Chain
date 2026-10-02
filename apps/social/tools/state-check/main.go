package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/social"
)

func main() {
	path := flag.String("state-file", "", "local Social state file")
	keyPath := flag.String("integrity-key-file", "", "local raw server integrity key file; never print or upload")
	reader := flag.Int("target-reader-schema", social.SchemaVersion, "target compatible reader schema")
	action := flag.String("action", "check", "check (read-only), upgrade, or recover; mutations require stopped exclusive writer")
	stopped := flag.Bool("writer-stopped", false, "explicit assertion that the exclusive writer is stopped under a Central data lease")
	flag.Parse()
	if *action != "check" && !*stopped {
		fmt.Fprintln(os.Stderr, "mutation refused: stop the sole writer under a Central data lease and assert --writer-stopped")
		os.Exit(1)
	}
	key, err := os.ReadFile(*keyPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "local integrity key unavailable")
		os.Exit(1)
	}
	result, err := social.CheckSocialState(*path, key, *reader, *action)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		os.Exit(1)
	}
}
