package social

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestUnconfirmedCommittedStateRejectsAllWriteEntriesAndReplay(t *testing.T) {
	s, _ := testService(t)
	a, b := newFixture(t, 140), newFixture(t, 141)
	actor := Session{Account: a.account}
	input := ContactRequestInput{IdempotencyKey: "unconfirmed-replay", TargetAccount: b.account, Source: "handle", Message: "Keep original request"}
	request, _, err := s.RequestContact(actor, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.TransitionRequest(Session{Account: b.account}, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	invite, _, err := s.CreateInvite(actor, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RevokeInvite(actor, invite.ID); err != nil {
		t.Fatal(err)
	}
	settings := ProfileSettingsInput{IdempotencyKey: "unconfirmed-settings", AllowRequestsFrom: "everyone"}
	if _, _, err := s.SetSettings(actor, settings); err != nil {
		t.Fatal(err)
	}
	before := cloneState(s.state)
	s.state.PublicIdentities[a.account] = "sp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	err = s.saveOrRollbackWithLocked(before, func(path string, state *persistentState, key []byte) error {
		return saveStateWithOps(path, state, key, stateWriteOps{rename: os.Rename, syncDirectory: func(*os.File) error { return errors.New("injected directory sync failure") }})
	})
	if !stateWriteCommitted(err) {
		t.Fatal("did not produce committed uncertainty")
	}
	latched := s.stateWriteError
	snapshot, _ := json.Marshal(s.state)
	if _, replay, err := s.RequestContact(actor, input); err == nil || replay {
		t.Fatal("contact receipt falsely acknowledged after uncertain commit")
	}
	if _, err := s.TransitionRequest(Session{Account: b.account}, request.ID, "accept"); err == nil {
		t.Fatal("terminal retry bypassed uncertainty")
	}
	if _, err := s.RevokeInvite(actor, invite.ID); err == nil {
		t.Fatal("revoked invitation retry bypassed uncertainty")
	}
	if _, replay, err := s.SetSettings(actor, settings); err == nil || replay {
		t.Fatal("settings receipt falsely acknowledged")
	}
	methods := []string{"AcknowledgeConversationMessage", "AcknowledgeGroupMessage", "AppealSocialReport", "BeginAI", "Block", "CreateDirectConversation", "CreateGroupConversation", "CreateInvite", "CreateMoment", "CreateMomentComment", "CreatePublicPost", "CreateSocialReport", "CreateWalletChallenge", "DeleteAccount", "DeleteContact", "DeleteMoment", "FollowTarget", "Login", "MarkContractNotificationRead", "MarkNotificationRead", "ModifyGroupMembers", "Mute", "RequestContact", "RevokeInvite", "RevokeSession", "RotateConversationDevice", "SendConversationMessage", "SendGroupMessage", "SetMomentReaction", "SetSettings", "StoreMedia", "StreamAI", "TransitionAI", "TransitionRequest", "UpdateContractProfile", "ResolveMatrixAudience", "AuthorizeMatrixAudience"}
	for _, name := range methods {
		t.Run(name, func(t *testing.T) {
			method := reflect.ValueOf(s).MethodByName(name)
			if !method.IsValid() {
				t.Fatalf("missing guarded entry %s", name)
			}
			args := make([]reflect.Value, method.Type().NumIn())
			for i := range args {
				args[i] = reflect.Zero(method.Type().In(i))
			}
			results := method.Call(args)
			last := results[len(results)-1]
			if last.IsNil() || !errors.Is(last.Interface().(error), latched) {
				t.Fatalf("write %s did not return latched storage uncertainty", name)
			}
		})
	}
	if len(s.Requests(actor)) != 1 || len(s.Contacts(actor)) != 1 {
		t.Fatal("read-only access lost committed records")
	}
	after, _ := json.Marshal(s.state)
	if !bytes.Equal(snapshot, after) {
		t.Fatal("rejected replay mutated committed state")
	}
	if _, err := CheckSocialState(s.cfg.StatePath, s.cfg.TokenKey, SchemaVersion, "recover"); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if original, replay, err := restarted.RequestContact(actor, input); err != nil || !replay || original.ID != request.ID || original.Message != input.Message {
		t.Fatal("compatible recovery lost exact original receipt")
	}
}
