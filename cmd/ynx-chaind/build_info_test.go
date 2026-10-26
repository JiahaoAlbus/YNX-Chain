package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const buildInfoTestCommit = "0123456789abcdef0123456789abcdef01234567"
const buildInfoTestRelease = "ynx-native-build-info-public-fixture"
const buildInfoTestTime = "2026-10-26T00:00:00Z"
const buildInfoTestJSON = `{"commit":"` + buildInfoTestCommit + `","release":"` + buildInfoTestRelease + `","buildTime":"` + buildInfoTestTime + `"}` + "\n"

func buildInfoInvalidStartup(t *testing.T) (nodeRuntimeConfig, string) {
	t.Helper()
	parent := t.TempDir()
	t.Setenv("YNX_FAUCET_CORE_AUTH_TOKEN_FILE", filepath.Join(parent, "unavailable-token"))
	t.Setenv("YNX_VALIDATOR_SET", "invalid validator configuration")
	t.Setenv("YNX_BOOTSTRAP_PEERS", "invalid bootstrap configuration")
	return nodeRuntimeConfig{
		BuildInfo:                true,
		HTTPAddr:                 "invalid listen address",
		Network:                  "mainnet",
		DataDir:                  filepath.Join(parent, "missing-data"),
		LocalValidator:           "invalid validator",
		PeerSyncRaw:              "invalid peer target",
		BlockProduction:          true,
		BlockProductionPauseFile: filepath.Join(parent, "missing-pause"),
		ReplicationSource:        "not a URL",
		CheckConfig:              true,
		EthereumNativeTransfers:  true,
		ExportConsensusState:     filepath.Join(parent, "must-not-export"),
		PQAdmissionHeight:        "not a height",
	}, parent
}

func requireBuildInfoNoFiles(t *testing.T, parent string) {
	t.Helper()
	entries, err := os.ReadDir(parent)
	if err != nil || len(entries) != 0 {
		t.Fatalf("build-info touched node resources: entries=%v err=%v", entries, err)
	}
}

func TestRunNodeBuildInfoBeforeAllStartupResources(t *testing.T) {
	setBuildInfoForTest(t, " "+buildInfoTestCommit+" ", " "+buildInfoTestRelease+" ", " "+buildInfoTestTime+" ")
	cfg, parent := buildInfoInvalidStartup(t)
	var output bytes.Buffer
	if err := runNode(cfg, &output); err != nil {
		t.Fatalf("build-info entered startup or export: %v", err)
	}
	if output.String() != buildInfoTestJSON {
		t.Fatalf("build-info did not preserve the original public three-field identity: %q", output.String())
	}
	requireBuildInfoNoFiles(t, parent)
	// The same unavailable token is rejected by the original non-build-info
	// path. It cannot silently serve as an empty credential or start a node.
	cfg.BuildInfo = false
	cfg.ExportConsensusState = ""
	output.Reset()
	if err := runNode(cfg, &output); err == nil || output.Len() != 0 {
		t.Fatalf("normal startup bypassed its resource guard: err=%v output=%q", err, output.String())
	}
	requireBuildInfoNoFiles(t, parent)
}

type buildInfoFailureWriter struct {
	bytes.Buffer
	limit int
	err   error
	calls int
}

func (w *buildInfoFailureWriter) Write(p []byte) (int, error) {
	w.calls++
	n := len(p)
	if n > w.limit {
		n = w.limit
	}
	_, _ = w.Buffer.Write(p[:n])
	return n, w.err
}

func TestRunNodeBuildInfoPreservesWriterFailureAndShortWrite(t *testing.T) {
	setBuildInfoForTest(t, buildInfoTestCommit, buildInfoTestRelease, buildInfoTestTime)
	sentinel := errors.New("synthetic public build-info writer refusal")
	for _, tc := range []struct {
		name  string
		limit int
		write error
		want  error
	}{
		{"refused", 0, sentinel, sentinel},
		{"partial-error", 7, sentinel, sentinel},
		{"short-without-error", 7, nil, io.ErrShortWrite},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, parent := buildInfoInvalidStartup(t)
			writer := &buildInfoFailureWriter{limit: tc.limit, err: tc.write}
			if err := runNode(cfg, writer); !errors.Is(err, tc.want) {
				t.Fatalf("lost original stdout failure: %v", err)
			}
			if writer.calls != 1 || writer.String() != buildInfoTestJSON[:tc.limit] {
				t.Fatal("build-info retried output or lost the partial public result")
			}
			requireBuildInfoNoFiles(t, parent)
		})
	}
}

func TestChaindBuildInfoNormalCLI(t *testing.T) {
	parent := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, "-test.run=^TestChaindBuildInfoCLIHelper$", "--",
		"--build-info", "--network", "invalid-network", "--http", "invalid listen address",
		"--data-dir", filepath.Join(parent, "missing-data"),
		"--export-consensus-state", filepath.Join(parent, "must-not-export"),
		"--check-config", "--pq-admission-height", "not a height")
	cmd.Env = append(os.Environ(), "YNX_CHAIND_BUILD_INFO_HELPER=public-build-info-only",
		"YNX_FAUCET_CORE_AUTH_TOKEN_FILE="+filepath.Join(parent, "unavailable-token"),
		"YNX_VALIDATOR_SET=invalid validator configuration", "YNX_BOOTSTRAP_PEERS=invalid bootstrap configuration")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	raw, err := cmd.Output()
	if err != nil || string(raw) != buildInfoTestJSON || stderr.Len() != 0 {
		t.Fatalf("normal CLI build-info failed: err=%v stdout=%q stderr=%q", err, raw, stderr.String())
	}
	requireBuildInfoNoFiles(t, parent)
}

func TestChaindBuildInfoCLIHelper(t *testing.T) {
	if os.Getenv("YNX_CHAIND_BUILD_INFO_HELPER") != "public-build-info-only" {
		return
	}
	args := append([]string(nil), flag.Args()...)
	if len(args) == 0 || args[0] != "--build-info" || strings.Contains(strings.Join(args, "\x00"), "\n") {
		t.Fatal("synthetic build-info child arguments required")
	}
	flag.CommandLine = flag.NewFlagSet("ynx-chaind", flag.ExitOnError)
	os.Args = append([]string{"ynx-chaind"}, args...)
	buildCommit, buildRelease, buildTime = buildInfoTestCommit, buildInfoTestRelease, buildInfoTestTime
	main()
	os.Exit(0)
}
