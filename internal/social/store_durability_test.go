package social

import (
	"bytes"
	"errors"
	"os"
	"testing"
)

func TestStateReplacementFailureBoundariesAndForwardRecovery(t *testing.T) {
	for _, stage := range []string{"rename", "directory-sync"} {
		t.Run(stage, func(t *testing.T) {
			s, _ := testService(t)
			actor := newFixture(t, 136)
			before := cloneState(s.state)
			original, err := os.ReadFile(s.cfg.StatePath)
			if err != nil {
				t.Fatal(err)
			}
			id := "sp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
			s.state.PublicIdentities[actor.account] = id
			ops := stateWriteOps{rename: os.Rename, syncDirectory: func(directory *os.File) error { return directory.Sync() }}
			if stage == "rename" {
				ops.rename = func(string, string) error { return errors.New("injected rename failure") }
			} else {
				ops.syncDirectory = func(*os.File) error { return errors.New("injected directory sync failure") }
			}
			err = s.saveOrRollbackWithLocked(before, func(path string, state *persistentState, key []byte) error {
				return saveStateWithOps(path, state, key, ops)
			})
			if err == nil {
				t.Fatal("failure was acknowledged as successful")
			}
			current, readErr := os.ReadFile(s.cfg.StatePath)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if stage == "rename" {
				if stateWriteCommitted(err) || !bytes.Equal(original, current) || len(s.state.PublicIdentities) != len(before.PublicIdentities) {
					t.Fatal("pre-commit failure changed disk or memory")
				}
				return
			}
			if !stateWriteCommitted(err) || s.state.PublicIdentities[actor.account] != id || bytes.Equal(original, current) {
				t.Fatal("post-rename failure rolled back committed identity")
			}
			if _, err := s.publicIdentity(actor.account); err == nil {
				t.Fatal("uncertain storage published identity")
			}
			if _, err := CheckSocialState(s.cfg.StatePath, s.cfg.TokenKey, 5, "check"); err == nil {
				t.Fatal("legacy reader admitted incompatible state")
			}
			if _, err := CheckSocialState(s.cfg.StatePath, s.cfg.TokenKey, SchemaVersion, "recover"); err != nil {
				t.Fatal(err)
			}
			restarted, err := New(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			if got, err := restarted.publicIdentity(actor.account); err != nil || got != id {
				t.Fatal("forward recovery changed committed identity")
			}
		})
	}
}

func TestSchemaFiveUpgradePreservesRelationshipsAndOpaqueBindings(t *testing.T) {
	s, _ := testService(t)
	a, b := newFixture(t, 137), newFixture(t, 138)
	request, _, err := s.RequestContact(Session{Account: a.account}, ContactRequestInput{IdempotencyKey: "migration-request", TargetAccount: b.account, Source: "handle", Message: "Preserve this request"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.TransitionRequest(Session{Account: b.account}, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	id, err := s.publicIdentity(b.account)
	if err != nil {
		t.Fatal(err)
	}
	legacy := cloneState(s.state)
	legacy.SchemaVersion = 5
	legacy.AudiencePolicyRevision = 0
	if err := saveState(s.cfg.StatePath, &legacy, s.cfg.TokenKey); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CheckSocialState(s.cfg.StatePath, s.cfg.TokenKey, 5, "check"); err == nil {
		t.Fatal("opaque schema5 falsely declared old-reader compatible")
	}
	unchanged, _ := os.ReadFile(s.cfg.StatePath)
	if !bytes.Equal(before, unchanged) {
		t.Fatal("read-only check modified state")
	}
	if result, err := CheckSocialState(s.cfg.StatePath, s.cfg.TokenKey, SchemaVersion, "upgrade"); err != nil || result.StoredSchema != SchemaVersion {
		t.Fatal("upgrade failed")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.state.PublicIdentities[b.account] != id || !restarted.contactLocked(a.account, b.account) || restarted.state.Requests[request.ID].Message != "Preserve this request" {
		t.Fatal("upgrade dropped binding, relationship or message")
	}
	stat, err := os.Stat(s.cfg.StatePath)
	if err != nil || stat.Mode().Perm() != 0o600 {
		t.Fatal("replacement lost private file mode")
	}
}
