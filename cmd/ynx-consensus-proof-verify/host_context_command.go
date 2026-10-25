//go:build unix

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"io"
	"strings"
	"time"
)

const hostRequestVersion = "YNX-CONSENSUS-PROOF-HOST-REQUEST/v1"
const hostResultVersion = "YNX-CONSENSUS-PROOF-HOST-RESULT/v1"

// Public transport limit for Main's bounded child capture. It includes the
// unchanged context's base64 plus its decoded original transaction expectation.
// It does not enlarge node, RPC, transaction or proof-verifier admission caps.
const maxHostContextOutputBytes = 4*((maxTransactionContextBytes+2)/3) + maxTransactionExpectedBytes + (64 << 10)

type hostOptions struct{ path, pin string }
type hostContextRequest struct {
	Version           string `json:"version"`
	Operation         string `json:"operation"`
	SourceID          string `json:"sourceId"`
	Epoch             string `json:"epoch"`
	SourceFingerprint string `json:"sourceFingerprint"`
}
type hostCommandResult struct {
	Version string             `json:"version"`
	Code    string             `json:"code"`
	Error   string             `json:"error,omitempty"`
	Context *hostContextExport `json:"context,omitempty"`
}

func isHostContextInvocation(args []string) bool {
	for _, arg := range args {
		name, _, _ := strings.Cut(arg, "=")
		if name == "--host-trust-source" || name == "--host-trust-source-sha256" {
			return true
		}
	}
	return false
}

func parseHostOptions(args []string) (hostOptions, error) {
	var o hostOptions
	seen := make(map[string]bool)
	for i := 0; i < len(args); i++ {
		name, _, inline := strings.Cut(args[i], "=")
		if (name != "--host-trust-source" && name != "--host-trust-source-sha256") || seen[name] {
			return o, errors.New("exact host source and independent pin flags required")
		}
		seen[name] = true
		if !inline {
			i++
			if i == len(args) {
				return o, errors.New("missing host source flag value")
			}
		}
	}
	f := flag.NewFlagSet("ynx-consensus-proof-verify host source", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	f.StringVar(&o.path, "host-trust-source", "", "original independently approved Host source manifest")
	f.StringVar(&o.pin, "host-trust-source-sha256", "", "external SHA256 pin of exact original source bytes")
	if err := f.Parse(args); err != nil {
		return o, err
	}
	if len(seen) != 2 || f.NArg() != 0 || !canonicalAbsolutePath(o.path) {
		return o, errors.New("explicit original host source required")
	}
	_, err := hash32(o.pin)
	return o, err
}

// One bounded child, one request, one export, then all references are closed.
// There is deliberately no RPC, daemon, IPC bearer token, arbitrary path from
// stdin, proof-selected expectation, source write or lifecycle issuer here.
// Main must retain its own opaque ref; revoke/retire/join cancel publication and
// join its bounded children. A later current request reopens the SAME externally
// pinned original source and compares the full captured fingerprint.
func runHostContext(args []string, input io.Reader, output io.Writer, clock func() time.Time) int {
	failure := func(code string) int {
		_ = json.NewEncoder(output).Encode(hostCommandResult{Version: hostResultVersion, Code: code, Error: "original proof Host source unavailable, changed or no longer current"})
		return 1
	}
	o, err := parseHostOptions(args)
	if err != nil {
		return failure("INVALID_ARGUMENTS")
	}
	raw, err := io.ReadAll(io.LimitReader(input, (4<<10)+1))
	if err != nil || len(raw) > 4<<10 {
		return failure("INVALID_REQUEST")
	}
	var request hostContextRequest
	if err = strictStringObject(raw, &request); err != nil || request.Version != hostRequestVersion || !validHostSourceID(request.SourceID) {
		return failure("INVALID_REQUEST")
	}
	if _, err = decimal(request.Epoch, ^uint64(0), true); err != nil {
		return failure("INVALID_REQUEST")
	}
	switch request.Operation {
	case "acquire":
		if request.SourceFingerprint != "" {
			return failure("INVALID_REQUEST")
		}
	case "current":
		if _, err = hash32(request.SourceFingerprint); err != nil {
			return failure("INVALID_REQUEST")
		}
	default:
		return failure("INVALID_REQUEST")
	}
	ref, err := acquireProofHost(o.path, o.pin, clock)
	if err != nil {
		return failure("HOST_SOURCE_INVALID")
	}
	defer ref.Close()
	current, err := ref.Current()
	if err != nil {
		return failure("HOST_SOURCE_NOT_CURRENT")
	}
	if request.SourceID != current.SourceID || request.Epoch != current.Epoch {
		return failure("HOST_SOURCE_NOT_CURRENT")
	}
	if request.Operation == "current" && request.SourceFingerprint != current.SourceFingerprint {
		return failure("HOST_SOURCE_NOT_CURRENT")
	}
	// The guarded Main caller owns the final release race after this read. An
	// export records a check at this instant, never permanent/cross-process trust.
	encoded, err := json.Marshal(hostCommandResult{Version: hostResultVersion, Code: "EXPORTED_PROOF_TRUST_DATA", Context: &current})
	if err != nil || len(encoded)+1 > maxHostContextOutputBytes {
		return failure("HOST_EXPORT_BOUNDS")
	}
	encoded = append(encoded, '\n')
	if n, err := output.Write(encoded); err != nil || n != len(encoded) {
		return 1
	}
	return 0
}
