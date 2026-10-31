package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"testing"
	"time"

	authgrant "ynx.local/authgrantpolicy"
)

// PUBLIC stand-in only: actual original policy + actual product resource,
// not signature verification, a production Source, or global revocation.
type p08OriginalHeldFixture struct {
	snapshot authgrant.Snapshot
	closed   int
	closeErr error
}

func (f *p08OriginalHeldFixture) Snapshot(context.Context) (authgrant.Snapshot, error) {
	return f.snapshot, nil
}
func (f *p08OriginalHeldFixture) AssertCurrent(ctx context.Context, v authgrant.SourceVersion) error {
	if v != f.snapshot.Version {
		return errors.New("isolated Source changed")
	}
	return ctx.Err()
}
func (f *p08OriginalHeldFixture) FenceScope() authgrant.FenceScope {
	return authgrant.EgressOnlyReadFence
}
func (f *p08OriginalHeldFixture) Retire() error { return nil }
func (f *p08OriginalHeldFixture) Join() error   { return nil }
func (f *p08OriginalHeldFixture) Close() error  { f.closed++; return f.closeErr }

type p08OriginalVerifierFixture struct {
	held  *p08OriginalHeldFixture
	first error
}

func (f p08OriginalVerifierFixture) OpenTaskGrantSource(context.Context, authgrant.TaskEffectBinding, authgrant.Proof, authgrant.Proof) (authgrant.HeldTaskGrantSource, error) {
	return f.held, f.first
}

func p08OriginalAuthFixture(t *testing.T) (*Store, authgrant.TaskEffectBinding, *p08OriginalHeldFixture) {
	t.Helper()
	store, expected, _ := taskReadFixture(t)
	r := func(kind, id string) authgrant.Ref {
		return authgrant.Ref{Realm: "isolated-realm", Tenant: "tenant-a", Kind: kind, ID: id, Revision: "1"}
	}
	toBind := func(b taskBytesBinding) authgrant.Bind {
		return authgrant.Bind{Bytes: strconv.Itoa(b.Bytes), SHA3_512: b.SHA3_512, SHA512: b.SHA512}
	}
	tool := authgrant.Tool{ID: "ai.conversation.read", Version: "1", Operation: "ai.conversation.read", Purpose: "read-task-selected-conversation", Risk: "read", Schema: toBind(bindTaskBytes(taskModelTools()[0].Parameters))}
	resource, holder, issuer := r("conversation", store.state.Tasks[expected.TaskID].ConversationID), r("agent", expected.Holder), r("human", "isolated-owner")
	_, messages, err := store.Conversation(expected.Account, resource.ID)
	if err != nil {
		t.Fatal(err)
	}
	content, _ := json.Marshal(map[string]any{"messages": messages})
	b := authgrant.TaskEffectBinding{Realm: "isolated-realm", Tenant: "tenant-a", Account: expected.Account, Audience: "isolated-ai", GrantID: "isolated-grant", GrantRevision: "1", Task: r("task", expected.TaskID), Generation: "1", StepID: expected.StepID, Holder: holder, HolderEpoch: "1", SessionID: "isolated-session", SessionEpoch: "1", ChannelBinding: "isolated-channel", Tool: tool, Input: toBind(expected.Input), Fields: []string{"messages"}, Target: authgrant.Sink{Service: "isolated-ai", Tenant: "tenant-a", Origin: "https://ai.invalid", Path: "/task/conversation", Region: "isolated", Operation: tool.Operation}, Resources: []authgrant.Ref{resource}, Sources: []authgrant.Source{{Resource: resource, Fields: []string{"messages"}, Label: "RESTRICTED", Binding: toBind(bindTaskBytes(content))}}}
	now := time.Now().UnixMilli()
	start, end := strconv.FormatInt(now-1000, 10), strconv.FormatInt(now+60000, 10)
	snapshot := authgrant.Snapshot{Version: authgrant.SourceVersion{Authority: "PUBLIC-only", Revision: "1", PolicyRevision: "1"}, ObservedAt: start, Expires: end, Issuer: authgrant.PrincipalState{Ref: issuer, Epoch: "1", Status: "active", Role: "human"}, Holder: authgrant.PrincipalState{Ref: holder, Epoch: "1", Status: "active", Role: "agent"}, Grant: authgrant.GrantState{ID: b.GrantID, Revision: b.GrantRevision, Status: "active", Issuer: issuer, IssuerEpoch: "1", Holder: holder, HolderEpoch: "1", ValidFrom: start, Expires: end, Cap: "10", SingleMax: "2", NonDelegable: true, Binding: b}, Task: authgrant.TaskState{Ref: b.Task, Generation: b.Generation, Holder: holder, HolderEpoch: "1", Status: "READY"}, Session: authgrant.SessionState{ID: b.SessionID, Epoch: "1", ChannelBinding: b.ChannelBinding, Holder: holder, HolderEpoch: "1", Status: "active"}, Catalog: authgrant.CatalogState{Tool: b.Tool, Audience: b.Audience, Status: "active", Egress: false}, AuthorizedResources: b.Resources, Sources: b.Sources, Budget: authgrant.BudgetState{Status: "ready", Cap: "10", SingleMax: "2", Spent: "0", Reserved: "0", Requested: "1", Slot: b.Slot()}, Effect: authgrant.EffectState{State: "NEW", Slot: b.Slot()}}
	return store, b, &p08OriginalHeldFixture{snapshot: snapshot}
}

func TestP08OriginalAuthActualResourceIntegration(t *testing.T) {
	store, binding, held := p08OriginalAuthFixture(t)
	proof := authgrant.Proof{Payload: []byte("PUBLIC-payload"), Wire: []byte("PUBLIC-not-signature"), Purpose: "PUBLIC-fixture"}
	result, err := store.commitOriginalAuthTaskRead(context.Background(), p08OriginalVerifierFixture{held: held}, binding, proof, proof)
	if err != nil || result.AuthScope != authgrant.EgressOnlyReadFence || result.Receipt.Scope != "same-resource-transaction" || !bytes.Contains(result.Receipt.Result, []byte("actual selected source body")) || held.closed != 1 {
		t.Fatalf("actual policy/resource integration failed: %+v %v close=%d", result, err, held.closed)
	}
}

func TestP08OriginalAuthPartialAndClosePreserved(t *testing.T) {
	for _, partial := range []bool{true, false} {
		t.Run(strconv.FormatBool(partial), func(t *testing.T) {
			store, binding, held := p08OriginalAuthFixture(t)
			cause := errors.New("isolated original Source first cause")
			verifier := p08OriginalVerifierFixture{held: held}
			if partial {
				verifier.first = cause
			} else {
				held.closeErr = cause
			}
			proof := authgrant.Proof{Payload: []byte("PUBLIC-payload"), Wire: []byte("PUBLIC-not-signature"), Purpose: "PUBLIC-fixture"}
			result, err := store.commitOriginalAuthTaskRead(context.Background(), verifier, binding, proof, proof)
			if !errors.Is(err, cause) || held.closed != 1 {
				t.Fatalf("partial/close first cause lost: %v close=%d", err, held.closed)
			}
			if partial && len(result.Receipt.Result) != 0 {
				t.Fatal("partial open executed read")
			}
			if !partial && result.Receipt.State != "COMMITTED" {
				t.Fatal("close error discarded exact committed receipt")
			}
		})
	}
}
