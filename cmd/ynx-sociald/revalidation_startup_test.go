package main

import (
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSocialRevalidationConfigChild(t *testing.T) {
	mode := os.Getenv("YNX_SOCIAL_REVALIDATION_QA_CHILD")
	if mode == "" {
		return
	}
	flag.CommandLine = flag.NewFlagSet("ynx-sociald-qa", flag.ExitOnError)
	os.Args = []string{"ynx-sociald-qa", "-state-dir", os.Getenv("YNX_SOCIAL_REVALIDATION_QA_STATE")}
	if mode == "check" {
		os.Args = append(os.Args, "-check-config")
	}
	main()
}

func TestSocialRevalidationConfigCheckAndStartupFailClosed(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		name, mode, id, file string
		wantSuccess          bool
	}{
		{"disabled-check", "check", "", "", true},
		{"partial-id-check", "check", "synthetic-test-id", "", false},
		{"partial-file-check", "check", "", "/synthetic-sensitive-path-not-opened", false},
		{"invalid-file-check", "check", "synthetic-test-id", "/synthetic-sensitive-path-not-present", false},
		{"partial-startup", "startup", "synthetic-test-id", "", false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			state := filepath.Join(t.TempDir(), "must-not-create-state")
			cmd := exec.Command(executable, "-test.run=^TestSocialRevalidationConfigChild$")
			for _, entry := range os.Environ() {
				if !strings.HasPrefix(entry, "YNX_SOCIAL_") {
					cmd.Env = append(cmd.Env, entry)
				}
			}
			cmd.Env = append(cmd.Env, "YNX_SOCIAL_REVALIDATION_QA_CHILD="+scenario.mode, "YNX_SOCIAL_REVALIDATION_QA_STATE="+state, "YNX_SOCIAL_TOKEN_KEY="+strings.Repeat("11", 32), "YNX_SOCIAL_INTERNAL_API_KEY=synthetic-test-only-internal-key", "YNX_SOCIAL_REVALIDATION_KEY_ID="+scenario.id, "YNX_SOCIAL_REVALIDATION_PRIVATE_KEY_FILE="+scenario.file)
			output, err := cmd.CombinedOutput()
			if (err == nil) != scenario.wantSuccess {
				t.Fatalf("wrong config/startup result: %v %s", err, output)
			}
			if scenario.wantSuccess && !strings.Contains(string(output), "revalidation configured=false; runtime authority not verified") {
				t.Fatal("disabled check misleadingly claims configured/live authority")
			}
			if !scenario.wantSuccess && !strings.Contains(string(output), socialRevalidationConfigMessage) {
				t.Fatal("invalid configuration lacks fixed diagnostic")
			}
			if scenario.file != "" && strings.Contains(string(output), scenario.file) {
				t.Fatal("sensitive file path leaked")
			}
			if _, err := os.Stat(state); !os.IsNotExist(err) {
				t.Fatal("invalid/off check wrote service state")
			}
		})
	}
}
