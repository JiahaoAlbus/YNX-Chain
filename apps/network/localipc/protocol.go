// Package localipc implements the native Network helper channel. Kernel peer
// credentials authenticate the connecting native process's UID, not browser
// identity, code signing identity, product authority or funds approval.
package localipc

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"unicode/utf8"
)

const Version = "YNX-NETWORK-LOCAL-IPC/v1"
const MaxMessageBytes = 16 << 10
const SocketName = "network-helper.sock"
const LockName = "network-helper.lock"

var ErrUnsupported = errors.New("native peer credentials unsupported on this platform")
var ErrPeerDenied = errors.New("native IPC peer UID denied")
var ErrEndpointChanged = errors.New("native IPC endpoint changed; unknown paths preserved")
var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

type Peer struct {
	uid, gid               uint32
	pid                    int32
	pidAvailable, verified bool
	source                 string
}

func (p Peer) UID() uint32              { return p.uid }
func (p Peer) GID() uint32              { return p.gid }
func (p Peer) PID() (int32, bool)       { return p.pid, p.pidAvailable }
func (p Peer) Verified() bool           { return p.verified }
func (p Peer) CredentialSource() string { return p.source }

// SameUID is a pure policy predicate, not a constructor of verified peers.
func SameUID(owner, caller uint32) error {
	if owner != caller {
		return ErrPeerDenied
	}
	return nil
}

type PermissionIntent struct {
	Capability   string `json:"capability"`
	SubjectID    string `json:"subjectId"`
	IntentSHA256 string `json:"intentSHA256"`
}
type Request struct {
	Version    string            `json:"version"`
	ID         string            `json:"id"`
	Operation  string            `json:"operation"`
	Permission *PermissionIntent `json:"permission,omitempty"`
	Payload    json.RawMessage   `json:"payload,omitempty"`
}
type Status struct {
	Activity             *Activity `json:"activity,omitempty"`
	Service              string    `json:"service"`
	NodeControl          string    `json:"nodeControl"`
	ResourceContribution string    `json:"resourceContribution"`
}
type PermissionResult struct {
	State     string `json:"state"`
	RequestID string `json:"requestId,omitempty"`
}
type Result struct {
	Status     *Status           `json:"status,omitempty"`
	Permission *PermissionResult `json:"permission,omitempty"`
	Payload    json.RawMessage   `json:"payload,omitempty"`
}
type PeerMetadata struct {
	UID                     uint32 `json:"uid"`
	GID                     uint32 `json:"gid"`
	PID                     *int32 `json:"pid,omitempty"`
	CredentialSource        string `json:"credentialSource"`
	NativeIPCVerified       bool   `json:"nativeIPCVerified"`
	BrowserIdentityVerified bool   `json:"browserIdentityVerified"`
}
type Response struct {
	Version string       `json:"version"`
	ID      string       `json:"id"`
	Code    string       `json:"code"`
	Peer    PeerMetadata `json:"peer"`
	Result  *Result      `json:"result,omitempty"`
}
type Handler func(context.Context, Peer, Request) (Result, error)

func metadata(peer Peer) PeerMetadata {
	p := PeerMetadata{UID: peer.uid, GID: peer.gid, CredentialSource: peer.source, NativeIPCVerified: peer.verified}
	if peer.pidAvailable {
		pid := peer.pid
		p.PID = &pid
	}
	return p
}
func validateRequest(r Request) error {
	if r.Version != Version || !idPattern.MatchString(r.ID) {
		return errors.New("invalid IPC version or request ID")
	}
	switch r.Operation {
	case "status":
		if r.Permission != nil || len(r.Payload) != 0 {
			return errors.New("status does not accept permission intent")
		}
	case "request_permission":
		p := r.Permission
		if len(r.Payload) != 0 || p == nil || (p.Capability != "node.manage" && p.Capability != "resource.contribute") || !idPattern.MatchString(p.SubjectID) {
			return errors.New("unsupported structured permission request")
		}
		digest, err := hex.DecodeString(p.IntentSHA256)
		if err != nil || len(digest) != 32 || hex.EncodeToString(digest) != p.IntentSHA256 {
			return errors.New("permission intent requires canonical SHA256")
		}
	case "participation_prepare", "participation_reconcile", "participation_revoke", "participation_get", "participation_submit", "node_prepare", "node_install", "node_start", "node_status", "node_stop", "resource_status", "resource_meter", "resource_stop":
		if r.Permission != nil || len(r.Payload) == 0 || len(r.Payload) > 12<<10 || !json.Valid(r.Payload) || len(bytes.TrimSpace(r.Payload)) == 0 || bytes.TrimSpace(r.Payload)[0] != '{' {
			return errors.New("bounded typed native payload required")
		}
	default:
		return errors.New("unsupported IPC operation")
	}
	return nil
}
func validateResult(operation string, r Result) error {
	if operation == "status" {
		if r.Status == nil || r.Permission != nil || len(r.Payload) != 0 || len(r.Status.Service) > 80 {
			return errors.New("invalid status result")
		}
		for _, v := range []string{r.Status.NodeControl, r.Status.ResourceContribution} {
			if v != "available" && v != "unavailable" && v != "disabled" {
				return errors.New("invalid capability status")
			}
		}
		return nil
	}
	if payloadOperation(operation) {
		if r.Status != nil || r.Permission != nil || len(r.Payload) == 0 || len(r.Payload) > 12<<10 || !json.Valid(r.Payload) || bytes.Equal(bytes.TrimSpace(r.Payload), []byte("null")) {
			return errors.New("bounded typed native result required")
		}
		return nil
	}
	if len(r.Payload) != 0 || r.Permission == nil || r.Status != nil || (r.Permission.State != "pending" && r.Permission.State != "denied" && r.Permission.State != "unsupported") || (r.Permission.RequestID != "" && !idPattern.MatchString(r.Permission.RequestID)) {
		return errors.New("permission result is a request receipt, never a production grant")
	}
	return nil
}
func strictJSON(raw []byte, out any) error {
	if len(raw) == 0 || len(raw) > MaxMessageBytes || !utf8.Valid(raw) {
		return errors.New("bounded IPC JSON required")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	var visit func(int) error
	visit = func(depth int) error {
		if depth > 10 {
			return errors.New("IPC JSON nesting bound")
		}
		token, err := dec.Token()
		if err != nil {
			return err
		}
		d, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		if d == '[' {
			count := 0
			for dec.More() {
				count++
				if count > 32 {
					return errors.New("IPC array bound")
				}
				if err := visit(depth + 1); err != nil {
					return err
				}
			}
			_, err = dec.Token()
			return err
		}
		if d != '{' {
			return errors.New("invalid IPC JSON delimiter")
		}
		seen := map[string]bool{}
		for dec.More() {
			token, err = dec.Token()
			if err != nil {
				return err
			}
			key, ok := token.(string)
			if !ok || seen[key] || len(seen) >= 64 {
				return errors.New("duplicate IPC fields")
			}
			seen[key] = true
			if err = visit(depth + 1); err != nil {
				return err
			}
		}
		_, err = dec.Token()
		return err
	}
	if err := visit(0); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("trailing IPC JSON")
	}
	dec = json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	return nil
}
func decodeRequest(raw []byte) (Request, error) {
	var r Request
	if err := strictJSON(raw, &r); err != nil {
		return r, err
	}
	if err := validateRequest(r); err != nil {
		return r, err
	}
	canonical, err := json.Marshal(r)
	if err != nil {
		return r, err
	}
	if !equivalentJSON(raw, canonical) {
		return r, errors.New("noncanonical or case-aliased IPC fields")
	}
	return r, nil
}
func equivalentJSON(a, b []byte) bool {
	var x, y any
	dx, dy := json.NewDecoder(bytes.NewReader(a)), json.NewDecoder(bytes.NewReader(b))
	dx.UseNumber()
	dy.UseNumber()
	if dx.Decode(&x) != nil || dy.Decode(&y) != nil {
		return false
	}
	ax, _ := json.Marshal(x)
	by, _ := json.Marshal(y)
	return bytes.Equal(ax, by)
}
func protocolError(code string, id string, p Peer) Response {
	return Response{Version: Version, ID: id, Code: code, Peer: metadata(p)}
}
func responseError(code string) error { return fmt.Errorf("native IPC request rejected: %s", code) }

func payloadOperation(operation string) bool {
	switch operation {
	case "participation_prepare", "participation_reconcile", "participation_revoke", "participation_get", "participation_submit", "node_prepare", "node_install", "node_start", "node_status", "node_stop", "resource_status", "resource_meter", "resource_stop":
		return true
	}
	return false
}
