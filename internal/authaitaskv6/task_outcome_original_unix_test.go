//go:build darwin || linux

package aitaskactionsource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
)

// PUBLIC request-lifetime seam only. Actual product CAS/encrypted persistence,
// opaque reader ownership and production private-exchange code run unchanged.
// This is not genuine LINK/Source/Root admission or a signed HTTP carrier.
type p08OutcomeRequestLoan struct{ request *http.Request }

func (l p08OutcomeRequestLoan) currentOriginalRequest(r *http.Request) error {
	if r != l.request {
		return errors.New("PUBLIC foreign request")
	}
	return r.Context().Err()
}
func p08OutcomeServer(t *testing.T, store *aiproduct.Store) *aiproduct.Server {
	t.Helper()
	s, err := aiproduct.NewServer(aiproduct.Config{GatewayURL: "http://127.0.0.1:1", GatewayKey: "PUBLIC-no-provider-network", ExactWalletCallback: "ynxai://wallet-auth/callback"}, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func p08OutcomeExchange(t *testing.T, s *originalTaskBusinessSession, operation string, command any) originalBusinessReply {
	t.Helper()
	raw, _ := json.Marshal(command)
	reply, err := s.exchange(s.ctx, operation, raw)
	if err != nil || reply.StatusCode != 200 {
		t.Fatalf("exchange %s failed: %v %s", operation, err, reply.Body)
	}
	var v originalBusinessReply
	if json.Unmarshal(reply.Body, &v) != nil {
		t.Fatal("private reply invalid")
	}
	return v
}
func TestP08OriginalDurableOutcomeThroughNormalPrivateConsumer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "product.json")
	key := bytes.Repeat([]byte{17}, 32)
	store, err := aiproduct.NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation("PUBLIC-account", "PUBLIC original")
	if err != nil {
		t.Fatal(err)
	}
	server := p08OutcomeServer(t, store)
	reader, err := NewOriginalTaskStateReaderFromServer(server)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	principal := aiproduct.TaskStorePrincipal{Account: conversation.Account, DeviceID: "PUBLIC-device", SessionID: strings.Repeat("b", 64)}
	body, _ := json.Marshal(map[string]string{"conversationId": conversation.ID})
	sum := sha256.Sum256(body)
	request := httptest.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(body))
	loan := p08OutcomeRequestLoan{request}
	ctx := newOriginalTaskRuntimeContext(request, loan)
	session := &originalTaskBusinessSession{request: request, ctx: ctx, loan: loan, reader: reader, binding: originalTaskRequestBinding{principal: principal, task: TaskBindingDATA{Action: "task.create", Holder: principal.DeviceID, ConversationID: conversation.ID}, call: OriginalLocalActionDATA{OperationID: "PUBLIC-original-op", RequestDigest: strings.Repeat("a", 64), BodyDigest: hex.EncodeToString(sum[:]), Action: "task.create", Method: "POST", Path: "/api/tasks", Body: body}}}
	defer session.close()
	captured := p08OutcomeExchange(t, session, "capture-conversation", map[string]any{"requestRef": nil, "handle": nil, "original": nil})
	ref := "auth-task-action-v6:" + strings.Repeat("c", 64)
	written := p08OutcomeExchange(t, session, "execute-local", map[string]any{"requestRef": ref, "handle": captured.Handle, "original": nil})
	if written.BodyOriginal == nil || written.ReceiptOriginal == nil {
		t.Fatal("execution lost actual durable originals")
	}
	bodyOriginal, err := base64.RawURLEncoding.DecodeString(*written.BodyOriginal)
	if err != nil {
		t.Fatal(err)
	}
	receiptOriginal, err := base64.RawURLEncoding.DecodeString(*written.ReceiptOriginal)
	if err != nil {
		t.Fatal(err)
	}
	var view aiproduct.TaskActionOutcomeView
	if json.Unmarshal(receiptOriginal, &view) != nil || view.State != "COMMITTED" || view.Scope != "PRODUCT_LOCAL_COMMIT_ONLY" || view.OriginalOperationID != "PUBLIC-original-op" || view.RequestRef != ref || view.BodyDigest != aiproduct.BindTaskActionBytes(bodyOriginal) {
		t.Fatal("private consumer did not retain actual original commit binding")
	}
	if path := os.Getenv("P08_DURABLE_OUTCOME_SAMPLE_FILE"); path != "" {
		// PUBLIC real product bytes. Request digest/source lifetime are explicit
		// fixture operands; this is not a signed E5/Root/Native golden vector.
		sample, _ := json.MarshalIndent(map[string]any{"kind": "P08_PUBLIC_ACTUAL_DURABLE_OUTCOME_BYTES/v1", "privateReply": written, "requestMetadataIsPublicFixture": true, "SourceAdmission": false, "RootAdmission": false, "NativeAdmission": false}, "", "  ")
		if err := os.WriteFile(path, sample, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err = session.close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := aiproduct.NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	next, err := NewOriginalTaskStateReaderFromServer(p08OutcomeServer(t, reopened))
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	queryRequest := httptest.NewRequest(http.MethodGet, "/api/tasks/original", nil)
	queryLoan := p08OutcomeRequestLoan{queryRequest}
	query := &originalTaskBusinessSession{request: queryRequest, ctx: newOriginalTaskRuntimeContext(queryRequest, queryLoan), loan: queryLoan, reader: next, binding: originalTaskRequestBinding{principal: principal}}
	defer query.close()
	read := p08OutcomeExchange(t, query, "outcome", map[string]any{"requestRef": nil, "handle": nil, "original": map[string]string{"operationId": "PUBLIC-original-op", "requestDigest": strings.Repeat("a", 64), "action": "task.create", "sessionBinding": principal.SessionID}})
	if read.BodyOriginal == nil || read.ReceiptOriginal == nil || *read.BodyOriginal != *written.BodyOriginal || *read.ReceiptOriginal != *written.ReceiptOriginal {
		t.Fatal("cold private query lost/reconstructed original receipt or body")
	}
	metadata := read.Metadata.(map[string]any)
	if metadata["requestRef"] != ref || metadata["completionScope"] != "PRODUCT_LOCAL_COMMIT_ONLY" || metadata["state"] != "COMMITTED" {
		t.Fatal("original metadata was reduced or replaced")
	}
}
func TestP08OriginalOutcomeUnknownHasNoSyntheticReceipt(t *testing.T) {
	store, err := aiproduct.NewStore(filepath.Join(t.TempDir(), "product.json"), bytes.Repeat([]byte{19}, 32))
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation("PUBLIC-account", "PUBLIC pending")
	if err != nil {
		t.Fatal(err)
	}
	reader, err := NewOriginalTaskStateReaderFromServer(p08OutcomeServer(t, store))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	principal := aiproduct.TaskStorePrincipal{Account: conversation.Account, DeviceID: "PUBLIC-device", SessionID: strings.Repeat("b", 64)}
	// Actual product parser refusal AFTER its durable reservation; no private
	// database writes, fake outcome setter, or recreated operation is involved.
	snapshot, err := reader.CaptureDATA(context.Background(), principal, TaskBindingDATA{Action: "task.create", Holder: principal.DeviceID, ConversationID: conversation.ID})
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	body, _ := json.Marshal(map[string]any{"conversationId": conversation.ID, "unexpected": true})
	sum := sha256.Sum256(body)
	failed, err := reader.ExecuteOriginalLocalActionDATA(context.Background(), snapshot, OriginalLocalActionDATA{OperationID: "PUBLIC-pending-original", RequestRef: "auth-task-action-v6:" + strings.Repeat("c", 64), RequestDigest: strings.Repeat("a", 64), BodyDigest: hex.EncodeToString(sum[:]), Action: "task.create", Method: "POST", Path: "/api/tasks", Body: body})
	if failed != nil {
		defer failed.Close()
	}
	if err == nil {
		t.Fatal("invalid business body became a commit")
	}
	held, err := reader.CaptureOriginalOutcomeDATA(context.Background(), principal, "PUBLIC-pending-original", strings.Repeat("a", 64), "task.create")
	if held != nil {
		defer held.Close()
	}
	if err != nil {
		t.Fatal(err)
	}
	data, err := held.ReadOriginalOutcomeDATA()
	if err != nil || data.State != "UNKNOWN" || data.CompletionScope != "" || len(data.BusinessReceiptOriginal) != 0 || len(data.BodyOriginal) != 0 {
		t.Fatal("pending original query fabricated an opaque receipt or body", err)
	}
	absent, err := reader.CaptureOriginalOutcomeDATA(context.Background(), principal, "missing", strings.Repeat("a", 64), "task.create")
	if absent != nil {
		defer absent.Close()
	}
	if err == nil {
		t.Fatal("missing operation acquired outcome")
	}
}
