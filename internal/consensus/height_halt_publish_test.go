//go:build linux

package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/cometbft/cometbft/node"
	"golang.org/x/sys/unix"
)

func heightHaltPublicationFixture(t *testing.T) ([]byte, string, HeightHaltPublicationOptions) {
	t.Helper()
	parent := t.TempDir()
	if err := os.Chmod(parent, 0o700); err != nil {
		t.Fatal(err)
	}
	options := HeightHaltPublicationOptions{ApplicationStatePath: filepath.Join(parent, "original.application"), Control: node.HeightHaltControl{ChainID: "ynx_6423-1", GenesisSHA256: strings.Repeat("a", 64), OperatorPlanSHA256: strings.Repeat("b", 64), SessionID: strings.Repeat("c", 64)}}
	options.Control.Path = filepath.Join(parent, "operator-height-halt-"+options.Control.SessionID+".json")
	if err := os.WriteFile(options.ApplicationStatePath, []byte("original application fixture bytes; publisher must never decode or write them\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	raw, err := json.MarshalIndent(node.HeightHaltRequest{Version: "YNX-OPERATOR-HEIGHT-HALT/v1", TargetHeight: "17", ChainID: options.Control.ChainID, GenesisSHA256: options.Control.GenesisSHA256, OperatorPlanSHA256: options.Control.OperatorPlanSHA256, SessionID: options.Control.SessionID}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	digest := sha256.Sum256(raw)
	return raw, hex.EncodeToString(digest[:]), options
}

func TestHeightHaltPublicationExactBytesSingleLinkAndExclusiveRepeat(t *testing.T) {
	raw, pin, options := heightHaltPublicationFixture(t)
	appBefore, err := os.ReadFile(options.ApplicationStatePath)
	if err != nil {
		t.Fatal(err)
	}
	result, err := PublishHeightHaltRequest(raw, pin, options)
	if err != nil || result.Version != "YNX-OPERATOR-HEIGHT-HALT-PUBLISHED/v1" || result.ControlPath != options.Control.Path || result.RequestSHA256 != pin || result.TargetHeight != "17" || result.ChainID != options.Control.ChainID || result.GenesisSHA256 != options.Control.GenesisSHA256 || result.OperatorPlanSHA256 != options.Control.OperatorPlanSHA256 || result.SessionID != options.Control.SessionID || !result.Published || result.NodeStopped || result.Activation {
		t.Fatal("normal exclusive publication failed or claimed shutdown", result, err)
	}
	published, err := os.ReadFile(options.Control.Path)
	if err != nil || !bytes.Equal(raw, published) {
		t.Fatal("approved request bytes changed", err)
	}
	if height, err := node.ValidateHeightHaltRequest(published, options.Control); err != nil || height != 17 {
		t.Fatal("normal consumer rejected the published original protocol", height, err)
	}
	var stat unix.Stat_t
	if err := unix.Lstat(options.Control.Path, &stat); err != nil || !privateHeightHaltPublicationStat(stat, false) || stat.Nlink != 1 {
		t.Fatal("publication is not a private same-owner single-link file", stat, err)
	}
	if _, err := os.Lstat(options.Control.Path + ".partial"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("successful rename retained a second staging name", err)
	}
	before := inspectionInventory(t, filepath.Dir(options.ApplicationStatePath))
	if result, err := PublishHeightHaltRequest(raw, pin, options); err == nil || result.Published {
		t.Fatal("repeat request replaced original material", result, err)
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, filepath.Dir(options.ApplicationStatePath))) {
		t.Fatal("repeat attempt changed the completed request or original state")
	}
	appAfter, err := os.ReadFile(options.ApplicationStatePath)
	if err != nil || !bytes.Equal(appBefore, appAfter) {
		t.Fatal("publisher touched application state", err)
	}
}

func TestHeightHaltPublicationRejectsExistingUnsafeOrUnapprovedInputs(t *testing.T) {
	for _, kind := range []string{"target", "target-symlink", "partial", "partial-symlink", "UNKNOWN", "tmp", "public-parent", "public-app", "app-symlink", "app-hardlink", "parent-symlink", "wrong-session-path", "relative-app", "wrong-request-pin", "wrong-genesis", "wrong-plan", "wrong-session", "wrong-chain", "duplicate-wire"} {
		t.Run(kind, func(t *testing.T) {
			raw, pin, options := heightHaltPublicationFixture(t)
			root := filepath.Dir(options.ApplicationStatePath)
			retained := filepath.Join(t.TempDir(), "retained-original")
			if err := os.WriteFile(retained, []byte("retain independent original bytes"), 0o600); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "target", "partial", "UNKNOWN", "tmp":
				suffix := ""
				if kind != "target" {
					suffix = "." + kind
				}
				if err := os.WriteFile(options.Control.Path+suffix, []byte("retain first effect"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "target-symlink", "partial-symlink":
				path := options.Control.Path
				if kind == "partial-symlink" {
					path += ".partial"
				}
				if err := os.Symlink(retained, path); err != nil {
					t.Fatal(err)
				}
			case "public-parent":
				if err := os.Chmod(root, 0o755); err != nil {
					t.Fatal(err)
				}
			case "public-app":
				if err := os.Chmod(options.ApplicationStatePath, 0o644); err != nil {
					t.Fatal(err)
				}
			case "app-symlink":
				options.ApplicationStatePath = filepath.Join(root, "alias")
				if err := os.Symlink(retained, options.ApplicationStatePath); err != nil {
					t.Fatal(err)
				}
			case "app-hardlink":
				if err := os.Link(options.ApplicationStatePath, filepath.Join(root, "second-state-name")); err != nil {
					t.Fatal(err)
				}
			case "parent-symlink":
				alias := filepath.Join(t.TempDir(), "alias")
				if err := os.Symlink(root, alias); err != nil {
					t.Fatal(err)
				}
				options.ApplicationStatePath = filepath.Join(alias, filepath.Base(options.ApplicationStatePath))
				options.Control.Path = filepath.Join(alias, filepath.Base(options.Control.Path))
			case "wrong-session-path":
				options.Control.Path = filepath.Join(root, "unapproved-name.json")
			case "relative-app":
				options.ApplicationStatePath = "relative.application"
			case "wrong-request-pin":
				pin = strings.Repeat("d", 64)
			case "wrong-genesis":
				options.Control.GenesisSHA256 = strings.Repeat("d", 64)
			case "wrong-plan":
				options.Control.OperatorPlanSHA256 = strings.Repeat("d", 64)
			case "wrong-session":
				options.Control.SessionID = strings.Repeat("d", 64)
			case "wrong-chain":
				options.Control.ChainID = "ynx_999-1"
			case "duplicate-wire":
				raw = append([]byte("{\"version\":\"YNX-OPERATOR-HEIGHT-HALT/v1\","), raw[1:]...)
				digest := sha256.Sum256(raw)
				pin = hex.EncodeToString(digest[:])
			}
			before := inspectionInventory(t, root, filepath.Dir(retained))
			if result, err := PublishHeightHaltRequest(raw, pin, options); err == nil || result.Published {
				t.Fatal("unsafe or unapproved input accepted", kind, result, err)
			}
			if !reflect.DeepEqual(before, inspectionInventory(t, root, filepath.Dir(retained))) {
				t.Fatal("rejected request changed original material")
			}
		})
	}
}

func TestHeightHaltPublicationRetainsInterruptedPartialAndFirstCause(t *testing.T) {
	firstCause := errors.New("isolated first durability failure")
	for _, kind := range []string{"partial-write", "file-sync", "staging-dir-sync", "published-dir-sync", "after-rename"} {
		t.Run(kind, func(t *testing.T) {
			raw, pin, options := heightHaltPublicationFixture(t)
			hooks := &heightHaltPublicationHooks{}
			published := false
			switch kind {
			case "partial-write":
				hooks.write = func(f *os.File, data []byte) (int, error) { n, _ := f.Write(data[:3]); return n, firstCause }
			case "file-sync":
				hooks.syncFile = func(*os.File) error { return firstCause }
			case "staging-dir-sync", "published-dir-sync":
				calls := 0
				hooks.syncDirectory = func(f *os.File) error {
					calls++
					if kind == "staging-dir-sync" || calls == 2 {
						return firstCause
					}
					return f.Sync()
				}
				published = kind == "published-dir-sync"
			case "after-rename":
				hooks.afterRename = func() error { return firstCause }
				published = true
			}
			if result, err := publishHeightHaltRequest(raw, pin, options, hooks); !errors.Is(err, firstCause) || result.Published {
				t.Fatal("first failed effect lost or falsely succeeded", result, err)
			}
			retained := options.Control.Path + ".partial"
			if published {
				retained = options.Control.Path
			}
			data, err := os.ReadFile(retained)
			if err != nil || len(data) == 0 || kind != "partial-write" && !bytes.Equal(data, raw) {
				t.Fatal("failed publication discarded uncertain original bytes", retained, err)
			}
			before := inspectionInventory(t, filepath.Dir(options.ApplicationStatePath))
			if result, err := PublishHeightHaltRequest(raw, pin, options); err == nil || result.Published {
				t.Fatal("uncertain write was blindly retried", result, err)
			}
			if !reflect.DeepEqual(before, inspectionInventory(t, filepath.Dir(options.ApplicationStatePath))) {
				t.Fatal("retry rejection changed retained first effect")
			}
		})
	}
}

func TestHeightHaltPublicationAtomicNoReplaceAndIdentityRaces(t *testing.T) {
	for _, kind := range []string{"target-created", "stage-mode", "stage-symlink", "parent-mode", "parent-replaced", "UNKNOWN-created"} {
		t.Run(kind, func(t *testing.T) {
			raw, pin, options := heightHaltPublicationFixture(t)
			parent := filepath.Dir(options.ApplicationStatePath)
			retainedParent := filepath.Join(t.TempDir(), "original-retained")
			other := filepath.Join(t.TempDir(), "unrelated-original")
			originalOther := []byte("preserve unrelated material")
			if err := os.WriteFile(other, originalOther, 0o600); err != nil {
				t.Fatal(err)
			}
			firstTarget := []byte("concurrent first target must never be overwritten")
			hooks := &heightHaltPublicationHooks{beforeRename: func() error {
				switch kind {
				case "target-created":
					return os.WriteFile(options.Control.Path, firstTarget, 0o600)
				case "stage-mode":
					return os.Chmod(options.Control.Path+".partial", 0o644)
				case "stage-symlink":
					if err := os.Rename(options.Control.Path+".partial", options.Control.Path+".partial-retained"); err != nil {
						return err
					}
					return os.Symlink(other, options.Control.Path+".partial")
				case "parent-mode":
					return os.Chmod(parent, 0o755)
				case "parent-replaced":
					if err := os.Rename(parent, retainedParent); err != nil {
						return err
					}
					return os.Mkdir(parent, 0o700)
				case "UNKNOWN-created":
					return os.WriteFile(options.Control.Path+".UNKNOWN", []byte("retain-first-unknown"), 0o600)
				}
				return nil
			}}
			result, err := publishHeightHaltRequest(raw, pin, options, hooks)
			if err == nil || result.Published {
				t.Fatal("concurrent identity or permission change accepted", kind, result, err)
			}
			if kind == "target-created" {
				if !errors.Is(err, unix.EEXIST) {
					t.Fatal("target race did not reach atomic RENAME_NOREPLACE", err)
				}
				data, err := os.ReadFile(options.Control.Path)
				if err != nil || !bytes.Equal(data, firstTarget) {
					t.Fatal("atomic rename replaced concurrent target", err)
				}
			} else if _, err := os.Lstat(options.Control.Path); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("unsafe directory or file identity was published", err)
			}
			data, err := os.ReadFile(other)
			if err != nil || !bytes.Equal(data, originalOther) {
				t.Fatal("race followed a symlink or touched unrelated state", err)
			}
			retained := options.Control.Path + ".partial"
			if kind == "stage-symlink" {
				retained += "-retained"
			} else if kind == "parent-replaced" {
				retained = filepath.Join(retainedParent, filepath.Base(retained))
			}
			data, err = os.ReadFile(retained)
			if err != nil || !bytes.Equal(data, raw) {
				t.Fatal("race discarded original staging material", err)
			}
		})
	}
}

func TestHeightHaltPublicationRejectsForeignUIDMetadata(t *testing.T) {
	_, _, options := heightHaltPublicationFixture(t)
	for _, path := range []string{options.ApplicationStatePath, filepath.Dir(options.ApplicationStatePath)} {
		var stat unix.Stat_t
		if err := unix.Lstat(path, &stat); err != nil {
			t.Fatal(err)
		}
		directory := path != options.ApplicationStatePath
		if !privateHeightHaltPublicationStat(stat, directory) {
			t.Fatal("owned fixture rejected")
		}
		// A pure metadata counterexample needs no chown, privilege or foreign
		// account creation in CI. Filesystem identity races are exercised above.
		stat.Uid ^= 1
		if privateHeightHaltPublicationStat(stat, directory) {
			t.Fatal("foreign uid was accepted")
		}
	}
}

func TestHeightHaltPublicationAllowsNormalLiveApplicationAtomicCommit(t *testing.T) {
	raw, pin, options := heightHaltPublicationFixture(t)
	var oldState unix.Stat_t
	if err := unix.Lstat(options.ApplicationStatePath, &oldState); err != nil {
		t.Fatal(err)
	}
	committedBytes := []byte("a new legitimate same-uid private application checkpoint\n")
	hooks := &heightHaltPublicationHooks{beforeRename: func() error {
		next := filepath.Join(filepath.Dir(options.ApplicationStatePath), "normal-app-commit.next")
		if err := os.WriteFile(next, committedBytes, 0o600); err != nil {
			return err
		}
		// Reproduce normal App.Commit's file replacement while the parent and
		// publication identities remain stable. The publisher does not freeze
		// or decode a running application's state, bytes, mtime or inode.
		return os.Rename(next, options.ApplicationStatePath)
	}}
	result, err := publishHeightHaltRequest(raw, pin, options, hooks)
	if err != nil || !result.Published || result.NodeStopped || result.Activation {
		t.Fatal("normal live App.Commit replacement falsely blocked publication", result, err)
	}
	var current unix.Stat_t
	if err := unix.Lstat(options.ApplicationStatePath, &current); err != nil || current.Ino == oldState.Ino {
		t.Fatal("fixture did not actually replace the application inode", err)
	}
	app, err := os.ReadFile(options.ApplicationStatePath)
	if err != nil || !bytes.Equal(app, committedBytes) {
		t.Fatal("publisher rewrote the legitimate new checkpoint", err)
	}
	published, err := os.ReadFile(options.Control.Path)
	if err != nil || !bytes.Equal(published, raw) {
		t.Fatal("live commit changed the approved control request", err)
	}
}
