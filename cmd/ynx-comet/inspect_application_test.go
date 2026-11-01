package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

func inspectFreshCommandArgs(f initializeCommandFixture, path, layout string) []string {
	args := f.args(path, layout)
	args[0] = "inspect-fresh-application"
	return args
}
func executeInspectFreshCommand(args []string) ([]byte, error) {
	var out bytes.Buffer
	root := &cobra.Command{Use: "ynx-comet", SilenceUsage: true, SilenceErrors: true, PersistentPreRunE: func(*cobra.Command, []string) error {
		return errors.New("read-only CLI entered runtime config/home creation")
	}}
	root.AddCommand(newInspectFreshApplicationCommand())
	root.SetOut(&out)
	root.SetErr(&out)
	root.SetArgs(args)
	err := root.Execute()
	return out.Bytes(), err
}
func TestInspectFreshApplicationCommandNormalAndIndependentProcess(t *testing.T) {
	if os.Getenv("YNX_PUBLIC_FRESH_INSPECT_CHILD") == "1" {
		var args []string
		if json.Unmarshal([]byte(os.Getenv("YNX_PUBLIC_FRESH_INSPECT_ARGS")), &args) != nil {
			os.Exit(9)
		}
		raw, err := executeInspectFreshCommand(args)
		if err != nil {
			os.Stderr.WriteString(err.Error())
			os.Exit(8)
		}
		os.Stdout.Write(raw)
		os.Exit(0)
	}
	f := newInitializeCommandFixture(t)
	path := filepath.Join(t.TempDir(), "application", "state.blocks")
	initialized, err := executeInitializeCommand(t, f.args(path, "block-journal"))
	if err != nil {
		t.Fatal(err)
	}
	var init consensus.ApplicationInitializationResult
	if err = json.Unmarshal(initialized, &init); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	args := inspectFreshCommandArgs(f, path, "block-journal")
	wire, _ := json.Marshal(args)
	command := exec.Command(os.Args[0], "-test.run=^TestInspectFreshApplicationCommandNormalAndIndependentProcess$")
	command.Env = append(os.Environ(), "YNX_PUBLIC_FRESH_INSPECT_CHILD=1", "YNX_PUBLIC_FRESH_INSPECT_ARGS="+string(wire))
	raw, err := command.CombinedOutput()
	if err != nil {
		t.Fatal(err, string(raw))
	}
	var result consensus.FreshApplicationInspectionResult
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err, string(raw))
	}
	if result.ProcessID == os.Getpid() || result.ProcessID != command.ProcessState.Pid() || result.StateSHA256 != init.StateSHA256 || !result.ReadOnly || !result.FreshApplicationVerified || result.Initialized || result.NodeStarted || result.SigningPerformed || result.ConsensusVerified || result.AuthorityGranted || result.PQActivated {
		t.Fatal("independent normal CLI did not prove fresh read-only DATA", result)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("normal independent CLI changed original", err)
	}
	assertInitializeInputsUnchanged(t, f)
}
func TestInspectFreshApplicationCommandStrictFlagsAndBadInputs(t *testing.T) {
	f := newInitializeCommandFixture(t)
	path := filepath.Join(t.TempDir(), "application", "state.blocks")
	if _, err := executeInitializeCommand(t, f.args(path, "block-journal")); err != nil {
		t.Fatal(err)
	}
	original, _ := os.ReadFile(path)
	for _, kind := range []string{"duplicate-path", "duplicate-pin", "missing-layout", "wrong-pin", "pq-schedule", "runtime-plan", "positional", "missing-state", "duplicate-migration-field", "symlink-migration"} {
		t.Run(kind, func(t *testing.T) {
			args := inspectFreshCommandArgs(f, path, "block-journal")
			var restore func()
			switch kind {
			case "duplicate-path":
				args = append(args, "--abci-state", path)
			case "duplicate-pin":
				args = append(args, "--original-genesis-hash", f.options.originalGenesisHash)
			case "missing-layout":
				args = append(args[:7], args[9:]...)
			case "wrong-pin":
				args[len(args)-1] = strings.Repeat("f", 64)
			case "pq-schedule":
				args = append(args, "--pq-engine-schedule", "PUBLIC-cannot-authorize")
			case "runtime-plan":
				args = append(args, "--runtime-upgrade-plan", "PUBLIC-cannot-replace-fresh")
			case "positional":
				args = append(args, "unexpected")
			case "missing-state":
				args[6] = filepath.Join(t.TempDir(), "not-created", "state")
			case "duplicate-migration-field":
				raw := f.originals[f.options.migration]
				bad := append([]byte(`{"sourceFormat":"substituted",`), raw[1:]...)
				if err := os.WriteFile(f.options.migration, bad, 0600); err != nil {
					t.Fatal(err)
				}
				restore = func() {
					if err := os.WriteFile(f.options.migration, raw, 0600); err != nil {
						t.Fatal(err)
					}
				}
			case "symlink-migration":
				link := filepath.Join(t.TempDir(), "alias.json")
				if err := os.Symlink(f.options.migration, link); err != nil {
					t.Fatal(err)
				}
				args[4] = link
			}
			if restore != nil {
				defer restore()
			}
			if raw, err := executeInspectFreshCommand(args); err == nil {
				t.Fatal("invalid normal inspection accepted", kind, string(raw))
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(original, after) {
				t.Fatal("refused CLI changed original application", err)
			}
		})
	}
	assertInitializeInputsUnchanged(t, f)
}
