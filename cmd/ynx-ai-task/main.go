package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aitaskclient"
)

var buildCommit = "unknown"
var buildRelease = "local"
var buildTime = "unknown"

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(ctx context.Context, args []string, out, diagnostics io.Writer) error {
	flags := flag.NewFlagSet("ynx-ai-task", flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	action := flags.String("action", "health", "version, health, session, conversation-create, task-list/create/show/prepare/cancel/complete, step-propose/approve/dispatch/reconcile/result, run-start/resume/show, operation-show, inspect-file")
	endpoint := flags.String("daemon", "http://127.0.0.1:6438", "original AI loopback daemon origin")
	proofPath := flags.String("proof-file", "", "private file containing a fresh original Wallet V2 proof; not a task Grant")
	dataPath := flags.String("data-file", "", "private JSON request file; prompts and Grant refs are never CLI arguments")
	journalPath := flags.String("journal", "", "absolute private operation-journal directory, required for mutations")
	operation := flags.String("operation", "", "unique local delivery ID; retained IDs never resend mutations")
	task := flags.String("task", "", "original task ID")
	step := flags.String("step", "", "original step ID")
	runID := flags.String("run", "", "original run ID")
	cursor := flags.Uint64("after-cursor", 0, "last event cursor for bounded task projection")
	afterTask := flags.String("after-task", "", "original task ID cursor for bounded owned task discovery")
	file := flags.String("file", "", "explicit local file for inspect-file; contents never sent to daemon/model")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional argument")
	}
	if *action == "version" {
		return json.NewEncoder(out).Encode(map[string]string{"client": "ynx-ai-task", "commit": buildCommit, "release": buildRelease, "buildTime": buildTime})
	}
	if *action == "inspect-file" {
		result, err := aitaskclient.InspectFile(ctx, *file)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(result)
	}
	var journal *aitaskclient.Journal
	var err error
	if *journalPath != "" {
		journal, err = aitaskclient.OpenJournal(*journalPath)
		if err != nil {
			return err
		}
	}
	if *action == "operation-show" {
		if journal == nil {
			return errors.New("journal required")
		}
		record, err := journal.Read(*operation)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(record)
	}
	input := aitaskclient.Request{Action: *action, TaskID: *task, StepID: *step, RunID: *runID, OperationID: *operation, AfterCursor: *cursor, AfterTaskID: *afterTask}
	route, err := aitaskclient.Resolve(input)
	if err != nil {
		return err
	}
	if route.Private {
		raw, err := aitaskclient.ReadPrivateFile(*proofPath, 16386)
		if err != nil {
			return errors.New("read a bounded private fresh Wallet proof file")
		}
		input.Proof = strings.TrimSpace(string(raw))
	}
	if *dataPath != "" {
		raw, err := aitaskclient.ReadPrivateFile(*dataPath, 64<<10)
		if err != nil {
			return errors.New("read a bounded private JSON request file")
		}
		input.Body = raw
	}
	client, err := aitaskclient.New(*endpoint, journal)
	if err != nil {
		return err
	}
	response, callErr := client.Do(ctx, input)
	// Print only the response explicitly requested by this invocation. It is not
	// cached in the delivery journal, nor treated as a model/tool receipt here.
	if len(response.Body) > 0 {
		if _, err := out.Write(append(response.Body, '\n')); err != nil {
			return errors.Join(callErr, err)
		}
	}
	if response.Operation != nil {
		if err := json.NewEncoder(diagnostics).Encode(map[string]any{"operationId": response.Operation.ID, "deliveryState": response.Operation.State, "businessAcceptance": false}); err != nil {
			return errors.Join(callErr, err)
		}
	}
	return callErr
}
