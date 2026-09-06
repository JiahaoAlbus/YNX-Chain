// Command ynx-execution-migration-audit reads snapshots and prints a redacted
// preflight report. It has no write, network, signing, or migration operation.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"runtime/debug"

	"github.com/JiahaoAlbus/YNX-Chain/internal/executionstate"
)

const maxInputBytes = 256 << 20

type snapshotInput struct {
	data       []byte
	sha        string
	size       int64
	digestOnly bool
}

// Large inputs are hashed through EOF with a bounded io.Copy buffer instead of
// being truncated or materialized as multiple full JSON representations.
func readSnapshot(path string, parseBudget int64) (snapshotInput, error) {
	f, e := os.Open(path)
	if e != nil {
		return snapshotInput{}, fmt.Errorf("INPUT_READ_FAILED")
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil || !st.Mode().IsRegular() {
		return snapshotInput{}, fmt.Errorf("INPUT_NOT_REGULAR_FILE")
	}
	var prefix []byte
	if st.Size() <= parseBudget {
		prefix, e = io.ReadAll(io.LimitReader(f, parseBudget+1))
		if e != nil {
			return snapshotInput{}, fmt.Errorf("INPUT_READ_FAILED")
		}
		if int64(len(prefix)) <= parseBudget {
			return snapshotInput{data: prefix, size: int64(len(prefix))}, nil
		}
	}
	h := sha256.New()
	h.Write(prefix)
	n, e := io.Copy(h, f)
	if e != nil {
		return snapshotInput{}, fmt.Errorf("INPUT_FULL_DIGEST_FAILED")
	}
	return snapshotInput{sha: hex.EncodeToString(h.Sum(nil)), size: int64(len(prefix)) + n, digestOnly: true}, nil
}

func readInput(path string, limit int64) ([]byte, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, fmt.Errorf("INPUT_READ_FAILED")
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil || !st.Mode().IsRegular() || st.Size() > limit {
		return nil, fmt.Errorf("INPUT_NOT_BOUNDED_REGULAR_FILE")
	}
	b, e := io.ReadAll(io.LimitReader(f, limit+1))
	if e != nil || int64(len(b)) > limit {
		return nil, fmt.Errorf("INPUT_READ_FAILED_OR_LIMIT")
	}
	return b, nil
}

func run(args []string, out io.Writer) int {
	f := flag.NewFlagSet("ynx-execution-migration-audit", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	var o executionstate.Options
	var input, marker, reference string
	var maxParseMiB int64
	var streamNative bool
	f.StringVar(&input, "input", "", "snapshot JSON (read only)")
	f.StringVar(&marker, "marker", "", "native integrity marker file (read only)")
	f.StringVar(&reference, "reference", "", "optional same-family reference snapshot for full-content comparison")
	f.StringVar(&o.SourceFamily, "source-family", "", "native-baseline-v2, native-a-v1, native-a-v2, abci-a-v14, or abci-c-v13")
	f.Int64Var(&maxParseMiB, "max-parse-mib", maxInputBytes>>20, "full JSON parsing budget (1..1024 MiB); larger files receive a streamed whole-file digest and a blocked report")
	f.BoolVar(&streamNative, "stream-native", false, "strict bounded streaming audit for native-baseline-v2; embedded integrity and migration remain unverified")
	f.StringVar(&o.SourceCommit, "source-commit", "", "declared source commit; must match frozen schema catalog")
	f.StringVar(&o.TargetFamily, "target-family", "vnext", "vnext always blocks until an actual target schema exists")
	f.StringVar(&o.ExpectedSHA256, "sha256", "", "independently recorded input byte SHA-256")
	f.StringVar(&o.CommittedHeight, "committed-height", "", "declared committed height, decimal integer")
	f.StringVar(&o.CommittedHash, "committed-hash", "", "declared native last block hash or ABCI appHash")
	f.StringVar(&o.Durability, "durability", "unknown", "operator declaration only: confirmed, uncertain, or unknown")
	if e := f.Parse(args); e != nil || input == "" || f.NArg() != 0 || maxParseMiB < 1 || maxParseMiB > 1024 {
		fmt.Fprintln(out, `{"error":"INVALID_ARGUMENTS","migrationSafe":false}`)
		return 1
	}
	if streamNative {
		if reference != "" {
			fmt.Fprintln(out, `{"error":"STREAM_REFERENCE_COMPARISON_NOT_IMPLEMENTED","migrationSafe":false}`)
			return 2
		}
		if marker != "" {
			var e error
			o.Marker, e = readInput(marker, 16)
			if e != nil {
				fmt.Fprintln(out, `{"error":"MARKER_READ_FAILED","migrationSafe":false}`)
				return 1
			}
		}
		inputFile, e := os.Open(input)
		if e != nil {
			fmt.Fprintln(out, `{"error":"INPUT_READ_FAILED","migrationSafe":false}`)
			return 1
		}
		defer inputFile.Close()
		st, e := inputFile.Stat()
		if e != nil || !st.Mode().IsRegular() {
			fmt.Fprintln(out, `{"error":"INPUT_NOT_REGULAR_FILE","migrationSafe":false}`)
			return 1
		}
		previousLimit := debug.SetMemoryLimit(128 << 20)
		defer debug.SetMemoryLimit(previousLimit)
		r := executionstate.AuditNativeStream(inputFile, o, executionstate.DefaultStreamLimits())
		if json.NewEncoder(out).Encode(r) != nil {
			return 1
		}
		return 2
	}
	inputState, e := readSnapshot(input, maxParseMiB<<20)
	if e != nil {
		fmt.Fprintf(out, "{\"error\":%q,\"migrationSafe\":false}\n", e.Error())
		return 1
	}
	if inputState.digestOnly {
		r := executionstate.AuditDigestOnly(inputState.sha, inputState.size, maxParseMiB<<20, o)
		if json.NewEncoder(out).Encode(r) != nil {
			return 1
		}
		return 2
	}
	b := inputState.data
	if marker != "" {
		o.Marker, e = readInput(marker, 16)
		if e != nil {
			fmt.Fprintln(out, `{"error":"MARKER_READ_FAILED","migrationSafe":false}`)
			return 1
		}
	}
	if reference != "" {
		o.Reference, e = readInput(reference, maxParseMiB<<20)
		if e != nil {
			fmt.Fprintln(out, `{"error":"REFERENCE_READ_FAILED","migrationSafe":false}`)
			return 1
		}
	}
	r := executionstate.Audit(b, o)
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	if enc.Encode(r) != nil {
		return 1
	}
	if r.Status != "compatible" {
		return 2
	}
	return 0
}
func main() { os.Exit(run(os.Args[1:], os.Stdout)) }
