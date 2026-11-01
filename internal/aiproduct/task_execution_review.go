package aiproduct

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/url"
	"reflect"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
)

// This is product-owned review DATA for the independently held Wallet/Auth
// review. It is never an agent identity, proposed Grant, approval or authority.
type TaskExecutionReviewDATA struct {
	Principal                    TaskStorePrincipal           `json:"principal"`
	Task                         *TaskRecord                  `json:"task,omitempty"`
	Operation                    *TaskStoreOperation          `json:"operation,omitempty"`
	Tool                         *TaskReviewToolDATA          `json:"tool,omitempty"`
	RequestedTools               []string                     `json:"requestedTools,omitempty"`
	Resources                    []TaskReviewResourceDATA     `json:"resources"`
	Input                        *taskBytesBinding            `json:"input,omitempty"`
	RequestedFields              []string                     `json:"requestedFields,omitempty"`
	ApprovedFields               []string                     `json:"approvedFields,omitempty"`
	LocalConfiguration           *AgentConfiguration          `json:"localConfiguration,omitempty"`
	Model                        TaskReviewModelDATA          `json:"model"`
	LoopLimits                   aigateway.ToolLoopLimitsDATA `json:"productLoopLimits"`
	OriginalRunID                string                       `json:"originalRunId,omitempty"`
	OriginalRequesterOperationID string                       `json:"originalRequesterOperationId,omitempty"`
	OriginalAuthorityOperationID string                       `json:"originalAuthorityOperationId,omitempty"`
	Historical                   bool                         `json:"historical"`
	AuthAgentIdentityState       string                       `json:"authAgentIdentityState"`
	AuthBudgetAndExpiryState     string                       `json:"authBudgetAndExpiryState"`
	DataOnly                     bool                         `json:"dataOnly"`
	AuthorityGranted             bool                         `json:"authorityGranted"`
}
type TaskReviewToolDATA struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Purpose string `json:"purpose"`
	Risk    string `json:"risk"`
}
type TaskReviewResourceDATA struct {
	Product    string `json:"product"`
	ResourceID string `json:"resourceId"`
	Selection  string `json:"selection"`
	Version    string `json:"version,omitempty"`
}
type TaskReviewModelDATA struct {
	State       string `json:"state"`
	ProviderURL string `json:"providerURL,omitempty"`
	Model       string `json:"model,omitempty"`
}

// ReadOriginalTaskReviewDATA is a narrow callee on the SAME original opaque
// snapshot. The recipient retains Current/Close custody; bytes do not carry it.
// No public HTTP route, setter, proof codec, signing key or new action exists.
func (snapshot *TaskStoreSnapshot) ReadOriginalTaskReviewDATA() ([]byte, error) {
	if err := snapshot.Current(); err != nil {
		return nil, err
	}
	store := snapshot.source.store
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := snapshot.Current(); err != nil {
		return nil, err
	}
	v := snapshot.view
	model := TaskReviewModelDATA{State: "NOT_RECORDED"}
	if parent := snapshot.source.server; parent != nil {
		if parent.store != store {
			return nil, ErrTaskStoreSnapshotStale
		}
		providerURL, modelID := parent.taskModel.FixedTaskModelDestinationDATA()
		if providerURL != "" || modelID != "" {
			if !validTaskReviewModelLabels(providerURL, modelID) {
				return nil, errToolConflict
			}
			model = TaskReviewModelDATA{State: "CONFIGURED_DESTINATION_DATA_ONLY", ProviderURL: providerURL, Model: modelID}
		}
	}
	if v.Task.ID == "" {
		conversation, exists := store.state.Conversations[v.ConversationID]
		if !exists || conversation.Account != v.Principal.Account {
			return nil, errToolNotFound
		}
		out := TaskExecutionReviewDATA{Principal: v.Principal, Resources: []TaskReviewResourceDATA{{Product: "ai", ResourceID: v.ConversationID, Selection: "existing-conversation"}}, Model: model, LoopLimits: aigateway.TaskToolLoopLimitsDATA(), AuthAgentIdentityState: "ORIGINAL_AUTH_AGENT_SOURCE_REQUIRED", AuthBudgetAndExpiryState: "ORIGINAL_AUTH_GRANT_SOURCE_REQUIRED", DataOnly: true}
		return snapshot.marshalTaskReviewDATA(out)
	}
	task, err := store.ownedTaskLocked(v.Principal.Account, v.Task.ID)
	if err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(task, v.Task) {
		return nil, ErrTaskStoreSnapshotStale
	}
	out := TaskExecutionReviewDATA{Principal: v.Principal, Task: &task, Resources: []TaskReviewResourceDATA{}, Model: model, LoopLimits: aigateway.TaskToolLoopLimitsDATA(), Historical: task.Holder != v.Principal.DeviceID, AuthAgentIdentityState: "ORIGINAL_AUTH_AGENT_SOURCE_REQUIRED", AuthBudgetAndExpiryState: "ORIGINAL_AUTH_GRANT_SOURCE_REQUIRED", DataOnly: true, AuthorityGranted: false}
	if task.AgentConfigurationID != "" {
		c, err := store.ownedAgentConfigurationLocked(task.Account, task.AgentConfigurationID)
		if err != nil {
			return nil, err
		}
		copy := cloneAgentConfiguration(c)
		out.LocalConfiguration = &copy
	}
	if v.Operation.ID != "" {
		out.Operation = &v.Operation
		if r, ok := store.state.Actions[v.Operation.ID]; ok {
			if err = store.readStepReviewLocked(v, r, &out); err != nil {
				return nil, err
			}
		} else if r, ok := store.state.WebDAVDeliveries[taskWebDAVKey(task.Account, task.ID, v.Operation.ID)]; ok {
			if r.Holder != v.Principal.DeviceID || r.TaskID != task.ID || r.Account != task.Account || r.Input.OperationID != v.Operation.ID {
				return nil, errToolConflict
			}
			if err = store.verifyWebDAVRecord(r); err != nil {
				return nil, err
			}
			tool, _ := lookupTool(taskWebDAVToolID)
			out.Tool = &TaskReviewToolDATA{ID: tool.id, Version: tool.version, Purpose: tool.purpose, Risk: tool.risk}
			out.Resources = []TaskReviewResourceDATA{{Product: "ai", ResourceID: r.Input.ResourceID, Selection: "stored-attachment", Version: r.Receipt.SHA256}, {Product: "webdav", ResourceID: r.Input.DestinationID, Selection: "fixed-destination-reference"}}
			out.Historical = out.Historical || r.Generation != task.Generation || r.Revision != task.Revision
		} else if r, ok := store.state.TaskRuns[v.Operation.ID]; ok {
			if r.Account != task.Account || r.TaskID != task.ID || r.Holder != v.Operation.Holder {
				return nil, errToolConflict
			}
			out.OriginalRunID = r.RunID
			selected := r.ToolIDs
			if len(selected) == 0 {
				selected = []string{"ai.conversation.read"}
			}
			for _, id := range selected {
				if _, known := lookupTool(id); !known {
					return nil, errToolInvalid
				}
				out.RequestedTools = append(out.RequestedTools, id)
			}
			sameSession := r.Holder == v.Principal.DeviceID && r.SessionID == v.Principal.SessionID
			if !sameSession {
				out.Historical = true
				out.Model.State = "ORIGINAL_SESSION_SOURCE_REQUIRED"
			}
			if r.PagesCipher != "" && sameSession {
				pages, e := store.taskRunPagesLocked(r)
				if e != nil {
					return nil, e
				}
				for _, page := range pages {
					out.Resources = append(out.Resources, TaskReviewResourceDATA{Product: "browser", ResourceID: page.Reference.SelectionID, Selection: "recorded-selected-page", Version: page.Reference.Version})
				}
			}
			out.Historical = out.Historical || r.Generation != task.Generation || r.TaskRevision != task.Revision
			// Admission contains private prompt/transcript/session material. Only its
			// exact fixed destination/model labels leave this product getter.
			if r.AdmissionCipher != "" && r.Holder == v.Principal.DeviceID && r.SessionID == v.Principal.SessionID {
				raw, e := store.decrypt(r.Account, storedMessage{Message: Message{ID: r.ID + ":model-admission", ConversationID: r.TaskID}, Nonce: r.AdmissionNonce, Cipher: r.AdmissionCipher})
				if e != nil {
					return nil, e
				}
				var admitted taskModelAdmissionSnapshot
				if len(raw) > 4<<20 || strictToolJSON(bytes.NewBufferString(raw), &admitted) != nil || admitted.Task.ID != r.TaskID || admitted.Task.Account != r.Account || admitted.Session.ID != r.SessionID || admitted.Session.DeviceID != r.Holder {
					return nil, errToolConflict
				}
				if !validTaskReviewModelLabels(admitted.ProviderURL, admitted.Model) {
					return nil, errToolConflict
				}
				out.Model = TaskReviewModelDATA{State: "ORIGINAL_RECORDED_DESTINATION", ProviderURL: admitted.ProviderURL, Model: admitted.Model}
			}
		} else {
			return nil, errToolNotFound
		}
	}
	return snapshot.marshalTaskReviewDATA(out)
}
func (snapshot *TaskStoreSnapshot) marshalTaskReviewDATA(out TaskExecutionReviewDATA) ([]byte, error) {
	if err := snapshot.Current(); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	if len(raw) > 32<<10 {
		return nil, errors.New("original task review DATA exceeds bounded size")
	}
	return raw, nil
}

func (s *Store) readStepReviewLocked(v TaskStoreView, r ActionRecord, out *TaskExecutionReviewDATA) error {
	b := r.ToolStep
	if b == nil || r.ID != v.Operation.ID || r.Account != v.Principal.Account || b.TaskID != v.Task.ID || b.Holder != v.Operation.Holder {
		return errToolConflict
	}
	raw, err := s.decrypt(r.Account, storedMessage{Message: Message{ID: r.ID, ConversationID: b.TaskID}, Nonce: b.InputNonce, Cipher: b.InputCipher})
	if err != nil {
		return err
	}
	expected := TaskStoreOperation{ID: r.ID, Holder: b.Holder, Status: r.Status, ToolID: b.ToolID, ToolVersion: b.ToolVersion, InputDigest: b.InputDigest, Revision: b.TaskRevision, Generation: b.Generation}
	if expected != v.Operation {
		return ErrTaskStoreSnapshotStale
	}
	input := []byte(raw)
	canonical, _, err := canonicalTaskToolInput(b.ToolID, input)
	digest, digestErr := originalToolStepInputDigest(*b, input)
	if err != nil || digestErr != nil || !bytes.Equal(canonical, input) || digest != b.InputDigest {
		return errToolConflict
	}
	tool, known := lookupTool(b.ToolID)
	if !known {
		return errToolInvalid
	}
	out.Tool = &TaskReviewToolDATA{ID: tool.id, Version: tool.version, Purpose: tool.purpose, Risk: tool.risk}
	binding := bindTaskBytes(input)
	out.Input = &binding
	out.ApprovedFields = append([]string(nil), b.ApprovedFields...)
	out.OriginalRequesterOperationID = b.OperationID
	out.OriginalAuthorityOperationID = b.AuthorityOperationID
	out.Historical = out.Historical || b.Generation != v.Task.Generation || b.TaskRevision != v.Task.Revision || b.Holder != v.Principal.DeviceID
	switch b.ToolID {
	case "ai.conversation.read":
		var selected conversationToolInput
		if strictToolJSON(bytes.NewReader(input), &selected) != nil || selected.ConversationID != v.Task.ConversationID {
			return errToolConflict
		}
		out.Resources = []TaskReviewResourceDATA{{Product: "ai", ResourceID: selected.ConversationID, Selection: "selected-conversation"}}
	case shopOrderToolID:
		selected, _, err := canonicalShopOrderInput(input)
		if err != nil {
			return err
		}
		out.Resources = []TaskReviewResourceDATA{{Product: "shop", ResourceID: selected.OrderID, Selection: "selected-order", Version: selected.Snapshot}}
		out.RequestedFields = append([]string(nil), selected.Fields...)
	default:
		return errToolInvalid
	}
	return nil
}

func validTaskReviewModelLabels(providerURL, model string) bool {
	u, err := url.Parse(providerURL)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" && !strings.Contains(providerURL, "#") && len(providerURL) <= 2048 && len(model) > 0 && len(model) <= 256
}
