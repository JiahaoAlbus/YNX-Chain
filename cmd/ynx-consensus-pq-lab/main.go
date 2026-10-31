//go:build unix

// ynx-consensus-pq-lab prepares fresh synthetic inputs for four independent
// normal ynx-comet processes. It is not a node runner or a public-network tool.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

type createResult struct {
	Version          string                          `json:"version"`
	PlanFile         string                          `json:"planFile"`
	PlanSHA256       string                          `json:"planSHA256"`
	Plan             consensus.PQLabNetworkPlan      `json:"plan"`
	Workload         consensus.PQLabWorkloadManifest `json:"workload"`
	NodeStarted      bool                            `json:"nodeStarted"`
	PQQuorumVerified bool                            `json:"pqQuorumVerified"`
}

func run(args []string, out io.Writer) error {
	if len(args) == 0 {
		return errors.New("choose create, registration, halt, activate, export, sender, presigned or proof-context")
	}
	if args[0] == "proof-context" {
		return runPQLabProofContext(args[1:], out)
	}
	if args[0] == "live-materials" {
		return runPQLabLiveMaterials(args[1:], out)
	}
	if args[0] == "export" {
		return runPQLabExport(args[1:], out)
	}
	if args[0] == "sender" {
		return runPQLabSender(args[1:], out)
	}
	if args[0] == "presigned" {
		return runPQLabPreSigned(args[1:], out)
	}
	if args[0] != "create" && args[0] != "registration" && args[0] != "halt" && args[0] != "activate" {
		return errors.New("unknown PQ lab operation")
	}
	fs := flag.NewFlagSet("ynx-consensus-pq-lab "+args[0], flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	synthetic := fs.Bool("synthetic", false, "required acknowledgement: fresh loopback lab only, never public custody")
	root := fs.String("root", "", "canonical absolute fresh lab root for create; original root for later stages")
	var pin *string
	var index *int
	var height *int64
	var count, batch, owners, p2p, rpc *int
	var online *bool
	if args[0] == "create" {
		count = fs.Int("transactions", 32, "bounded original AND transfer corpus (1..1024)")
		batch = fs.Int("batch-size", 1, "power-of-two members per original transaction (1..1024, no waiting for batches)")
		owners = fs.Int("owners", 1, "independent synthetic transaction owners (1..1000)")
		online = fs.Bool("online", false, "retain new synthetic sender custody for explicit bounded signing; no network submission")
		p2p = fs.Int("base-p2p-port", 31656, "four distinct loopback P2P ports")
		rpc = fs.Int("base-rpc-port", 31757, "four distinct loopback RPC ports")
	} else {
		pin = fs.String("plan-sha256", "", "independent exact original network-plan.json SHA256")
	}
	if args[0] == "registration" {
		index = fs.Int("node", -1, "original validator index (0..3)")
		height = fs.Int64("approved-at", 0, "actual quiet next execution height; never inferred by this tool")
	}
	if args[0] == "halt" {
		height = fs.Int64("height", 0, "explicit future common engine halt height")
	}
	if err := parsePQLabFlags(fs, args[1:]); err != nil {
		return err
	}
	if !*synthetic || *root == "" {
		return errors.New("require --synthetic and exact --root; public identities and existing data cannot be substituted")
	}
	var result any
	var err error
	switch args[0] {
	case "create":
		if *owners < 1 || *owners > consensus.MaxPQLabOwners {
			return errors.New("explicit owners must be between 1 and 1000")
		}
		if err = preflightPQLabCreate(*root); err != nil {
			return err
		}
		source, sourceErr := consensus.NewPQLabWorkloadSource(consensus.PQLabWorkloadOptions{Transfers: *count, BatchSize: *batch, Owners: *owners, Online: *online})
		if sourceErr != nil {
			return sourceErr
		}
		defer source.Destroy()
		plan, createErr := consensus.GeneratePQLabNetwork(source.Migration, consensus.PQLabNetworkOptions{RootDir: *root, BaseP2P: *p2p, BaseRPC: *rpc})
		if createErr != nil {
			return createErr
		}
		raw, readErr := os.ReadFile(plan.MigrationFile)
		if readErr != nil {
			return readErr
		}
		var bound chain.ConsensusMigrationState
		if err = json.Unmarshal(raw, &bound); err != nil {
			return err
		}
		workload, writeErr := source.WriteCorpus(filepath.Join(*root, "workload"), bound)
		if writeErr != nil {
			return writeErr
		}
		planFile := filepath.Join(*root, "network-plan.json")
		planBytes, readErr := os.ReadFile(planFile)
		if readErr != nil {
			return readErr
		}
		digest := sha256.Sum256(planBytes)
		result = createResult{Version: "YNX-PQ-LAB-CREATED/v1", PlanFile: planFile, PlanSHA256: hex.EncodeToString(digest[:]), Plan: plan, Workload: workload}
	case "registration":
		result, err = consensus.PreparePQLabValidatorRegistration(*root, *pin, *index, *height)
	case "halt":
		result, err = consensus.PublishPQLabHeightHalt(*root, *pin, *height)
	case "activate":
		result, err = consensus.ActivatePQLabNetwork(*root, *pin)
	}
	if err != nil {
		return err
	}
	// On a broken stdout the original result/keys remain on disk. No cleanup or
	// automatic replay is performed; the runner reconciles the original files.
	return json.NewEncoder(out).Encode(result)
}

// This dispatch reads only the original stopped stores and PUBLIC originals.
// The normal proof-context command remains a separate consumer of its pinned
// output; neither step obtains authority from the untrusted proof itself.
func runPQLabExport(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("ynx-consensus-pq-lab export", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	synthetic := fs.Bool("synthetic", false, "required isolated loopback acknowledgement")
	var o consensus.PQLabExportOptions
	fs.StringVar(&o.RootDir, "root", "", "original four-node lab root")
	fs.StringVar(&o.PlanSHA256, "plan-sha256", "", "independent original network plan SHA256")
	fs.StringVar(&o.ActivationSHA256, "activation-sha256", "", "independent original activation receipt SHA256")
	fs.StringVar(&o.TransactionFile, "transaction", "", "original public corpus/sender ABCI envelope")
	fs.StringVar(&o.TransactionSHA256, "transaction-sha256", "", "independent exact ABCI envelope hash")
	fs.StringVar(&o.NativeWireHash, "native-wire-hash", "", "independent exact native wire SHA256, without 0x")
	fs.StringVar(&o.OutputDir, "output", "", "fresh public export directory; failed attempts retained")
	fs.DurationVar(&o.TrustingPeriod, "trusting-period", 0, "explicit positive local light trusting period")
	fs.DurationVar(&o.MaxClockDrift, "max-clock-drift", 0, "explicit positive local maximum clock drift")
	fs.Uint64Var(&o.TrustNumerator, "trust-numerator", 0, "explicit light trust numerator")
	fs.Uint64Var(&o.TrustDenominator, "trust-denominator", 0, "explicit light trust denominator")
	if err := parsePQLabFlags(fs, args); err != nil {
		return err
	}
	if !*synthetic {
		return errors.New("export requires --synthetic; no public-network custody accepted")
	}
	result, err := consensus.ExportPQLabProof(o, time.Now().UTC())
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}

// Refuse an existing/UNKNOWN root before generating even new in-memory lab
// keys. The library still performs the authoritative exclusive Mkdir later.
func preflightPQLabCreate(root string) error {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root {
		return errors.New("fresh lab root must be canonical and absolute")
	}
	parent := filepath.Dir(root)
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil || resolved != parent {
		return errors.New("lab parent must exist without aliases")
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 {
		return errors.New("lab parent must not be writable by other users")
	}
	if _, err = os.Lstat(root); !os.IsNotExist(err) {
		return errors.New("original or partial lab root exists; never regenerate or retry UNKNOWN")
	}
	return nil
}

func parsePQLabFlags(fs *flag.FlagSet, args []string) error {
	seen := map[string]bool{}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !strings.HasPrefix(arg, "-") || arg == "--" {
			return errors.New("unexpected positional lab argument")
		}
		name, value, hasValue := strings.Cut(strings.TrimLeft(arg, "-"), "=")
		_ = value
		f := fs.Lookup(name)
		if f == nil || seen[name] {
			return errors.New("unknown or duplicate lab flag")
		}
		seen[name] = true
		if !hasValue {
			if boolean, ok := f.Value.(interface{ IsBoolFlag() bool }); !ok || !boolean.IsBoolFlag() {
				i++
				if i >= len(args) {
					return errors.New("missing lab flag value")
				}
			}
		}
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("unexpected positional lab argument")
	}
	return nil
}
