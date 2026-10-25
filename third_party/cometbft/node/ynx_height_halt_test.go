package node

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	cfg "github.com/cometbft/cometbft/config"
	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/types"
	"github.com/stretchr/testify/require"
)

func heightHaltTestControl(t *testing.T) (*heightHaltControl, []byte) {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, os.Chmod(dir, 0700))
	config := HeightHaltControl{Path: filepath.Join(dir, "request.json"), ChainID: "halt-test",
		GenesisSHA256: strings.Repeat("1", 64), OperatorPlanSHA256: strings.Repeat("2", 64), SessionID: strings.Repeat("3", 64)}
	h, err := newHeightHaltControl(config)
	require.NoError(t, err)
	h.barrier, err = sm.NewHeightHalt(sm.State{ChainID: config.ChainID, InitialHeight: 1, LastBlockHeight: 2})
	require.NoError(t, err)
	raw, err := json.Marshal(HeightHaltRequest{"YNX-OPERATOR-HEIGHT-HALT/v1", "4", config.ChainID, config.GenesisSHA256, config.OperatorPlanSHA256, config.SessionID})
	require.NoError(t, err)
	return h, raw
}

func TestYNXHeightHaltControlStrictExternalPinsAndSchema(t *testing.T) {
	h, raw := heightHaltTestControl(t)
	height, err := ValidateHeightHaltRequest(raw, h.config)
	require.NoError(t, err)
	require.EqualValues(t, 4, height)
	for name, edit := range map[string]func(string) string{
		"numeric height": func(s string) string { return strings.Replace(s, `"targetHeight":"4"`, `"targetHeight":4`, 1) },
		"leading zero":   func(s string) string { return strings.Replace(s, `"targetHeight":"4"`, `"targetHeight":"04"`, 1) },
		"unknown":        func(s string) string { return strings.TrimSuffix(s, "}") + `,"approved":true}` },
		"duplicate":      func(s string) string { return strings.TrimSuffix(s, "}") + `,"targetHeight":"4"}` },
		"missing":        func(s string) string { return strings.Replace(s, `"chainId":"halt-test",`, "", 1) },
		"trailing":       func(s string) string { return s + `{}` },
		"network":        func(s string) string { return strings.ReplaceAll(s, "halt-test", "other-chain") },
		"genesis":        func(s string) string { return strings.ReplaceAll(s, strings.Repeat("1", 64), strings.Repeat("4", 64)) },
		"plan":           func(s string) string { return strings.ReplaceAll(s, strings.Repeat("2", 64), strings.Repeat("4", 64)) },
		"session":        func(s string) string { return strings.ReplaceAll(s, strings.Repeat("3", 64), strings.Repeat("4", 64)) },
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ValidateHeightHaltRequest([]byte(edit(string(raw))), h.config)
			require.Error(t, err)
		})
	}
}

func TestYNXHeightHaltControlReadsOriginalFileOnceAndPreservesRestartBarrier(t *testing.T) {
	h, raw := heightHaltTestControl(t)
	armed, err := h.poll()
	require.NoError(t, err)
	require.False(t, armed)
	require.NoError(t, os.WriteFile(h.config.Path, raw, 0600))
	before, err := os.Stat(h.config.Path)
	require.NoError(t, err)
	armed, err = h.poll()
	require.NoError(t, err)
	require.True(t, armed)
	require.True(t, h.barrier.Enter(4))
	require.True(t, h.barrier.Committed(sm.State{ChainID: "halt-test", InitialHeight: 1, LastBlockHeight: 4}))
	n := &Node{heightHalt: h}
	result, err := n.HeightHaltResult()
	require.NoError(t, err)
	require.True(t, result.CheckpointSaved)
	require.False(t, result.Stopped, "checkpoint notification is not completed node shutdown")
	require.Len(t, result.ControlRequestSHA256, 64)
	_, err = newHeightHaltControl(h.config)
	require.Error(t, err, "retained request must refuse a fresh process")
	after, err := os.Stat(h.config.Path)
	require.NoError(t, err)
	require.True(t, os.SameFile(before, after))
	require.Equal(t, before.ModTime(), after.ModTime())
	retained, err := os.ReadFile(h.config.Path)
	require.NoError(t, err)
	require.Equal(t, raw, retained)
}

func TestYNXHeightHaltControlRefusesPartialSymlinkPermissionsAndLateTarget(t *testing.T) {
	for _, name := range []string{"partial", "symlink", "permissions", "parent", "late"} {
		t.Run(name, func(t *testing.T) {
			h, raw := heightHaltTestControl(t)
			switch name {
			case "partial":
				raw = []byte(`{"version":`)
			case "symlink":
				target := filepath.Join(filepath.Dir(h.config.Path), "original.json")
				require.NoError(t, os.WriteFile(target, raw, 0600))
				require.NoError(t, os.Symlink(target, h.config.Path))
			case "late":
				require.True(t, h.barrier.Enter(5))
			}
			if name != "symlink" {
				require.NoError(t, os.WriteFile(h.config.Path, raw, 0600))
			}
			if name == "permissions" {
				require.NoError(t, os.Chmod(h.config.Path, 0644))
			}
			if name == "parent" {
				require.NoError(t, os.Chmod(filepath.Dir(h.config.Path), 0755))
			}
			armed, err := h.poll()
			require.Error(t, err)
			require.False(t, armed)
			h.barrier.Fail(err) // same fail-closed action as the normal watcher
			require.False(t, h.barrier.Enter(6))
			_, _, err = h.barrier.Result()
			require.Error(t, err)
			_, err = os.Lstat(h.config.Path)
			require.NoError(t, err, "refused/UNKNOWN request must not be cleaned up")
		})
	}
}

func TestYNXHeightHaltWatcherFailureNotifiesAndRetainsUnknown(t *testing.T) {
	h, _ := heightHaltTestControl(t)
	raw := []byte(`{"version":`)
	require.NoError(t, os.WriteFile(h.config.Path, raw, 0600))
	h.start()
	defer h.close()
	select {
	case <-h.barrier.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("HEIGHT_HALT_CONTROL_ERROR_IGNORED: watcher kept running after a malformed protected request")
	}
	n := &Node{heightHalt: h}
	result, err := n.HeightHaltResult()
	require.Error(t, err)
	require.False(t, result.CheckpointSaved)
	require.False(t, h.barrier.Enter(3))
	retained, err := os.ReadFile(h.config.Path)
	require.NoError(t, err)
	require.Equal(t, raw, retained)
}

func TestYNXHeightHaltStartupRefusesRetainedPublicationMarkers(t *testing.T) {
	for _, suffix := range []string{"", ".partial", ".UNKNOWN", ".tmp"} {
		for _, kind := range []string{"regular", "symlink", "dangling-symlink", "directory"} {
			t.Run(suffix+"/"+kind, func(t *testing.T) {
				h, _ := heightHaltTestControl(t)
				marker := h.config.Path + suffix
				original := []byte("retain original uncertain publication and its first cause\n")
				unrelated := filepath.Join(t.TempDir(), "unrelated-original")
				require.NoError(t, os.WriteFile(unrelated, original, 0600))
				switch kind {
				case "regular":
					require.NoError(t, os.WriteFile(marker, original, 0600))
				case "symlink":
					require.NoError(t, os.Symlink(unrelated, marker))
				case "dangling-symlink":
					require.NoError(t, os.Symlink(unrelated+"-absent", marker))
				case "directory":
					require.NoError(t, os.Mkdir(marker, 0700))
				}
				before, err := os.Lstat(marker)
				require.NoError(t, err)
				// Invoke the actual normal startup entry. A marker must fail
				// before any genesis, DB, custody, watcher or node service starts.
				n := &Node{config: cfg.DefaultConfig(), genesisDoc: &types.GenesisDoc{ChainID: h.config.ChainID}}
				err = n.ConfigureHeightHalt(h.config)
				require.ErrorContains(t, err, "retained publication marker already exists")
				require.Nil(t, n.heightHalt)
				require.False(t, n.IsRunning())
				control, err := newHeightHaltControl(h.config)
				require.ErrorContains(t, err, "retained publication marker already exists")
				require.Nil(t, control)
				after, err := os.Lstat(marker)
				require.NoError(t, err)
				require.True(t, os.SameFile(before, after))
				require.Equal(t, before.Mode(), after.Mode())
				require.Equal(t, before.Size(), after.Size())
				require.Equal(t, before.ModTime(), after.ModTime())
				if kind == "regular" {
					retained, err := os.ReadFile(marker)
					require.NoError(t, err)
					require.Equal(t, original, retained)
				} else if strings.Contains(kind, "symlink") {
					target, err := os.Readlink(marker)
					require.NoError(t, err)
					expected := unrelated
					if kind == "dangling-symlink" {
						expected += "-absent"
					}
					require.Equal(t, expected, target)
				}
				retained, err := os.ReadFile(unrelated)
				require.NoError(t, err)
				require.Equal(t, original, retained)
			})
		}
	}
}

func TestYNXHeightHaltRunningPollAllowsAtomicPublisherStaging(t *testing.T) {
	h, raw := heightHaltTestControl(t)
	partial := h.config.Path + ".partial"
	f, err := os.OpenFile(partial, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	require.NoError(t, err)
	defer f.Close()
	n, err := f.Write(raw[:9])
	require.NoError(t, err)
	require.Equal(t, 9, n)
	before, err := f.Stat()
	require.NoError(t, err)
	armed, err := h.poll()
	require.NoError(t, err, "a running consumer must not reject a publisher's private transient partial")
	require.False(t, armed)
	select {
	case <-h.barrier.Done():
		t.Fatal("transient publisher staging failed the running height barrier")
	default:
	}
	after, err := os.Lstat(partial)
	require.NoError(t, err)
	require.True(t, os.SameFile(before, after))
	require.EqualValues(t, 9, after.Size())
	_, err = f.Write(raw[9:])
	require.NoError(t, err)
	require.NoError(t, f.Sync())
	require.NoError(t, f.Close())
	// The isolated destination is absent. Exercise the same complete atomic
	// rename visibility that the Linux publisher's NOREPLACE path supplies.
	require.NoError(t, os.Rename(partial, h.config.Path))
	armed, err = h.poll()
	require.NoError(t, err)
	require.True(t, armed)
	require.True(t, h.barrier.Enter(4))
	retained, err := os.ReadFile(h.config.Path)
	require.NoError(t, err)
	require.Equal(t, raw, retained)
}
