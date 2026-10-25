//go:build unix

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"io"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

type hostSelectionOptions struct{ path, pin string }

func isHostSourceSelectionInvocation(args []string) bool {
	for _, arg := range args {
		name, _, _ := strings.Cut(arg, "=")
		if name == "--host-source-catalog" || name == "--host-source-catalog-sha256" {
			return true
		}
	}
	return false
}

func parseHostSelectionOptions(args []string) (hostSelectionOptions, error) {
	var o hostSelectionOptions
	seen := make(map[string]bool)
	for i := 0; i < len(args); i++ {
		name, _, inline := strings.Cut(args[i], "=")
		if (name != "--host-source-catalog" && name != "--host-source-catalog-sha256") || seen[name] {
			return o, errors.New("exact registered catalog path and independent SHA256 flags required")
		}
		seen[name] = true
		if !inline {
			i++
			if i == len(args) {
				return o, errors.New("missing registered catalog flag value")
			}
		}
	}
	f := flag.NewFlagSet("ynx-consensus-proof-verify host source selection", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	f.StringVar(&o.path, "host-source-catalog", "", "fixed protected catalog selected by the original Main private factory")
	f.StringVar(&o.pin, "host-source-catalog-sha256", "", "independent external pin of the original registered catalog bytes")
	if err := f.Parse(args); err != nil {
		return o, err
	}
	if len(seen) != 2 || f.NArg() != 0 || !canonicalAbsolutePath(o.path) {
		return o, errors.New("original fixed catalog and external pin required")
	}
	_, err := hash32(o.pin)
	return o, err
}

// This child only selects registered mathematical DATA. Main must supply these
// flags from its protected factory, never renderer, environment or peer input.
// It still performs the unchanged acquire/current lifecycle and trust checks.
func runHostSourceSelection(args []string, input io.Reader, output io.Writer) int {
	failure := func(code string) int {
		_ = json.NewEncoder(output).Encode(commandResult{Version: resultVersion, Code: code, Error: "original registered proof source selection unavailable or mismatched"})
		return 1
	}
	o, err := parseHostSelectionOptions(args)
	if err != nil {
		return failure("INVALID_ARGUMENTS")
	}
	raw, err := io.ReadAll(io.LimitReader(input, consensus.MaxProofHostSourceSelectionRequestBytes+1))
	if err != nil || len(raw) > consensus.MaxProofHostSourceSelectionRequestBytes {
		return failure("INVALID_REQUEST")
	}
	selected, err := consensus.SelectRegisteredProofHostSource(o.path, o.pin, raw)
	if err != nil {
		return failure("HOST_SOURCE_SELECTION_INVALID")
	}
	// Exactly four fields, with no success/grant/current boolean or trust data.
	if err := json.NewEncoder(output).Encode(selected); err != nil {
		return 1
	}
	return 0
}
