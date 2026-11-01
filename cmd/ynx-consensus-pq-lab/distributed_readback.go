//go:build unix

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func runPQLabDistributedReadback(args []string, out io.Writer) error {
	if len(args) == 0 || args[0] != "capture" && args[0] != "compare" {
		return errors.New("choose distributed-readback capture or compare")
	}
	fs := flag.NewFlagSet("distributed-readback "+args[0], flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	synthetic := fs.Bool("synthetic", false, "required isolated synthetic source acknowledgement")
	if args[0] == "compare" {
		planPath := fs.String("plan", "", "original public plan file")
		planPin := fs.String("plan-sha256", "", "independent complete public plan SHA256")
		inputsPath := fs.String("receipts", "", "canonical JSON array of exactly four public directory/receiptSHA256 pairs")
		inputsPin := fs.String("receipts-sha256", "", "independent exact receipt-reference file SHA256")
		if err := parsePQLabFlags(fs, args[1:]); err != nil {
			return err
		}
		if !*synthetic {
			return errors.New("synthetic acknowledgement required")
		}
		plan, err := readPQLabDistributedPublic(*planPath, *planPin, consensus.MaxPQLabDistributedPlanBytes)
		if err != nil {
			return err
		}
		raw, err := readPQLabDistributedPublic(*inputsPath, *inputsPin, 64<<10)
		if err != nil {
			return err
		}
		var inputs []consensus.PQLabDistributedPublicInput
		if err = json.Unmarshal(raw, &inputs); err != nil {
			return err
		}
		canonical, err := json.Marshal(inputs)
		if err != nil || !bytes.Equal(canonical, raw) || len(inputs) != 4 {
			return errors.New("canonical closed four-receipt input required")
		}
		result, err := consensus.ComparePQLabDistributedReadbacks(plan, *planPin, inputs, time.Now().UTC())
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(result)
	}
	var o consensus.PQLabDistributedReadbackOptions
	fs.StringVar(&o.RootDir, "root", "", "THIS host's original imported distributed root")
	fs.StringVar(&o.PlanSHA256, "plan-sha256", "", "independent complete original public plan SHA256")
	fs.StringVar(&o.ActivationSHA256, "activation-sha256", "", "independent THIS host activation receipt SHA256, absent only before activation")
	fs.StringVar(&o.Mode, "mode", "", "snapshot, quiet, stopped or proof")
	fs.Int64Var(&o.ExpectedHeight, "height", 0, "exact original checkpoint height; optional only for snapshot observation")
	fs.StringVar(&o.ExpectedAppHash, "app-hash", "", "exact original checkpoint AppHash")
	fs.Int64Var(&o.FirstHeight, "from-height", 0, "complete retained height range start; default original initial height")
	fs.StringVar(&o.OutputDir, "output", "", "exclusive new public receipt directory; failed attempts are retained")
	fs.StringVar(&o.TransactionFile, "transaction", "", "original host-local public envelope; proof mode only")
	fs.StringVar(&o.TransactionSHA256, "transaction-sha256", "", "independent original ABCI envelope SHA256")
	fs.StringVar(&o.NativeWireHash, "native-wire-hash", "", "independent original native wire hash")
	fs.DurationVar(&o.TrustingPeriod, "trusting-period", 0, "explicit unchanged light client period; proof mode only")
	fs.DurationVar(&o.MaxClockDrift, "max-clock-drift", 0, "explicit unchanged light client clock drift")
	fs.Uint64Var(&o.TrustNumerator, "trust-numerator", 0, "explicit light trust fraction numerator")
	fs.Uint64Var(&o.TrustDenominator, "trust-denominator", 0, "explicit light trust fraction denominator")
	if err := parsePQLabFlags(fs, args[1:]); err != nil {
		return err
	}
	if !*synthetic {
		return errors.New("synthetic acknowledgement required")
	}
	if o.Mode != "proof" && (o.TransactionFile != "" || o.TransactionSHA256 != "" || o.NativeWireHash != "" || o.TrustingPeriod != 0 || o.MaxClockDrift != 0 || o.TrustNumerator != 0 || o.TrustDenominator != 0) {
		return errors.New("proof parameters cannot be ignored by another readback mode")
	}
	if o.Mode == "snapshot" || o.Mode == "quiet" {
		if o.FirstHeight != 0 {
			return errors.New("height history is available only under stopped original database leases")
		}
	}
	if err := distributedExecutingLocal(o.RootDir, o.PlanSHA256); err != nil {
		return err
	}
	// Cooperative cancellation and bounded HTTP reads do not claim a hard CPU
	// deadline for full cryptographic/state validation. No process is started.
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	result, err := consensus.ReadPQLabDistributedCheckpoint(ctx, o, time.Now().UTC())
	if err != nil {
		return err
	}
	// Broken stdout leaves the exact result.json and source originals intact.
	return json.NewEncoder(out).Encode(result)
}

func readPQLabDistributedPublic(path, pin string, limit int64) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || len(pin) != 64 {
		return nil, errors.New("canonical independently pinned public file required")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, errors.New("public file path must not follow aliases")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 || before.Size() > limit {
		return nil, errors.New("bounded regular public input required")
	}
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	after, err := os.Stat(path)
	if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || before.ModTime() != after.ModTime() || int64(len(raw)) != before.Size() {
		return nil, errors.New("public input changed during capture")
	}
	hash := sha256.Sum256(raw)
	if hex.EncodeToString(hash[:]) != pin {
		return nil, errors.New("independent public input pin differs")
	}
	return raw, nil
}
