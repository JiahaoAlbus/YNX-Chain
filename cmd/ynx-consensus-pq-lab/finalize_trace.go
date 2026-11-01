//go:build unix

package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func runPQLabFinalizeTrace(args []string, out io.Writer) error {
	if len(args) == 0 || args[0] != "export" && args[0] != "replay" {
		return errors.New("choose finalize-trace export or replay")
	}
	fs := flag.NewFlagSet("finalize-trace "+args[0], flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	synthetic := fs.Bool("synthetic", false, "required isolated loopback DATA scope; not authority or a live wire comparison")
	output := fs.String("output", "", "fresh absolute public output directory; partial/UNKNOWN never overwritten")
	if args[0] == "replay" {
		directory := fs.String("trace", "", "original complete public trace bundle")
		pin := fs.String("trace-sha256", "", "independent exact original result.json SHA256")
		if err := parsePQLabFlags(fs, args[1:]); err != nil {
			return err
		}
		if !*synthetic {
			return errors.New("explicit synthetic trace acknowledgement required")
		}
		result, err := consensus.ReplayPQLabFinalizeTrace(context.Background(), *directory, *pin, *output)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(result)
	}
	var options consensus.PQLabFinalizeTraceOptions
	fs.StringVar(&options.RootDir, "root", "", "original four-process loopback lab root; stopped actual stores only")
	fs.StringVar(&options.PlanSHA256, "plan-sha256", "", "independent original network-plan.json SHA256")
	fs.StringVar(&options.ActivationSHA256, "activation-sha256", "", "independent original activation receipt SHA256")
	fs.Int64Var(&options.ExpectedHeight, "height", 0, "exact original four-node stopped committed height")
	fs.StringVar(&options.ExpectedAppHash, "app-hash", "", "exact original four-node stopped AppHash")
	if err := parsePQLabFlags(fs, args[1:]); err != nil {
		return err
	}
	if !*synthetic {
		return errors.New("explicit synthetic trace acknowledgement required")
	}
	options.OutputDir = *output
	result, err := consensus.ExportPQLabFinalizeTrace(context.Background(), options)
	if err != nil {
		return err
	}
	// Lost stdout does not delete the durable result, re-sign, or replay export.
	return json.NewEncoder(out).Encode(result)
}
