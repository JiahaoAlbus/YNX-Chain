//go:build unix

package main

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
)

type stateDirectoryOriginal struct {
	info os.FileInfo
	raw  []byte
	link string
}

func snapshotStateDirectoryOriginals(t *testing.T, roots ...string) map[string]stateDirectoryOriginal {
	t.Helper()
	originals := make(map[string]stateDirectoryOriginal)
	for _, root := range roots {
		if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			original := stateDirectoryOriginal{info: info}
			switch {
			case info.Mode().IsRegular():
				original.raw, err = os.ReadFile(path)
			case info.Mode()&os.ModeSymlink != 0:
				original.link, err = os.Readlink(path)
			}
			if err == nil {
				originals[path] = original
			}
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	return originals
}

func assertStateDirectoryOriginals(t *testing.T, before, after map[string]stateDirectoryOriginal) {
	t.Helper()
	if len(before) != len(after) {
		t.Fatal("refused state-dir changed the original file inventory")
	}
	for path, original := range before {
		current, exists := after[path]
		if !exists || !os.SameFile(original.info, current.info) || original.info.Mode() != current.info.Mode() ||
			original.info.Size() != current.info.Size() || !original.info.ModTime().Equal(current.info.ModTime()) ||
			!bytes.Equal(original.raw, current.raw) || original.link != current.link {
			t.Fatal("refused state-dir changed an original", path)
		}
	}
}

func stateDirectoryNoWriteIO(writeCalls, stateCalls *int) ceremonyIO {
	stopped := errors.New("synthetic refusal boundary; no key generation or ceremony write")
	return ceremonyIO{
		writeExclusive: func(string, []byte) error {
			*writeCalls += 1
			return stopped
		},
		createState: func(string, *ynxconsensusauth.CandidateKey, ynxconsensusauth.Policy, ynxconsensusauth.Registry, []byte, uint64) (*ynxconsensusauth.Signer, error) {
			*stateCalls += 1
			return nil, stopped
		},
	}
}

func TestPQKeyInitSeparateHRSInvalidDirectoriesBeforeGeneration(t *testing.T) {
	for _, name := range []string{"same", "state-inside-custody", "custody-inside-state", "symlink", "parent-symlink", "mode-0755", "nonempty-UNKNOWN"} {
		t.Run(name, func(t *testing.T) {
			f := fixture(t)
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			private := func(path string) string {
				t.Helper()
				if err := os.Mkdir(path, 0o700); err != nil {
					t.Fatal(err)
				}
				return path
			}
			state := private(filepath.Join(root, "hrs"))
			problem := "state-dir and out-dir must be separate directories without containment"
			switch name {
			case "same":
				state = f.paths.Directory
			case "state-inside-custody":
				state = private(filepath.Join(f.paths.Directory, "hrs"))
			case "custody-inside-state":
				f.options.directory = private(filepath.Join(state, "custody"))
				f.paths, err = newPaths(f.options.directory)
				if err != nil {
					t.Fatal(err)
				}
			case "symlink":
				alias := filepath.Join(root, "hrs-alias")
				if err := os.Symlink(state, alias); err != nil {
					t.Fatal(err)
				}
				state = alias
				problem = "must not alias another directory"
			case "parent-symlink":
				parent := private(filepath.Join(root, "actual-parent"))
				private(filepath.Join(parent, "hrs"))
				alias := filepath.Join(root, "parent-alias")
				if err := os.Symlink(parent, alias); err != nil {
					t.Fatal(err)
				}
				state = filepath.Join(alias, "hrs")
				problem = "must not alias another directory"
			case "mode-0755":
				if err := os.Chmod(state, 0o755); err != nil {
					t.Fatal(err)
				}
				problem = "must already exist with exact mode 0700"
			case "nonempty-UNKNOWN":
				if err := os.WriteFile(filepath.Join(state, ".UNKNOWN-original"), []byte("synthetic prior HRS outcome must remain untouched"), 0o600); err != nil {
					t.Fatal(err)
				}
				problem = "separate HRS directory must be empty"
			}
			f.options.stateDirectory = state
			roots := []string{root, f.paths.Directory, filepath.Dir(f.options.request)}
			before := snapshotStateDirectoryOriginals(t, roots...)
			fd := retainedCredentialDescriptor(t, f.credential)
			// run owns its parsed descriptor even on a later public-data refusal.
			// A second owned FD observes the same offset without depending on the
			// closed descriptor number or accepting a credential read.
			observer, err := syscall.Dup(fd)
			if err != nil {
				syscall.Close(fd)
				t.Fatal(err)
			}
			defer syscall.Close(observer)
			writeCalls, stateCalls := 0, 0
			var out, diagnostics bytes.Buffer
			err = run(f.args(fd), &out, &diagnostics, stateDirectoryNoWriteIO(&writeCalls, &stateCalls))
			if err == nil || !strings.Contains(err.Error(), problem) || name == "nonempty-UNKNOWN" && !errors.Is(err, errRetained) {
				t.Fatal("invalid separate HRS directory was not refused at its real preflight", err)
			}
			position, seekErr := syscall.Seek(observer, 0, io.SeekCurrent)
			if seekErr != nil || position != 0 || writeCalls != 0 || stateCalls != 0 || out.Len() != 0 || diagnostics.Len() != 0 {
				t.Fatal("invalid state-dir reached credential read, generation boundary or output", seekErr, writeCalls, stateCalls)
			}
			assertStateDirectoryOriginals(t, before, snapshotStateDirectoryOriginals(t, roots...))
		})
	}
}

func TestPQKeyInitStateDirectoryDuplicateSpellingsBeforeIO(t *testing.T) {
	f := fixture(t)
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(root, "hrs")
	if err := os.Mkdir(state, 0o700); err != nil {
		t.Fatal(err)
	}
	roots := []string{root, f.paths.Directory, filepath.Dir(f.options.request)}
	before := snapshotStateDirectoryOriginals(t, roots...)
	for _, prefixes := range [][2]string{{"-", "-"}, {"--", "--"}, {"-", "--"}, {"--", "-"}} {
		for style := 0; style < 4; style++ {
			t.Run(prefixes[0]+prefixes[1]+strconv.Itoa(style), func(t *testing.T) {
				fd := retainedCredentialDescriptor(t, f.credential)
				defer syscall.Close(fd)
				// Missing public inputs make refusal before any file preflight
				// observable; a duplicate must still win without closing this FD.
				args := []string{"--new-epoch", "--request", filepath.Join(root, "must-not-open-request.json"), "--request-sha256", f.options.requestHash,
					"--genesis", filepath.Join(root, "must-not-open-genesis.json"), "--genesis-sha256", f.options.genesisHash,
					"--out-dir", f.paths.Directory, "--recovery-fd", strconv.Itoa(fd)}
				args = append(args, optionArguments("state-dir", state, prefixes[0], style == 1 || style == 2)...)
				args = append(args, optionArguments("state-dir", filepath.Join(root, "different-hrs"), prefixes[1], style == 1 || style == 3)...)
				writeCalls, stateCalls := 0, 0
				var out, diagnostics bytes.Buffer
				err := run(args, &out, &diagnostics, stateDirectoryNoWriteIO(&writeCalls, &stateCalls))
				if err == nil || err.Error() != "duplicate -state-dir" || writeCalls != 0 || stateCalls != 0 || out.Len() != 0 || diagnostics.Len() != 0 {
					t.Fatal("duplicate state-dir did not precede parsing, file I/O and ceremony output", err)
				}
				assertUnconsumedDescriptor(t, fd)
				assertStateDirectoryOriginals(t, before, snapshotStateDirectoryOriginals(t, roots...))
			})
		}
	}
}
