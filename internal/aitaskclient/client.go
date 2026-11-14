// Package aitaskclient connects the independent task client to the original AI
// daemon. It creates no session, Grant, execution receipt or provider fallback.
package aitaskclient

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const MaxResponseBytes = 20 << 20

var ErrUnresolved = errors.New("original request is retained; inspect task/run and reconcile the original step, never resend it")
var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type Request struct {
	Action, TaskID, StepID, RunID, OperationID, Proof string
	ExpectedAuthorityOperationID                      string
	AfterTaskID                                       string
	AfterCursor                                       uint64
	Body                                              json.RawMessage
}
type Route struct {
	Method, Path string
	Private      bool
}
type Client struct {
	endpoint string
	http     *http.Client
	journal  *Journal
}
type Response struct {
	Status    int
	Body      json.RawMessage
	Operation *Operation
}
type HTTPError struct{ Status int }

func (e *HTTPError) Error() string {
	return fmt.Sprintf("AI daemon rejected request (HTTP %d); inspect the returned response", e.Status)
}

// Loopback-only direct transport. Remote authenticated product delivery remains
// owned by the original secure transport; this is not an ordinary-TLS fallback.
func New(endpoint string, journal *Journal) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u == nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || u.RawPath != "" {
		return nil, errors.New("task daemon must be an explicit http loopback origin")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() || u.Port() == "" {
		return nil, errors.New("task daemon must use a loopback IP and explicit port")
	}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, DisableCompression: true, MaxResponseHeaderBytes: 32 << 10}
	return &Client{endpoint: u.String(), journal: journal, http: &http.Client{Transport: transport, Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func Resolve(r Request) (Route, error) {
	task := func() bool { return identifier.MatchString(r.TaskID) }
	step := func() bool { return task() && identifier.MatchString(r.StepID) }
	switch r.Action {
	case "health":
		return Route{"GET", "/healthz", false}, nil
	case "session":
		return Route{"GET", "/api/auth/session", true}, nil
	case "conversation-create":
		return Route{"POST", "/api/conversations", true}, nil
	case "task-create":
		return Route{"POST", "/api/tasks", true}, nil
	case "task-list":
		if r.AfterTaskID == "" || identifier.MatchString(r.AfterTaskID) {
			return Route{"GET", "/api/tasks?afterId=" + r.AfterTaskID, true}, nil
		}
	case "task-show":
		if task() {
			return Route{"GET", "/api/tasks/" + r.TaskID + "?afterCursor=" + fmt.Sprint(r.AfterCursor), true}, nil
		}
	case "webdav-deliver":
		if task() {
			return Route{"POST", "/api/tasks/" + r.TaskID + "/webdav", true}, nil
		}
	case "webdav-query":
		if task() && identifier.MatchString(r.StepID) {
			return Route{"POST", "/api/tasks/" + r.TaskID + "/webdav/" + r.StepID + "/query", true}, nil
		}
	case "webdav-result":
		if task() && identifier.MatchString(r.StepID) {
			return Route{"GET", "/api/tasks/" + r.TaskID + "/webdav/" + r.StepID, true}, nil
		}
	case "task-prepare", "task-cancel", "task-complete":
		if task() {
			suffix := strings.TrimPrefix(r.Action, "task-")
			return Route{"POST", "/api/tasks/" + r.TaskID + "/" + suffix, true}, nil
		}
	case "task-handoff":
		if task() {
			return Route{"POST", "/open/v1/tasks/" + r.TaskID + "/handoffs", true}, nil
		}
	case "step-propose":
		if task() {
			return Route{"POST", "/api/tasks/" + r.TaskID + "/tool-steps", true}, nil
		}
	case "step-approve", "step-dispatch", "step-reconcile":
		if step() {
			return Route{"POST", "/api/tasks/" + r.TaskID + "/tool-steps/" + r.StepID + "/" + strings.TrimPrefix(r.Action, "step-"), true}, nil
		}
	case "step-result":
		if step() {
			return Route{"GET", "/api/tasks/" + r.TaskID + "/tool-steps/" + r.StepID + "/result", true}, nil
		}
	case "run-start", "run-resume":
		if task() {
			return Route{"POST", "/api/tasks/" + r.TaskID + "/runs", true}, nil
		}
	case "run-show":
		if task() && identifier.MatchString(r.RunID) {
			return Route{"GET", "/api/tasks/" + r.TaskID + "/runs/" + r.RunID, true}, nil
		}
	}
	return Route{}, errors.New("unknown action or invalid original task/step/run identifier")
}
func (c *Client) Do(ctx context.Context, input Request) (out Response, err error) {
	if ctx == nil {
		return out, errors.New("context required")
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if input.ExpectedAuthorityOperationID != "" &&
		(input.Action != "step-result" || !identifier.MatchString(input.ExpectedAuthorityOperationID)) {
		return out, errors.New("expected authority operation requires a valid step-result request")
	}
	route, err := Resolve(input)
	if err != nil {
		return out, err
	}
	if route.Private && (len(input.Proof) == 0 || len(input.Proof) > 16384 || strings.ContainsAny(input.Proof, "\r\n\x00")) {
		return out, errors.New("fresh canonical Wallet proof required; a task Grant is separate")
	}
	body := bytes.Clone(input.Body)
	if route.Method == "POST" {
		if len(body) == 0 {
			body = []byte("{}")
		}
		if len(body) > 64<<10 || !json.Valid(body) {
			return out, errors.New("bounded JSON request body required")
		}
	}
	if route.Method == "GET" && len(body) > 0 {
		return out, errors.New("read actions cannot send a request body")
	}
	if input.Action == "run-start" || input.Action == "run-resume" {
		var value map[string]json.RawMessage
		if json.Unmarshal(body, &value) != nil || value == nil {
			return out, errors.New("model request must be a JSON object")
		}
		value["resume"] = json.RawMessage("false")
		if input.Action == "run-resume" {
			value["resume"] = json.RawMessage("true")
		}
		body, err = json.Marshal(value)
		if err != nil {
			return out, err
		}
	}
	var op *Operation
	if route.Method == "POST" {
		if c.journal == nil {
			return out, errors.New("private operation journal required for mutations")
		}
		op, err = c.journal.Begin(input.OperationID, c.endpoint, route, input.TaskID, input.StepID, input.RunID, body)
		if err != nil {
			return out, err
		}
		out.Operation = op
	}
	finish := func(state string, status int, raw []byte) error {
		if op == nil {
			return nil
		}
		return c.journal.Finish(op, state, status, raw)
	}
	req, err := http.NewRequestWithContext(ctx, route.Method, c.endpoint+route.Path, bytes.NewReader(body))
	if err != nil {
		return out, errors.Join(err, finish("NOT_SENT", 0, nil))
	}
	req.Header.Set("Accept", "application/json")
	if route.Method == "POST" {
		req.Header.Set("Content-Type", "application/json")
	}
	if route.Private {
		req.Header.Set(productsessionv2.ProofHeader, input.Proof)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return out, errors.Join(errors.New("AI daemon response unavailable; inspect original request before recovery"), finish("UNKNOWN", 0, nil))
	}
	defer response.Body.Close()
	out.Status = response.StatusCode
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, MaxResponseBytes+1))
	if readErr != nil || len(raw) > MaxResponseBytes || !json.Valid(raw) {
		return out, errors.Join(errors.New("AI daemon returned an incomplete or invalid response; original operation retained"), finish("UNKNOWN", response.StatusCode, nil))
	}
	if input.ExpectedAuthorityOperationID != "" && response.StatusCode >= 200 && response.StatusCode < 300 {
		var receipt struct {
			EffectRef            string          `json:"effectRef"`
			AuthorityOperationID string          `json:"authorityOperationId"`
			State                string          `json:"state"`
			Result               json.RawMessage `json:"result"`
		}
		if json.Unmarshal(raw, &receipt) != nil || receipt.State != "COMMITTED" ||
			receipt.EffectRef != input.StepID || receipt.AuthorityOperationID != input.ExpectedAuthorityOperationID ||
			len(receipt.Result) == 0 {
			return out, errors.New("AI daemon result did not match the expected original operation")
		}
	}
	out.Body = bytes.Clone(raw)
	if op != nil && response.StatusCode >= 200 && response.StatusCode < 300 {
		// Record bounded original lookup IDs so a client restart can inspect
		// the created object without retaining its private response content.
		var refs struct {
			ID    string `json:"id"`
			RunID string `json:"runId"`
			Step  struct {
				ID string `json:"id"`
			} `json:"step"`
		}
		if json.Unmarshal(raw, &refs) == nil {
			if input.Action == "task-create" && identifier.MatchString(refs.ID) {
				op.TaskID = refs.ID
			}
			if input.Action == "step-propose" && identifier.MatchString(refs.Step.ID) {
				op.StepID = refs.Step.ID
			}
			if (input.Action == "run-start" || input.Action == "run-resume") && identifier.MatchString(refs.RunID) {
				op.RunID = refs.RunID
			}
		}
	}
	state := "RESPONSE_RECEIVED"
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		state = "REJECTED_RESPONSE"
	}
	err = finish(state, response.StatusCode, raw)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		err = errors.Join(&HTTPError{response.StatusCode}, err)
	}
	return out, err
}
func digest(b []byte) string { v := sha256.Sum256(b); return hex.EncodeToString(v[:]) }
