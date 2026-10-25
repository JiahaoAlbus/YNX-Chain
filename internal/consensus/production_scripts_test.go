//go:build linux

package consensus

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
)

// The generated scripts execute against a private fake root. Only identity,
// ownership and systemctl are substituted; keycheck calls the real verifier,
// and mkdir/install/tar/dd/ln operate on real isolated files. No sudo, service,
// network or production path is used. No tests here run in parallel.
type productionScriptFixture struct {
	base, role, root, keys, systemd, trace, commands, binary string
	env                                                      []string
}

func productionScriptWrite(t *testing.T, path string, data []byte, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, mode); err != nil {
		t.Fatal(err)
	}
}

func productionScriptRead(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func newProductionScriptFixture(t *testing.T) *productionScriptFixture {
	t.Helper()
	f := &productionScriptFixture{base: t.TempDir()}
	f.root = filepath.Join(f.base, "host", "var", "lib", "ynx-chain", "consensus-candidate")
	f.keys = filepath.Join(f.base, "host", "etc", "ynx", "consensus-candidate", "primary")
	f.systemd = filepath.Join(f.base, "host", "etc", "systemd", "system")
	f.trace = filepath.Join(f.base, "commands.log")
	f.commands = filepath.Join(f.base, "commands")
	f.binary = filepath.Join(f.base, "package", "roles", "bin")
	migration := fourValidatorMigration(t)
	manifest, keys := productionValidatorFixture(t, migration)
	packageRoot := filepath.Join(f.base, "package")
	if _, err := GenerateProductionCandidatePackage(migration, manifest, packageRoot, time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	f.role = filepath.Join(packageRoot, "roles", "primary")
	for target, source := range map[string]string{
		"priv_validator_key.json":   keys["primary"][0],
		"node_key.json":             keys["primary"][1],
		"priv_validator_state.json": filepath.Join(filepath.Dir(keys["primary"][0]), "data", "priv_validator_state.json"),
	} {
		productionScriptWrite(t, filepath.Join(f.keys, target), productionScriptRead(t, source), 0600)
	}
	for _, name := range []string{"ynx-consensus-abci-candidate.service", "ynx-consensus-comet-candidate.service"} {
		productionScriptWrite(t, filepath.Join(f.systemd, name), []byte("isolated unit\n"), 0644)
	}
	// Rewrite only host path constants in the generated shell, including the
	// old rollback archive allowlist, so an old-source RED cannot touch the host.
	replacer := strings.NewReplacer(
		"/var/lib/ynx-chain", filepath.Dir(f.root),
		"/etc/ynx/consensus-candidate/primary", f.keys,
		"/etc/systemd/system", f.systemd,
		"var/lib/ynx-chain", strings.TrimPrefix(filepath.Dir(f.root), "/"),
		"etc/systemd/system", strings.TrimPrefix(f.systemd, "/"),
	)
	for _, name := range []string{"install-candidate.sh", "backup-candidate.sh", "rollback-candidate.sh"} {
		path := filepath.Join(f.role, "scripts", name)
		productionScriptWrite(t, path, []byte(replacer.Replace(string(productionScriptRead(t, path)))), 0700)
	}
	real := map[string]string{}
	for _, name := range []string{"bash", "install", "mkdir", "tar", "dd", "ln"} {
		path, err := exec.LookPath(name)
		if err != nil {
			t.Fatal(err)
		}
		real[name] = path
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	f.env = []string{"PATH=" + f.commands + ":" + os.Getenv("PATH"), "YNX_PRODUCTION_SCRIPT_HELPER=1", "YNX_SCRIPT_TEST_BINARY=" + self,
		"YNX_TEST_TRACE=" + f.trace, "YNX_TEST_CANDIDATE=" + f.root,
		"YNX_REAL_INSTALL=" + real["install"], "YNX_REAL_MKDIR=" + real["mkdir"], "YNX_REAL_TAR=" + real["tar"]}
	shims := map[string]string{
		"id":        `test "$#" = 1 && test "$1" = -u; echo 0`,
		"systemctl": `printf 'systemctl %s\n' "$*" >>"$YNX_TEST_TRACE"`,
		"install": `args=(); while test "$#" -gt 0; do case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac; done
if test "${YNX_TEST_INSTALL_FAILURE:-}" = 1; then echo 'injected install I/O failure' >&2; exit 74; fi
exec "$YNX_REAL_INSTALL" "${args[@]}"`,
		"mkdir": `if test "${YNX_TEST_INSTALL_RACE:-}" = 1 && test "${!#}" = "$YNX_TEST_CANDIDATE"; then
  "$YNX_REAL_MKDIR" -p "$YNX_TEST_CANDIDATE/data"
  printf 'concurrent owner HRS retained\n' >"$YNX_TEST_CANDIDATE/data/priv_validator_state.json"
fi
exec "$YNX_REAL_MKDIR" "$@"`,
		"tar": `if test "${YNX_TEST_TAR_FAILURE:-}" = 1 && test "$1" = -czf; then
  if test "$2" = -; then printf 'partial archive retained\n'; else printf 'partial archive retained\n' >"$2"; fi
  echo 'injected tar I/O failure' >&2; exit 73
fi
if test -n "${YNX_TEST_BACKUP_RACE_OUTPUT:-}" && test "$1" = -tzf; then
  (set -o noclobber; printf 'concurrent completed archive\n' >"$YNX_TEST_BACKUP_RACE_OUTPUT")
fi
exec "$YNX_REAL_TAR" "$@"`,
	}
	for name, body := range shims {
		productionScriptWrite(t, filepath.Join(f.commands, name), []byte("#!/usr/bin/env bash\nset -euo pipefail\n"+body+"\n"), 0700)
	}
	for _, name := range []string{"ynx-abci", "cometbft"} {
		productionScriptWrite(t, filepath.Join(f.binary, name), []byte("#!/usr/bin/env bash\nexit 0\n"), 0700)
	}
	productionScriptWrite(t, filepath.Join(f.binary, "ynx-consensus-keycheck"), []byte("#!/usr/bin/env bash\nexec \"$YNX_SCRIPT_TEST_BINARY\" -test.run=^TestProductionRoleScriptKeyCheckHelper$ -- \"$@\"\n"), 0700)
	return f
}

// A subprocess adapter to the actual production key verifier, not a success
// callback. Bad keys and permissive modes must fail before any install claim.
func TestProductionRoleScriptKeyCheckHelper(t *testing.T) {
	if os.Getenv("YNX_PRODUCTION_SCRIPT_HELPER") != "1" {
		return
	}
	var args []string
	for i, value := range os.Args {
		if value == "--" {
			args = os.Args[i+1:]
			break
		}
	}
	if len(args) != 6 || args[0] != "-role-manifest" || args[2] != "-private-validator-key" || args[4] != "-node-key" {
		os.Exit(91)
	}
	if err := VerifyProductionKeyFiles(args[1], args[3], args[5]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	trace, err := os.OpenFile(os.Getenv("YNX_TEST_TRACE"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		os.Exit(92)
	}
	_, err = trace.WriteString("actual-keycheck-passed\n")
	if closeErr := trace.Close(); err != nil || closeErr != nil {
		os.Exit(93)
	}
	os.Exit(0)
}

func (f *productionScriptFixture) run(t *testing.T, name string, extraEnv []string, args ...string) ([]byte, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "bash", append([]string{filepath.Join(f.role, "scripts", name)}, args...)...)
	cmd.Env = append(append(os.Environ(), f.env...), extraEnv...)
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatal("isolated generated script timed out", name, string(output))
	}
	return output, err
}

func (f *productionScriptFixture) signedState(t *testing.T, height int64) string {
	t.Helper()
	path := filepath.Join(f.root, "data", "priv_validator_state.json")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		productionScriptWrite(t, path, productionScriptRead(t, filepath.Join(f.keys, "priv_validator_state.json")), 0600)
	}
	pv := privval.LoadFilePV(filepath.Join(f.keys, "priv_validator_key.json"), path)
	vote := &cmtproto.Vote{Type: cmtproto.PrecommitType, Height: height, Round: 0, Timestamp: time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC), ValidatorAddress: pv.Key.Address, ValidatorIndex: 0}
	if err := pv.SignVote("ynx_6423-1", vote); err != nil {
		t.Fatal(err)
	}
	if len(vote.Signature) == 0 {
		t.Fatal("actual validator did not sign preservation fixture")
	}
	return path
}

func productionScriptUnchanged(t *testing.T, path string) func() {
	t.Helper()
	before := productionScriptRead(t, path)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return func() {
		t.Helper()
		after, err := os.ReadFile(path)
		current, statErr := os.Stat(path)
		if err != nil || statErr != nil || !bytes.Equal(before, after) || !os.SameFile(info, current) || info.Mode() != current.Mode() || !info.ModTime().Equal(current.ModTime()) {
			t.Fatalf("PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED: file changed: %s read=%v stat=%v", filepath.Base(path), err, statErr)
		}
	}
}

func TestProductionRoleScriptsPreserveSignedStateAndUnknownResults(t *testing.T) {
	t.Run("existing-signed-install", func(t *testing.T) {
		f := newProductionScriptFixture(t)
		hrs := f.signedState(t, 17)
		check := productionScriptUnchanged(t, hrs)
		unknown := filepath.Join(f.root, "data", "persist.UNKNOWN")
		productionScriptWrite(t, unknown, []byte("original uncertain result retained\n"), 0600)
		checkUnknown := productionScriptUnchanged(t, unknown)
		output, err := f.run(t, "install-candidate.sh", nil)
		check()
		checkUnknown()
		if err == nil {
			t.Fatal("PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED: existing signed tree accepted", string(output))
		}
		trace := string(productionScriptRead(t, f.trace))
		if !strings.Contains(trace, "actual-keycheck-passed") || strings.Contains(trace, "systemctl") {
			t.Fatal("existing-tree refusal bypassed keycheck or changed services", trace)
		}
	})
	for _, kind := range []string{"file", "symlink"} {
		t.Run("existing-install-"+kind, func(t *testing.T) {
			f := newProductionScriptFixture(t)
			if err := os.MkdirAll(filepath.Dir(f.root), 0700); err != nil {
				t.Fatal(err)
			}
			if kind == "file" {
				productionScriptWrite(t, f.root, []byte("original UNKNOWN candidate\n"), 0600)
			} else if err := os.Symlink("original-missing-target", f.root); err != nil {
				t.Fatal(err)
			}
			info, err := os.Lstat(f.root)
			if err != nil {
				t.Fatal(err)
			}
			if output, err := f.run(t, "install-candidate.sh", nil); err == nil {
				t.Fatal("PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED: occupied root accepted", kind, string(output))
			}
			current, err := os.Lstat(f.root)
			if err != nil || !os.SameFile(info, current) || info.Mode() != current.Mode() {
				t.Fatal("occupied candidate root replaced", kind, err)
			}
		})
	}
	t.Run("concurrent-install-claim", func(t *testing.T) {
		f := newProductionScriptFixture(t)
		output, err := f.run(t, "install-candidate.sh", []string{"YNX_TEST_INSTALL_RACE=1"})
		if err == nil || !bytes.Equal(productionScriptRead(t, filepath.Join(f.root, "data", "priv_validator_state.json")), []byte("concurrent owner HRS retained\n")) {
			t.Fatal("PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED: competing install was not preserved", err, string(output))
		}
	})
	for _, kind := range []string{"output", "partial", "partial-symlink", "partial-fifo", "publication-race"} {
		t.Run("backup-"+kind, func(t *testing.T) {
			f := newProductionScriptFixture(t)
			hrs := f.signedState(t, 17)
			checkHRS := productionScriptUnchanged(t, hrs)
			output := filepath.Join(f.base, "archive.tar.gz")
			path := output + ".partial"
			var check func()
			var env []string
			switch kind {
			case "output", "partial":
				if kind == "output" {
					path = output
				}
				productionScriptWrite(t, path, []byte("previous result UNKNOWN\n"), 0600)
				check = productionScriptUnchanged(t, path)
			case "partial-symlink":
				if err := os.Symlink("retained-missing-target", path); err != nil {
					t.Fatal(err)
				}
			case "partial-fifo":
				if err := syscall.Mkfifo(path, 0600); err != nil {
					t.Fatal(err)
				}
			case "publication-race":
				env = []string{"YNX_TEST_BACKUP_RACE_OUTPUT=" + output}
			}
			result, err := f.run(t, "backup-candidate.sh", env, output)
			checkHRS()
			if check != nil {
				check()
			}
			if err == nil {
				t.Fatal("PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED: existing/racing backup replaced", kind, string(result))
			}
			if kind == "partial-symlink" {
				if target, err := os.Readlink(path); err != nil || target != "retained-missing-target" {
					t.Fatal("PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED: old partial symlink changed", err)
				}
			}
			if kind == "partial-fifo" {
				if info, err := os.Lstat(path); err != nil || info.Mode()&os.ModeNamedPipe == 0 {
					t.Fatal("PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED: old partial FIFO changed", err)
				}
			}
			if kind == "publication-race" && !bytes.Equal(productionScriptRead(t, output), []byte("concurrent completed archive\n")) {
				t.Fatal("PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED: archive publication overwrote competitor")
			}
		})
	}
	t.Run("rollback-signed-history", func(t *testing.T) {
		f := newProductionScriptFixture(t)
		f.signedState(t, 7)
		archive := filepath.Join(f.base, "old.tar.gz")
		if output, err := f.run(t, "backup-candidate.sh", nil, archive); err != nil {
			t.Fatal("valid isolated backup failed", err, string(output))
		}
		hrs := f.signedState(t, 17)
		checkHRS, checkArchive := productionScriptUnchanged(t, hrs), productionScriptUnchanged(t, archive)
		unknown := filepath.Join(f.root, "data", "persist.UNKNOWN")
		productionScriptWrite(t, unknown, []byte("newer uncertain result retained\n"), 0600)
		checkUnknown := productionScriptUnchanged(t, unknown)
		output, err := f.run(t, "rollback-candidate.sh", nil, archive)
		checkHRS()
		checkArchive()
		checkUnknown()
		if err == nil || !strings.Contains(string(output), "automatic candidate state rollback refused") {
			t.Fatal("PRODUCTION_SCRIPT_HISTORY_NOT_PRESERVED: unsafe rollback did not explicitly refuse", err, string(output))
		}
		if trace, err := os.ReadFile(f.trace); err == nil && strings.Contains(string(trace), "systemctl") {
			t.Fatal("refused rollback changed service state")
		}
	})
}

func TestProductionRoleScriptsFreshInstallAndFailuresRetainEvidence(t *testing.T) {
	t.Run("fresh-install-and-repeat", func(t *testing.T) {
		f := newProductionScriptFixture(t)
		if output, err := f.run(t, "install-candidate.sh", nil); err != nil {
			t.Fatal("fresh isolated install failed", err, string(output))
		}
		hrs := filepath.Join(f.root, "data", "priv_validator_state.json")
		if !bytes.Equal(productionScriptRead(t, hrs), productionScriptRead(t, filepath.Join(f.keys, "priv_validator_state.json"))) {
			t.Fatal("fresh install changed original key ceremony HRS")
		}
		check := productionScriptUnchanged(t, f.signedState(t, 17))
		if _, err := f.run(t, "install-candidate.sh", nil); err == nil {
			t.Fatal("repeat install was accepted")
		}
		check()
	})
	t.Run("real-keycheck-before-claim", func(t *testing.T) {
		f := newProductionScriptFixture(t)
		if err := os.Chmod(filepath.Join(f.keys, "node_key.json"), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := f.run(t, "install-candidate.sh", nil); err == nil {
			t.Fatal("actual permissive-key check was bypassed")
		}
		if _, err := os.Lstat(f.root); !os.IsNotExist(err) {
			t.Fatal("failed keycheck created a candidate tree", err)
		}
	})
	t.Run("failed-install-retained", func(t *testing.T) {
		f := newProductionScriptFixture(t)
		output, err := f.run(t, "install-candidate.sh", []string{"YNX_TEST_INSTALL_FAILURE=1"})
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 74 || !strings.Contains(string(output), "injected install I/O failure") {
			t.Fatal("install lost original failure", err, string(output))
		}
		if _, err := os.Stat(f.root); err != nil {
			t.Fatal("failed installation claim was removed", err)
		}
		if _, err := f.run(t, "install-candidate.sh", nil); err == nil {
			t.Fatal("partial installation was silently retried")
		}
	})
	t.Run("failed-archive-retained", func(t *testing.T) {
		f := newProductionScriptFixture(t)
		f.signedState(t, 17)
		archive := filepath.Join(f.base, "failure.tar.gz")
		output, err := f.run(t, "backup-candidate.sh", []string{"YNX_TEST_TAR_FAILURE=1"}, archive)
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 73 || !strings.Contains(string(output), "injected tar I/O failure") {
			t.Fatal("archive lost original failure", err, string(output))
		}
		partial := archive + ".partial"
		if !bytes.Equal(productionScriptRead(t, partial), []byte("partial archive retained\n")) {
			t.Fatal("partial bytes lost")
		}
		check := productionScriptUnchanged(t, partial)
		if _, err := f.run(t, "backup-candidate.sh", nil, archive); err == nil {
			t.Fatal("uncertain archive silently retried")
		}
		check()
		if _, err := os.Lstat(archive); !os.IsNotExist(err) {
			t.Fatal("failed archive was published", err)
		}
	})
	t.Run("fresh-archive-retains-partial", func(t *testing.T) {
		f := newProductionScriptFixture(t)
		check := productionScriptUnchanged(t, f.signedState(t, 17))
		archive := filepath.Join(f.base, "fresh.tar.gz")
		if output, err := f.run(t, "backup-candidate.sh", nil, archive); err != nil {
			t.Fatal("fresh archive failed", err, string(output))
		}
		check()
		info, err := os.Stat(archive)
		partial, partialErr := os.Stat(archive + ".partial")
		if err != nil || partialErr != nil || !os.SameFile(info, partial) || info.Mode().Perm() != 0600 {
			t.Fatal("archive publication lost restrictive original partial", err, partialErr)
		}
	})
}

func TestProductionRollbackCallerRefusesBeforeTransport(t *testing.T) {
	repository, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"without-archive", "with-archive", "dry-run", "missing-approval", "invalid-release"} {
		t.Run(kind, func(t *testing.T) {
			base := t.TempDir()
			// Use the real normal wrapper and both libraries, isolated from any
			// repository .env. Transport shims only record calls; never execute
			// their remote command. Thus the old unsafe source is also fenced.
			for _, relative := range []string{"scripts/ops/rollback-consensus-candidate.sh", "scripts/ops/lib.sh", "scripts/deploy/lib.sh"} {
				productionScriptWrite(t, filepath.Join(base, relative), productionScriptRead(t, filepath.Join(repository, relative)), 0700)
			}
			commands := filepath.Join(base, "commands")
			trace := filepath.Join(base, "transport.log")
			for _, name := range []string{"ssh", "scp", "sudo", "systemctl"} {
				productionScriptWrite(t, filepath.Join(commands, name), []byte("#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >>\"$YNX_ROLLBACK_TEST_TRACE\"\nexit 0\n"), 0700)
			}
			key := filepath.Join(base, "synthetic-unused-key")
			productionScriptWrite(t, key, nil, 0600)
			envFile := filepath.Join(base, "isolated.env")
			var config strings.Builder
			for i, prefix := range []string{"PRIMARY", "SG", "SILICON_VALLEY", "SEOUL"} {
				fmt.Fprintf(&config, "%s_NODE_HOST=127.0.0.%d\n%s_NODE_USER=ynx\n%s_NODE_SSH_KEY=%q\n", prefix, i+1, prefix, prefix, key)
			}
			productionScriptWrite(t, envFile, []byte(config.String()), 0600)
			release := "ynx-consensus-candidate-0123456789ab"
			approval, dryRun, backup := "yes", "0", ""
			switch kind {
			case "with-archive":
				backup = "ynx-consensus-candidate-abcdef012345"
			case "dry-run":
				dryRun = "1"
			case "missing-approval":
				approval = ""
			case "invalid-release":
				release = "invalid-release"
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "bash", filepath.Join(base, "scripts/ops/rollback-consensus-candidate.sh"))
			cmd.Dir = base
			cmd.Env = append(os.Environ(), "PATH="+commands+":"+os.Getenv("PATH"), "ENV_FILE="+envFile,
				"YNX_ROLLBACK_TEST_TRACE="+trace, "YNX_SSH_CONTROL_DIR="+filepath.Join(base, "ssh-control"),
				"CONSENSUS_CANDIDATE_ROLLBACK_APPROVED="+approval, "DEPLOY_DRY_RUN="+dryRun,
				"CONSENSUS_CANDIDATE_RELEASE="+release, "CONSENSUS_CANDIDATE_BACKUP_RELEASE="+backup)
			output, runErr := cmd.CombinedOutput()
			if ctx.Err() != nil {
				t.Fatal("isolated rollback caller timed out", string(output))
			}
			if calls, err := os.ReadFile(trace); err == nil {
				t.Fatalf("PRODUCTION_ROLLBACK_TRANSPORT_NOT_PRESERVED: automatic rollback reached transport/privilege command: %s", calls)
			} else if !os.IsNotExist(err) {
				t.Fatal(err)
			}
			if _, err := os.Lstat(filepath.Join(base, "ssh-control")); !os.IsNotExist(err) {
				t.Fatal("PRODUCTION_ROLLBACK_TRANSPORT_NOT_PRESERVED: rollback created transport state", err)
			}
			switch kind {
			case "dry-run":
				if runErr != nil {
					t.Fatal("four-role preservation dry run failed", runErr, string(output))
				}
				for _, role := range []string{"primary", "singapore", "silicon-valley", "seoul"} {
					if !strings.Contains(string(output), "DRY RUN ["+role+"] UNSAFE_AUTOMATIC_CANDIDATE_ROLLBACK_REFUSED") {
						t.Fatal("PRODUCTION_ROLLBACK_TRANSPORT_NOT_PRESERVED: dry run lost role refusal", role, string(output))
					}
				}
				for _, unsafe := range []string{"sudo ", "rm -", "tar -x", "candidate rolled back", "ssh -i"} {
					if strings.Contains(string(output), unsafe) {
						t.Fatal("PRODUCTION_ROLLBACK_TRANSPORT_NOT_PRESERVED: dry run constructed destructive/transport command", unsafe)
					}
				}
			case "missing-approval":
				if runErr == nil || !strings.Contains(string(output), "CONSENSUS_CANDIDATE_ROLLBACK_APPROVED=yes is required") {
					t.Fatal("rollback lost original authorization guard", runErr, string(output))
				}
			case "invalid-release":
				if runErr == nil || !strings.Contains(string(output), "CONSENSUS_CANDIDATE_RELEASE is invalid") {
					t.Fatal("rollback lost original release guard", runErr, string(output))
				}
			default:
				if runErr == nil || !strings.Contains(string(output), "UNSAFE_AUTOMATIC_CANDIDATE_ROLLBACK_REFUSED") {
					t.Fatal("PRODUCTION_ROLLBACK_TRANSPORT_NOT_PRESERVED: unsafe rollback did not refuse before SSH", runErr, string(output))
				}
			}
		})
	}
}
