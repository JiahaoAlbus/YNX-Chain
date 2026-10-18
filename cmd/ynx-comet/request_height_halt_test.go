package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/node"
	"github.com/spf13/cobra"
)

func executeHeightHaltPublication(args []string) ([]byte, error) {
	var output bytes.Buffer
	root := &cobra.Command{Use: "ynx-comet", SilenceErrors: true, SilenceUsage: true, PersistentPreRunE: func(*cobra.Command, []string) error {
		return errors.New("halt publication entered node runtime configuration/home creation")
	}}
	root.AddCommand(newRequestHeightHaltCommand())
	root.SetArgs(args)
	root.SetOut(&output)
	root.SetErr(&output)
	err := root.Execute()
	return output.Bytes(), err
}

type heightHaltPublicationCommandFixture struct {
	args                       []string
	root, request, app, target string
	raw                        []byte
	pin                        string
}

func newHeightHaltPublicationCommandFixture(t *testing.T) heightHaltPublicationCommandFixture {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		t.Fatal(err)
	}
	app := filepath.Join(root, "original.application")
	if err := os.WriteFile(app, []byte("original application bytes; publication must never decode or execute them\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	control := node.HeightHaltControl{Path: filepath.Join(root, "operator-height-halt-"+strings.Repeat("c", 64)+".json"), ChainID: "ynx_6423-1", GenesisSHA256: strings.Repeat("a", 64), OperatorPlanSHA256: strings.Repeat("b", 64), SessionID: strings.Repeat("c", 64)}
	raw, err := json.MarshalIndent(node.HeightHaltRequest{Version: "YNX-OPERATOR-HEIGHT-HALT/v1", TargetHeight: "17", ChainID: control.ChainID, GenesisSHA256: control.GenesisSHA256, OperatorPlanSHA256: control.OperatorPlanSHA256, SessionID: control.SessionID}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	digest := sha256.Sum256(raw)
	pin := hex.EncodeToString(digest[:])
	request := filepath.Join(root, "independently-approved-request.json")
	if err := os.WriteFile(request, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	args := []string{"request-height-halt", "--request", request, "--request-sha256", pin, "--abci-state", app, "--height-halt-control", control.Path, "--chain-id", control.ChainID, "--consensus-genesis-sha256", control.GenesisSHA256, "--operator-plan-sha256", control.OperatorPlanSHA256, "--height-halt-session-id", control.SessionID}
	return heightHaltPublicationCommandFixture{args: args, root: root, request: request, app: app, target: control.Path, raw: raw, pin: pin}
}

// Snapshot exact public fixture files without following a symlink. No daemon,
// network, actual App execution or production credential is part of this test.
func heightHaltPublicationCommandFiles(t *testing.T, root string) map[string]string {
	t.Helper()
	files := make(map[string]string)
	if err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		value := info.Mode().String()
		if info.Mode()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			value += link
		} else if info.Mode().IsRegular() {
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			value += string(raw)
		}
		files[path] = value
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return files
}

func TestRequestHeightHaltNormalCommandOnlyPublishesApprovedOriginal(t *testing.T) {
	f := newHeightHaltPublicationCommandFixture(t)
	before := heightHaltPublicationCommandFiles(t, f.root)
	output, err := executeHeightHaltPublication(f.args)
	if runtime.GOOS != "linux" {
		if err == nil || !strings.Contains(err.Error(), "Linux renameat2 RENAME_NOREPLACE") || len(output) != 0 || !reflect.DeepEqual(before, heightHaltPublicationCommandFiles(t, f.root)) {
			t.Fatal("unsupported normal command wrote files or reported success", string(output), err)
		}
		return
	}
	if err != nil {
		t.Fatal("normal Linux request publication failed", string(output), err)
	}
	var result consensus.HeightHaltPublicationResult
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatal(err)
	}
	if result.Version != "YNX-OPERATOR-HEIGHT-HALT-PUBLISHED/v1" || result.ControlPath != f.target || result.RequestSHA256 != f.pin || result.TargetHeight != "17" || !result.Published || result.NodeStopped || result.Activation {
		t.Fatal("publication was reported as completed shutdown/activation", result)
	}
	after := heightHaltPublicationCommandFiles(t, f.root)
	for path, original := range before {
		if after[path] != original {
			t.Fatal("normal publisher changed original application/input", path)
		}
	}
	published, err := os.ReadFile(f.target)
	if err != nil || !bytes.Equal(published, f.raw) {
		t.Fatal("normal command did not preserve approved raw bytes", err)
	}
	if output, err := executeHeightHaltPublication(f.args); err == nil || len(output) != 0 {
		t.Fatal("normal command overwrote an existing request", string(output), err)
	}
	if !reflect.DeepEqual(after, heightHaltPublicationCommandFiles(t, f.root)) {
		t.Fatal("repeated normal command changed original first effect")
	}
}

func TestRequestHeightHaltNormalCommandRejectsWrongPinsAndMissingIdentity(t *testing.T) {
	for _, kind := range []string{"wrong-request-pin", "wrong-genesis", "wrong-plan", "wrong-session", "missing-chain", "duplicate-pin", "unknown-RPC", "symlink-request", "oversized-request", "non-string-height"} {
		t.Run(kind, func(t *testing.T) {
			f := newHeightHaltPublicationCommandFixture(t)
			args := append([]string(nil), f.args...)
			switch kind {
			case "wrong-request-pin":
				args[4] = strings.Repeat("d", 64)
			case "wrong-genesis":
				args[12] = strings.Repeat("d", 64)
			case "wrong-plan":
				args[14] = strings.Repeat("d", 64)
			case "wrong-session":
				args[16] = strings.Repeat("d", 64)
			case "missing-chain":
				args = append(args[:9], args[11:]...)
			case "duplicate-pin":
				args = append(args, "--request-sha256", f.pin)
			case "unknown-RPC":
				args = append(args, "--rpc", "http://untrusted.invalid")
			case "symlink-request":
				alias := filepath.Join(f.root, "request-alias")
				if err := os.Symlink(f.request, alias); err != nil {
					t.Fatal(err)
				}
				args[2] = alias
			case "oversized-request", "non-string-height":
				raw := bytes.Repeat([]byte{'x'}, node.MaxHeightHaltRequestBytes+1)
				if kind == "non-string-height" {
					raw = bytes.Replace(f.raw, []byte(`"targetHeight": "17"`), []byte(`"targetHeight": 17`), 1)
				}
				if err := os.WriteFile(f.request, raw, 0o600); err != nil {
					t.Fatal(err)
				}
				digest := sha256.Sum256(raw)
				args[4] = hex.EncodeToString(digest[:])
			}
			before := heightHaltPublicationCommandFiles(t, f.root)
			output, err := executeHeightHaltPublication(args)
			if err == nil || bytes.Contains(output, []byte(`"published":true`)) {
				t.Fatal("unapproved/incomplete normal request accepted", kind, string(output), err)
			}
			if !reflect.DeepEqual(before, heightHaltPublicationCommandFiles(t, f.root)) {
				t.Fatal("rejected command changed original source/partial/request")
			}
		})
	}
}
