//go:build unix

package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func pqLabPreOutputDirectory(t *testing.T) string {
	t.Helper()
	dir := pqLabWorkloadTemp(t)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := proofHostLivePrivateDirectory(dir); err != nil {
		t.Fatal("normal source directory prerequisite", err)
	}
	return dir
}

func pqLabPreOutputClosedOriginal(t *testing.T) (*PQLabLiveMaterialsControl, string, []byte, error) {
	t.Helper()
	dir := pqLabPreOutputDirectory(t)
	path := filepath.Join(dir, "original.json")
	if err := pqLabWrite(path, []byte("PUBLIC original held source")); err != nil {
		t.Fatal(err)
	}
	held, err := readProofHostOriginal(path, "", 4096)
	if err != nil {
		t.Fatal(err)
	}
	if err = held.file.Close(); err != nil {
		t.Fatal(err)
	}
	cause := held.unchanged()
	if cause == nil {
		t.Fatal("closed original descriptor unexpectedly current")
	}
	in := &pqLabLiveMaterialsInputs{directory: dir, pin: strings.Repeat("a", 64), policy: PQLabLiveMaterialsPolicy{MaxOperations: 1}, originals: []*proofHostOriginal{held}}
	c := &PQLabLiveMaterialsControl{in: in, next: 1, seen: make(map[string]bool), done: make(chan struct{})}
	request := []byte("not a decoded request: PUBLIC sentinel must never be echoed")
	if err = pqLabWrite(pqLabLiveRequestPath(dir, 1), request); err != nil {
		t.Fatal(err)
	}
	return c, dir, request, cause
}

func pqLabAssertPreOutput(t *testing.T, c *PQLabLiveMaterialsControl, seq uint32, phase string, cause error) []byte {
	t.Helper()
	path := filepath.Join(c.in.directory, fmt.Sprintf("failure-%06d.json", seq))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("pre-output original failure was not retained", err)
	}
	var got map[string]json.RawMessage
	if err = json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"version": "YNX-PQ-LAB-LIVE-MATERIALS-PRE-OUTPUT-FAILURE/v1", "policySHA256": c.in.pin, "sequence": seq, "phase": phase, "outcome": "unknown", "firstCauseSHA256": pqLabSHA([]byte(cause.Error()))}
	if len(got) != len(want) {
		t.Fatal("failure disclosed extra fields", string(raw))
	}
	for k, v := range want {
		expected, _ := json.Marshal(v)
		if !bytes.Equal(got[k], expected) {
			t.Fatalf("%s: got %s want %s", k, got[k], expected)
		}
	}
	if _, err = os.Lstat(pqLabLiveOutputPath(c.in.directory, seq)); !os.IsNotExist(err) {
		t.Fatal("pre-output failure fabricated operation start", err)
	}
	if st, e := os.Stat(path); e != nil || st.Mode().Perm() != 0600 {
		t.Fatal("failure mode", e)
	}
	return raw
}

func TestPQLabLiveMaterialsPreOutputFailureOriginalCurrent(t *testing.T) {
	c, dir, request, cause := pqLabPreOutputClosedOriginal(t)
	present, err := c.step(context.Background())
	if !present || err == nil || !strings.Contains(err.Error(), cause.Error()) {
		t.Fatal("original descriptor failure lost", present, err)
	}
	raw := pqLabAssertPreOutput(t, c, 1, "current-source", cause)
	if bytes.Contains(raw, request) || bytes.Contains(raw, []byte(dir)) {
		t.Fatal("failure exposed request/source path")
	}
	got, e := os.ReadFile(pqLabLiveRequestPath(dir, 1))
	if e != nil || !bytes.Equal(got, request) {
		t.Fatal("original request changed", e)
	}
	if !c.retired || c.next != 1 || len(c.seen) != 0 || c.Err() == nil {
		t.Fatal("failure changed original lifecycle")
	}
	if _, e = c.step(context.Background()); e == nil {
		t.Fatal("retired operation replayed")
	}
	after, e := os.ReadFile(filepath.Join(dir, "failure-000001.json"))
	if e != nil || !bytes.Equal(raw, after) {
		t.Fatal("replay changed original failure", e)
	}
}

func TestPQLabLiveMaterialsPreOutputFailureExclusiveAndNoPhantom(t *testing.T) {
	t.Run("closed_phases_redact_unread_originals", func(t *testing.T) {
		phases := []string{PQLabLiveFailureRequestStat, PQLabLiveFailureCurrentSource, PQLabLiveFailureRequestRead, PQLabLiveFailureRequestDecode, PQLabLiveFailureRequestSequence, PQLabLiveFailureTransactionReplay, PQLabLiveFailureRequestCancelled, PQLabLiveFailureTransactionValidation, PQLabLiveFailureOutputCancelled, PQLabLiveFailureOutputCreate}
		want := []string{"request-stat", "current-source", "request-read", "request-decode", "request-sequence", "transaction-replay", "request-cancelled", "transaction-validation", "output-cancelled", "output-create"}
		for i, phase := range phases {
			if phase != want[i] {
				t.Fatal("public phase contract changed", phase)
			}
			dir := pqLabPreOutputDirectory(t)
			c := &PQLabLiveMaterialsControl{in: &pqLabLiveMaterialsInputs{directory: dir, pin: strings.Repeat("b", 64)}}
			cause := errors.New("PUBLIC synthetic private-path sentinel " + dir)
			if err := c.failBeforeOutput(1, phase, cause); !errors.Is(err, cause) {
				t.Fatal("original failure lost", err)
			}
			raw := pqLabAssertPreOutput(t, c, 1, phase, cause)
			if bytes.Contains(raw, []byte(cause.Error())) || bytes.Contains(raw, []byte(dir)) {
				t.Fatal("error/path exposed")
			}
		}
	})
	t.Run("directory_alias_never_writes_target", func(t *testing.T) {
		c, dir, _, cause := pqLabPreOutputClosedOriginal(t)
		retained := dir + "-retained"
		if e := os.Rename(dir, retained); e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { _ = os.RemoveAll(retained) })
		target := pqLabPreOutputDirectory(t)
		if e := os.Symlink(target, dir); e != nil {
			t.Fatal(e)
		}
		err := c.failBeforeOutput(1, PQLabLiveFailureCurrentSource, cause)
		if !errors.Is(err, cause) || err.Error() == cause.Error() {
			t.Fatal("alias or first failure lost", err)
		}
		files, e := os.ReadDir(target)
		if e != nil || len(files) != 0 {
			t.Fatal("alias received evidence", e)
		}
	})
	t.Run("existing_failure_preserved", func(t *testing.T) {
		c, dir, _, cause := pqLabPreOutputClosedOriginal(t)
		path := filepath.Join(dir, "failure-000001.json")
		original := []byte("PUBLIC original partial failure")
		if e := pqLabWrite(path, original); e != nil {
			t.Fatal(e)
		}
		_, err := c.step(context.Background())
		if err == nil || !strings.Contains(err.Error(), cause.Error()) || !errors.Is(err, os.ErrExist) {
			t.Fatal("first cause or exclusive failure lost", err)
		}
		raw, e := os.ReadFile(path)
		if e != nil || !bytes.Equal(raw, original) {
			t.Fatal("original partial overwritten", e)
		}
	})
	t.Run("cancel_before_request_not_fabricated", func(t *testing.T) {
		c, dir, _, _ := pqLabPreOutputClosedOriginal(t)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, e := c.step(ctx); !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
		if _, e := os.Stat(filepath.Join(dir, "failure-000001.json")); !os.IsNotExist(e) {
			t.Fatal("unobserved request fabricated", e)
		}
	})
	t.Run("absent_request_keeps_idle", func(t *testing.T) {
		dir := pqLabPreOutputDirectory(t)
		c := &PQLabLiveMaterialsControl{in: &pqLabLiveMaterialsInputs{directory: dir, policy: PQLabLiveMaterialsPolicy{MaxOperations: 1}}, next: 1}
		if present, e := c.step(context.Background()); present || e != nil || c.retired {
			t.Fatal("idle became attempted", present, e)
		}
		entries, e := os.ReadDir(dir)
		if e != nil || len(entries) != 0 {
			t.Fatal("idle wrote evidence", e)
		}
	})
}
