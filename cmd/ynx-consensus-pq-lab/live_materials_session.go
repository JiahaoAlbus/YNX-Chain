//go:build unix

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

type pqLabLiveMaterialsCommand struct {
	Version           string `json:"version"`
	Operation         string `json:"operation"`
	Sequence          uint32 `json:"sequence,string"`
	TransactionFile   string `json:"transactionFile"`
	TransactionSHA256 string `json:"transactionSHA256"`
	NativeWireHash    string `json:"nativeWireHash"`
}

func runPQLabLiveMaterialsSession(args []string, out io.Writer) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runPQLabLiveMaterialsSessionOwnedInput(ctx, args, os.Stdin, out)
}
func runPQLabLiveMaterialsSessionOwnedInput(ctx context.Context, args []string, input io.ReadCloser, out io.Writer) (resultErr error) {
	if ctx == nil || input == nil {
		return errors.New("owned original live command stream and context required")
	}
	closed := make(chan struct{})
	var closeErr error
	stop := context.AfterFunc(ctx, func() { closeErr = input.Close(); close(closed) })
	defer func() {
		if !stop() {
			<-closed
		}
		resultErr = errors.Join(ctx.Err(), resultErr, closeErr)
	}()
	return runPQLabLiveMaterialsSessionInput(ctx, args, input, out)
}

// This single-lane public owner reuses static validation only. Commands remain
// synchronous, explicit and bounded; it neither polls nor starts a Node.
func runPQLabLiveMaterialsSessionInput(ctx context.Context, args []string, input io.Reader, out io.Writer) (resultErr error) {
	started := time.Now()
	f := flag.NewFlagSet("ynx-consensus-pq-lab live-materials-session", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	synthetic := f.Bool("synthetic", false, "original isolated loopback source only")
	policy := f.String("policy", "", "original fixed lane policy file")
	pin := f.String("policy-sha256", "", "independent original policy pin")
	ready := f.Bool("ready", false, "report fully validated held static source and R anchor; no current checkpoint/finality claim")
	timings := f.Bool("timings", false, "actual command timings; preparation measured separately")
	if err := parsePQLabFlags(f, args); err != nil {
		return err
	}
	if !*synthetic || ctx == nil || ctx.Err() != nil || *policy == "" || *pin == "" || input == nil {
		return errors.New("explicit original live lane and command stream required")
	}
	prepare := &consensus.PQLabMetrics{}
	session, err := consensus.OpenPQLabLiveMaterialsSession(ctx, *policy, *pin, prepare)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, session.Close()) }()
	startupNS := time.Since(started).Nanoseconds()
	if *ready {
		if err = json.NewEncoder(out).Encode(struct {
			Version                string                                   `json:"version"`
			Status                 string                                   `json:"status"`
			StartupElapsedNS       int64                                    `json:"startupElapsedNs"`
			Preparation            consensus.PQLabMetricsSnapshot           `json:"preparationTimings"`
			Session                consensus.PQLabLiveMaterialsSessionStats `json:"session"`
			SyntheticOnly          bool                                     `json:"syntheticOnly"`
			AuthorityGranted       bool                                     `json:"authorityGranted"`
			CurrentCheckpointClaim bool                                     `json:"currentCheckpointClaim"`
		}{"YNX-PQ-LAB-LIVE-MATERIALS-READY/v1", "original_static_source_and_anchor_held", startupNS, prepare.Snapshot(), session.Stats(), true, false, false}); err != nil {
			return err
		}
	}
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 32<<10)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var command pqLabLiveMaterialsCommand
		decoder := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&command); err != nil {
			return errors.New("invalid original live command")
		}
		canonical, e := json.Marshal(command)
		if e != nil || !bytes.Equal(canonical, scanner.Bytes()) || command.Version != "YNX-PQ-LAB-LIVE-MATERIALS-COMMAND/v1" || command.Sequence == 0 {
			return errors.New("exact original canonical live command required")
		}
		stats := session.Stats()
		if stats.Commands >= stats.CommandLimit {
			return errors.New("original live command limit reached")
		}
		if command.Operation != "request" && command.Operation != "result" {
			return errors.New("unsupported original live command")
		}
		if command.Operation == "result" && (command.TransactionFile != "" || command.TransactionSHA256 != "" || command.NativeWireHash != "") {
			return errors.New("result read cannot replace original transaction")
		}
		var metrics *consensus.PQLabMetrics
		if *timings {
			metrics = &consensus.PQLabMetrics{}
		}
		commandStart := time.Now()
		outcome := "REFUSED_OR_UNKNOWN_NO_RETRY"
		path := ""
		var result *consensus.PQLabLiveMaterialsResult
		if command.Operation == "request" {
			path, err = session.Publish(ctx, consensus.PQLabLiveMaterialsRequest{Version: "YNX-PQ-LAB-LIVE-MATERIALS-REQUEST/v1", PolicySHA256: *pin, Sequence: command.Sequence, TransactionFile: command.TransactionFile, TransactionSHA256: command.TransactionSHA256, NativeWireHash: command.NativeWireHash}, metrics)
			if err == nil {
				outcome = "request_published"
			}
		} else {
			var value consensus.PQLabLiveMaterialsResult
			value, err = session.Read(ctx, command.Sequence, metrics)
			if err == nil {
				outcome = "original_result_read"
				result = &value
			}
		}
		commandErr := err
		failureClass := pqLabLiveFailureClass(commandErr)
		firstCausePresent := commandErr != nil
		if commandErr != nil {
			// Only the fixed projection belongs in collected stdout. The original
			// error is returned after the reply, for the caller's private stderr.
			path = ""
		}
		var snapshot *consensus.PQLabMetricsSnapshot
		if *timings {
			value := metrics.Snapshot()
			snapshot = &value
		}
		reply := struct {
			Version           string                                   `json:"version"`
			Operation         string                                   `json:"operation"`
			Sequence          uint32                                   `json:"sequence,string"`
			Outcome           string                                   `json:"outcome"`
			RequestPath       string                                   `json:"requestPath,omitempty"`
			Result            *consensus.PQLabLiveMaterialsResult      `json:"result,omitempty"`
			FailureClass      string                                   `json:"failureClass,omitempty"`
			FirstCausePresent bool                                     `json:"firstCausePresent"`
			CalleeElapsedNS   int64                                    `json:"calleeElapsedNs"`
			StartupElapsedNS  int64                                    `json:"startupElapsedNs"`
			Timings           *consensus.PQLabMetricsSnapshot          `json:"timings,omitempty"`
			Session           consensus.PQLabLiveMaterialsSessionStats `json:"session"`
			SyntheticOnly     bool                                     `json:"syntheticOnly"`
			AuthorityGranted  bool                                     `json:"authorityGranted"`
		}{"YNX-PQ-LAB-LIVE-MATERIALS-REPLY/v1", command.Operation, command.Sequence, outcome, path, result, failureClass, firstCausePresent, time.Since(commandStart).Nanoseconds(), startupNS, snapshot, session.Stats(), true, false}
		if writeErr := json.NewEncoder(out).Encode(reply); writeErr != nil {
			return errors.Join(commandErr, writeErr)
		}
		if commandErr != nil {
			// A command refusal or uncertain publication ends this stream. Do
			// not consume a subsequent request, retry, or hide the first cause.
			return commandErr
		}
	}
	return errors.Join(scanner.Err(), ctx.Err())
}

func pqLabLiveFailureClass(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, consensus.ErrPQLabLiveMaterialsBusy) {
		return "BUSY"
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "CONTEXT_ENDED"
	}
	return "REFUSED_OR_UNKNOWN"
}
