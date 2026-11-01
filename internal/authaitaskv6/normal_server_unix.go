//go:build darwin || linux

package aitaskactionsource

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	sdk "github.com/JiahaoAlbus/YNX-Chain/packages/wallet-auth/go/taskactionv6"
)

const originalV6ProofHeader = "x-ynx-product-session-proof-v6"

var ErrV6NormalRegistration = errors.New("AI_V6_NORMAL_RUNTIME_REGISTRATION_NOT_SUPPLIED")

type normalTaskV6Release struct {
	service, socketPath string
	networkID           string
	peerUID             uint32
	peerPID             int
	projection          sdk.BuildInputs
}

// Actual commissioning installs one independently admitted fixed registration
// and matching build inputs here. No ENV, request JSON, path setter, provider,
// machine-local Node default, new Root or service identity is inferred.
var originalTaskV6ServerReleases = []normalTaskV6Release{}

type OriginalAITaskActionServerV6 struct {
	server                *aiproduct.Server
	reader                *OriginalTaskStateReader
	projector             *OriginalTaskV6DATAProjector
	forwarder             *securelink.OriginalTaskRuntimeForwarder
	pending               sync.Map
	retired               atomic.Bool
	first                 error
	retireOnce, closeOnce sync.Once
	retireErr, closeErr   error
}

// Normal P08 main: same actual NewServer, then install owner.Handler(). The
// original Server/Store are borrowed, not reconstructed or closed by Auth.
func OpenOriginalAITaskActionServerV6(server *aiproduct.Server) (owner *OriginalAITaskActionServerV6, err error) {
	owner = &OriginalAITaskActionServerV6{server: server}
	defer func() {
		if err != nil {
			owner.first = err
		}
	}()
	owner.reader, err = NewOriginalTaskStateReaderFromServer(server)
	if err != nil {
		return owner, err
	}
	if len(originalTaskV6ServerReleases) != 1 {
		return owner, ErrV6NormalRegistration
	}
	row := originalTaskV6ServerReleases[0]
	if row.service != "ynx-ai-task-runtime" || row.peerUID == 0 || row.peerPID <= 0 || row.socketPath == "" || !runtimeHex64.MatchString(row.networkID) {
		return owner, ErrV6NormalRegistration
	}
	owner.projector, err = OpenOriginalTaskV6DATAProjector(row.projection)
	if err != nil {
		return owner, err
	}
	owner.forwarder, err = securelink.NewOriginalTaskRuntimeForwarder(securelink.TaskRuntimeForwarderConfig{Service: row.service, SocketPath: row.socketPath, PeerUID: row.peerUID, PeerPID: row.peerPID, Timeout: 30 * time.Second, MaxConcurrentRequests: 16, OpenSession: owner.openSession})
	return owner, err
}

type originalForwardCapture struct {
	binding originalTaskRequestBinding
	body    []byte
	header  string
}

func (o *OriginalAITaskActionServerV6) openSession(ctx context.Context, r *http.Request, caller *securelink.OriginalTaskRuntimeCaller) (securelink.TaskRuntimeSession, error) {
	if ctx == nil || r == nil || caller == nil || o.retired.Load() {
		return nil, errTaskRuntimeOriginal
	}
	captured, ok := o.pending.Load(r)
	if !ok {
		return nil, errTaskRuntimeOriginal
	}
	original := captured.(*originalForwardCapture)
	if err := caller.Current(ctx); err != nil {
		return nil, err
	}
	loan := &originalLINKTaskLoan{original: caller}
	derived := newOriginalTaskRuntimeContextFrom(ctx, r, loan)
	session := &originalTaskBusinessSession{request: r, ctx: derived, reader: o.reader, loan: loan, binding: original.binding, resources: make(map[string]*originalBusinessResource)}
	if err := session.fence(); err != nil {
		return session, err
	}
	return session, nil
}
func (o *OriginalAITaskActionServerV6) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r == nil {
			return
		}
		if len(r.Header.Values(originalV6ProofHeader)) == 0 {
			if o != nil && o.server != nil {
				o.server.Handler().ServeHTTP(w, r)
			} else {
				http.Error(w, "AI_V6_NORMAL_RUNTIME_NOT_SUPPLIED", 503)
			}
			return
		}
		if o == nil || o.first != nil || o.retired.Load() || o.forwarder == nil || o.projector == nil {
			http.Error(w, "AI_V6_NORMAL_RUNTIME_NOT_SUPPLIED", 503)
			return
		}
		o.serveOriginal(w, r)
	})
}
func (o *OriginalAITaskActionServerV6) serveOriginal(w http.ResponseWriter, r *http.Request) {
	deny := func(code string) { http.Error(w, code, http.StatusServiceUnavailable) }
	if len(r.Header.Values(originalV6ProofHeader)) != 1 || len(r.Header.Values("Content-Type")) > 1 || len(r.Header.Values("Content-Length")) > 1 || r.URL == nil || r.Body == nil || r.Header.Get("Content-Encoding") != "" || len(r.TransferEncoding) != 0 {
		deny("AI_V6_ORIGINAL_HTTP_INVALID")
		return
	}
	for _, old := range []string{"x-ynx-product-session-proof-v4", "x-ynx-product-session-proof-v5", "x-ynx-wallet-control-proof"} {
		if len(r.Header.Values(old)) != 0 {
			deny("AI_V6_LEGACY_PROOF_DENIED")
			return
		}
	}
	var headerBytes int
	for k, values := range r.Header {
		for _, v := range values {
			headerBytes += len(k) + len(v) + 4
		}
	}
	if headerBytes > 262144 {
		deny("AI_V6_ORIGINAL_HEADERS_SIZE")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1048577))
	if err != nil || len(body) > 1048576 || r.ContentLength >= 0 && r.ContentLength != int64(len(body)) {
		deny("AI_V6_ORIGINAL_BODY_INVALID")
		return
	}
	header := r.Header.Get(originalV6ProofHeader)
	if len(header) > 196608 {
		deny("AI_V6_ORIGINAL_HEADER_SIZE")
		return
	}
	binding, err := o.projectOriginalBinding(r, header, body)
	if err != nil {
		deny("AI_V6_ORIGINAL_PROJECTION_DENIED")
		return
	}
	capture := &originalForwardCapture{binding: binding, body: append([]byte(nil), body...), header: header}
	if _, loaded := o.pending.LoadOrStore(r, capture); loaded {
		deny("AI_V6_ORIGINAL_REQUEST_ALREADY_FORWARDED")
		return
	}
	defer o.pending.Delete(r)
	payload, err := json.Marshal(map[string]string{"method": r.Method, "path": r.URL.RequestURI(), "proofHeader": header, "bodyOriginal": base64.RawURLEncoding.EncodeToString(body)})
	if err != nil || len(payload) > 1835008 {
		deny("AI_V6_ORIGINAL_ENVELOPE_SIZE")
		return
	}
	kind := "effect"
	switch binding.call.Action {
	case "task.list", "task.read", "task.step-result", "task.run-read", "task.reconcile":
		kind = "effect-query"
	}
	reply, err := o.forwarder.Forward(r.Context(), r, kind, payload)
	// An error may accompany exact partial bytes. They are custody/UNKNOWN only;
	// never publish a partial signed member as a successful business response.
	if err != nil {
		deny("AI_V6_ORIGINAL_OUTCOME_UNKNOWN")
		return
	}
	if reply.StatusCode != http.StatusOK {
		deny("AI_V6_ORIGINAL_SOURCE_UNAVAILABLE")
		return
	}
	fields, e := originalPrivateObject(reply.Body, "status", "headers", "bodyOriginal", "complete", "errorPresent", "errorCode")
	if e != nil {
		deny("AI_V6_ORIGINAL_RESPONSE_ENVELOPE_INVALID")
		return
	}
	for _, key := range []string{"status", "headers", "bodyOriginal", "complete", "errorPresent"} {
		if bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
			deny("AI_V6_ORIGINAL_RESPONSE_ENVELOPE_INVALID")
			return
		}
	}
	var final struct {
		Status       int        `json:"status"`
		Headers      [][]string `json:"headers"`
		BodyOriginal string     `json:"bodyOriginal"`
		Complete     bool       `json:"complete"`
		ErrorPresent bool       `json:"errorPresent"`
		ErrorCode    *string    `json:"errorCode"`
	}
	decoder := json.NewDecoder(bytes.NewReader(reply.Body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&final) != nil || decoder.Decode(new(any)) != io.EOF || !final.Complete || final.ErrorPresent || final.ErrorCode != nil || final.Status < 100 || final.Status > 599 {
		deny("AI_V6_ORIGINAL_OUTCOME_UNKNOWN")
		return
	}
	actual, e := base64.RawURLEncoding.DecodeString(final.BodyOriginal)
	if e != nil || len(actual) > 1048576 || base64.RawURLEncoding.EncodeToString(actual) != final.BodyOriginal {
		deny("AI_V6_ORIGINAL_RESPONSE_BODY_INVALID")
		return
	}
	seen := map[string]bool{}
	headers := make(http.Header)
	for _, p := range final.Headers {
		if len(p) != 2 {
			deny("AI_V6_ORIGINAL_RESPONSE_HEADERS_INVALID")
			return
		}
		key := http.CanonicalHeaderKey(p[0])
		if seen[key] || (key != "Content-Type" && key != "X-Ynx-Product-Session-Response-Proof-V6") || bytes.ContainsAny([]byte(p[1]), "\r\n\x00") {
			deny("AI_V6_ORIGINAL_RESPONSE_HEADERS_INVALID")
			return
		}
		seen[key] = true
		headers.Set(key, p[1])
	}
	if !seen["X-Ynx-Product-Session-Response-Proof-V6"] {
		deny("AI_V6_ORIGINAL_RESPONSE_PROOF_NOT_SUPPLIED")
		return
	}
	for key, values := range headers {
		w.Header()[key] = values
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(final.Status)
	_, _ = w.Write(actual)
}

// Sole SDK Project has already closed/validated unsigned35/body DATA. This is
// only extraction, not another codec, signed-message serializer or verifier.
func (o *OriginalAITaskActionServerV6) projectOriginalBinding(r *http.Request, header string, body []byte) (out originalTaskRequestBinding, err error) {
	raw, e := base64.RawURLEncoding.DecodeString(header)
	if e != nil {
		return out, e
	}
	var data map[string]json.RawMessage
	if json.Unmarshal(raw, &data) != nil {
		return out, errTaskRuntimeResource
	}
	str := func(k string) string { var v string; _ = json.Unmarshal(data[k], &v); return v }
	network := originalTaskV6ServerReleases[0].networkID
	projected, e := o.projector.ProjectOriginalRequestDATA(r.Context(), network, header, body)
	if e != nil {
		return out, e
	}
	if str("method") != r.Method || str("path") != r.URL.RequestURI() || str("contentType") != r.Header.Get("Content-Type") {
		return out, errTaskRuntimeResource
	}
	out.principal = aiproduct.TaskStorePrincipal{Account: str("account"), DeviceID: str("deviceId"), SessionID: str("sessionBinding")}
	out.task = TaskBindingDATA{Action: str("action"), TaskID: str("taskId"), StepID: str("stepId"), RunID: str("runId"), Holder: str("holder")}
	if out.task.Action == "task.create" {
		var creation struct {
			ConversationID string `json:"conversationId"`
		}
		if json.Unmarshal(data["creationBinding"], &creation) != nil {
			return out, errTaskRuntimeResource
		}
		out.task.ConversationID = creation.ConversationID
	}
	if out.task.TaskID != "" {
		out.task.Revision, e = strconv.ParseUint(str("taskRevision"), 10, 64)
		if e != nil {
			return out, e
		}
		out.task.Generation, e = strconv.ParseUint(str("generation"), 10, 64)
		if e != nil {
			return out, e
		}
	}
	out.call = OriginalLocalActionDATA{OperationID: str("operationId"), RequestDigest: projected.RequestDigest, BodyDigest: projected.BodyDigest, Action: out.task.Action, Method: r.Method, Path: r.URL.RequestURI(), Body: append([]byte(nil), body...)}
	return out, nil
}
func (o *OriginalAITaskActionServerV6) Retire() error {
	if o == nil {
		return nil
	}
	o.retireOnce.Do(func() {
		o.retired.Store(true)
		if o.forwarder != nil {
			o.retireErr = o.forwarder.Retire()
		}
		if o.reader != nil {
			o.reader.Retire()
		}
	})
	return o.retireErr
}
func (o *OriginalAITaskActionServerV6) Join(ctx context.Context) error {
	if ctx == nil {
		return errTaskRuntimeOriginal
	}
	if o == nil {
		return nil
	}
	if !o.retired.Load() {
		return errors.New("AI_V6_RUNTIME_RETIRE_REQUIRED")
	}
	if o.forwarder != nil {
		if e := o.forwarder.Join(ctx); e != nil {
			return e
		}
	}
	if o.reader != nil && o.reader.children.Load() != 0 {
		return ErrChildrenRetainedV6
	}
	return nil
}

var ErrChildrenRetainedV6 = errors.New("AI_TASK_V6_CHILDREN_RETAINED")

func (o *OriginalAITaskActionServerV6) Close() error {
	if o == nil {
		return nil
	}
	o.closeOnce.Do(func() {
		if e := o.Retire(); e != nil {
			o.closeErr = e
		}
		if o.forwarder != nil {
			if e := o.forwarder.Close(); e != nil && o.closeErr == nil {
				o.closeErr = e
			}
		}
		if o.reader != nil {
			if e := o.reader.Close(); e != nil && o.closeErr == nil {
				o.closeErr = e
			}
		}
		if o.projector != nil {
			if e := o.projector.Close(); e != nil && o.closeErr == nil {
				o.closeErr = e
			}
		}
	})
	return o.closeErr
}
func (o *OriginalAITaskActionServerV6) DrainPartial(ctx context.Context) error {
	if o == nil {
		return nil
	}
	if e := o.Join(ctx); e != nil {
		return e
	}
	if o.reader != nil {
		_ = o.reader.DrainPartial()
	}
	return o.closeErr
}
