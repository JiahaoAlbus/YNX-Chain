package node

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	sm "github.com/cometbft/cometbft/state"
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
