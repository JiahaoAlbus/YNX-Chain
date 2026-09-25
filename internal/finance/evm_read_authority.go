package finance

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// NodeEVMReadAuthority delegates exact EVM/P-256 protocol verification to the
// accepted Wallet/Auth package. Its callback line is the synchronous boundary
// at which Finance commits challenge/session or proof/revocation state. The
// subprocess never reports success until the repository mutation approves it.
type NodeEVMReadAuthority struct {
	NodeBinary string
	Script     string
	Timeout    time.Duration
}

func NewNodeEVMReadAuthority(nodeBinary, script string, timeout time.Duration) (*NodeEVMReadAuthority, error) {
	if !filepath.IsAbs(nodeBinary) || !filepath.IsAbs(script) || timeout <= 0 || timeout > 10*time.Second {
		return nil, errors.New("Finance EVM read authority requires absolute runtime paths and bounded timeout")
	}
	for _, path := range []string{nodeBinary, script} {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return nil, errors.New("Finance EVM read authority runtime is unavailable")
		}
	}
	return &NodeEVMReadAuthority{NodeBinary: nodeBinary, Script: script, Timeout: timeout}, nil
}

func (a *NodeEVMReadAuthority) Invoke(ctx context.Context, input any, expectedOperation string, commit func(json.RawMessage) bool) (json.RawMessage, error) {
	if expectedOperation != "" && expectedOperation != "issue" && expectedOperation != "read" && expectedOperation != "revoke" {
		return nil, errors.New("Finance EVM read authority operation is invalid")
	}
	encoded, err := json.Marshal(input)
	if err != nil || len(encoded) == 0 || len(encoded) > 64<<10 {
		return nil, errors.New("Finance EVM read authority input is invalid")
	}
	callCtx, cancel := context.WithTimeout(ctx, a.Timeout)
	defer cancel()
	command := exec.CommandContext(callCtx, a.NodeBinary, a.Script)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, errors.New("Finance EVM read authority input pipe is unavailable")
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, errors.New("Finance EVM read authority output pipe is unavailable")
	}
	if err := command.Start(); err != nil {
		return nil, errors.New("Finance EVM read authority cannot start")
	}
	// Wait on every path; do not leave a cryptographic verifier subprocess
	// running after the request has failed or timed out.
	completed := false
	defer func() {
		if !completed && command.Process != nil {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
		_ = stdin.Close()
	}()
	if _, err := stdin.Write(append(encoded, '\n')); err != nil {
		return nil, errors.New("Finance EVM read authority input could not be sent")
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	commits := 0
	for scanner.Scan() {
		var event struct {
			Kind      string          `json:"kind"`
			Operation string          `json:"operation"`
			Proposal  json.RawMessage `json:"proposal"`
		}
		line := append([]byte(nil), scanner.Bytes()...)
		if json.Unmarshal(line, &event) != nil {
			return nil, errors.New("Finance EVM read authority emitted an invalid event")
		}
		switch event.Kind {
		case "commit":
			commits++
			if commits != 1 || commit == nil || event.Operation != expectedOperation || !json.Valid(event.Proposal) {
				return nil, errors.New("Finance EVM read authority requested an invalid commit")
			}
			approved := commit(event.Proposal)
			answer, _ := json.Marshal(struct {
				Approved bool `json:"approved"`
			}{approved})
			if _, err := stdin.Write(append(answer, '\n')); err != nil {
				return nil, errors.New("Finance EVM read authority commit reply failed")
			}
		case "result":
			if (expectedOperation == "" && commits != 0) || (expectedOperation != "" && commits != 1) {
				return nil, errors.New("Finance EVM read authority result has no exact durable commit")
			}
			_ = stdin.Close()
			if err := command.Wait(); err != nil || callCtx.Err() != nil {
				return nil, errors.New("Finance EVM read authority rejected the request")
			}
			completed = true
			return bytes.Clone(line), nil
		case "error":
			return nil, errors.New("Finance EVM read authority rejected the request")
		default:
			return nil, errors.New("Finance EVM read authority event type is invalid")
		}
	}
	return nil, errors.New("Finance EVM read authority ended without a result")
}
