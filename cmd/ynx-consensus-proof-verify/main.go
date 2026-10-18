//go:build unix

// ynx-consensus-proof-verify verifies DATA-only public Comet proofs offline.
// No stdin field supplies a root, clock, trust parameter or authority source.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const (
	requestVersion = "YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1"
	resultVersion  = "YNX-CONSENSUS-PROOF-VERIFY-RESULT/v1"
	contextVersion = "YNX-CONSENSUS-PROOF-TRUST/v1"
)

type options struct{ contextPath, contextSHA256 string }

type expectedStatement struct {
	ChainID      string `json:"chainId"`
	HeaderHeight string `json:"headerHeight"`
	BlockHash    string `json:"blockHash"`
	StateHeight  string `json:"stateHeight"`
	StateAppHash string `json:"stateAppHash"`
}

type proofInput struct {
	Version  string            `json:"version"`
	Expected expectedStatement `json:"expected"`
	Proof    json.RawMessage   `json:"proof"`
}

type commandResult struct {
	Version string                        `json:"version"`
	Code    string                        `json:"code"`
	Error   string                        `json:"error,omitempty"`
	Result  *consensus.PQLightProofResult `json:"result,omitempty"`
}

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, time.Now)) }

func parseOptions(args []string) (options, error) {
	var o options
	// flag.FlagSet otherwise accepts repeated flags by silently choosing last.
	seen := make(map[string]bool)
	for i := 0; i < len(args); i++ {
		name, _, inline := strings.Cut(args[i], "=")
		if (name != "--trust-context" && name != "--trust-context-sha256") || seen[name] {
			return o, errors.New("exactly one trust-context path and external SHA256 flag are required")
		}
		seen[name] = true
		if !inline {
			i++
			if i == len(args) {
				return o, errors.New("missing trust-context flag value")
			}
		}
	}
	fs := flag.NewFlagSet("ynx-consensus-proof-verify", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&o.contextPath, "trust-context", "", "independent public trust context; existing canonical absolute file")
	fs.StringVar(&o.contextSHA256, "trust-context-sha256", "", "external SHA256 pin of exact trust-context bytes")
	if err := fs.Parse(args); err != nil {
		return o, err
	}
	if fs.NArg() != 0 || len(seen) != 2 || !canonicalAbsolutePath(o.contextPath) {
		return o, errors.New("explicit independent trust context and external pin are required")
	}
	if _, err := hash32(o.contextSHA256); err != nil {
		return o, err
	}
	return o, nil
}

func run(args []string, input io.Reader, output io.Writer, localClock func() time.Time) int {
	failure := func(code, message string) int {
		_ = json.NewEncoder(output).Encode(commandResult{Version: resultVersion, Code: code, Error: message})
		return 1
	}
	o, err := parseOptions(args)
	if err != nil {
		return failure("INVALID_ARGUMENTS", "explicit pinned trust-context flags are required")
	}
	raw, err := io.ReadAll(io.LimitReader(input, consensus.MaxPQLightProofRequestBytes+(4<<10)+1))
	if err != nil || len(raw) > consensus.MaxPQLightProofRequestBytes+(4<<10) {
		return failure("INVALID_REQUEST", "proof request read failed or exceeded its bound")
	}
	var request proofInput
	if err = strictJSON(raw, &request); err != nil || request.Version != requestVersion {
		return failure("INVALID_REQUEST", "unsupported or non-strict proof request")
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil || len(fields) != 3 || fields["version"] == nil || fields["expected"] == nil || fields["proof"] == nil {
		return failure("INVALID_REQUEST", "proof request field names must match the exact v1 schema")
	}
	if err = strictStringObject(fields["expected"], &request.Expected); err != nil {
		return failure("INVALID_REQUEST", "expected proof fields must be exact strings")
	}
	expected, err := request.Expected.decode()
	if err != nil {
		return failure("INVALID_REQUEST", "expected proof coordinates must use exact decimal strings and 32-byte lowercase hashes")
	}
	proof, err := consensus.DecodePQLightProofRequest(request.Proof)
	if err != nil {
		return failure("INVALID_REQUEST", "invalid complete raw Comet proof transport")
	}
	context, err := readTrustContext(o)
	if err != nil {
		return failure("TRUST_CONTEXT_INVALID", "independent trust-context bytes, schema or parameters did not validate")
	}
	if request.Expected != context.expected() {
		return failure("INVALID_REQUEST", "requested proof coordinates differ from independently pinned invocation target")
	}
	trust, err := context.load()
	if err != nil {
		return failure("TRUST_SOURCE_INVALID", "original committed source or independently pinned trusted light block did not validate")
	}
	if localClock == nil {
		return failure("TRUST_CONTEXT_INVALID", "local verifier clock is unavailable")
	}
	// Capture the verifier's current time AFTER potentially expensive recovery.
	// Neither a peer header nor an input field can extend the trusting period.
	trust.Now = localClock().UTC()
	verified, err := consensus.VerifyPQLightProof(trust, expected, proof)
	if err != nil {
		var rejected *consensus.PQLightProofError
		if errors.As(err, &rejected) {
			// Core errors deliberately contain only bounded public stage/cause,
			// never a dumped proof, signature, authority record or source file.
			return failure("PROOF_REJECTED", rejected.Error())
		}
		return failure("PROOF_REJECTED", "proof failed the bound consensus and normal light-client verification")
	}
	if err = json.NewEncoder(output).Encode(commandResult{Version: resultVersion, Code: "VERIFIED_DATA", Result: &verified}); err != nil {
		return 1
	}
	return 0
}
