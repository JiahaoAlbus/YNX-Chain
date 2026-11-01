package localipc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
)

var ErrResourceRemoteUnknown = errors.New("original resource reader remote drain UNKNOWN; same held owner retained")

// ResourceCurrentRPC owns one concrete Unix connection to the expected original
// Go process. It never redials, resolves by node PID, initializes/registers a
// resource or installs a Root. Auth/LINK's protected native capture is separate.
type ResourceCurrentRPC struct {
	mu                           sync.Mutex
	gate                         chan struct{}
	connection                   *net.UnixConn
	buffer                       *bufio.Reader
	directory, path              string
	directoryInfo, socketInfo    os.FileInfo
	expected, caller             ProcessIdentity
	resource                     contribution.ResourceIdentity
	session                      string
	last                         ResourceCurrentResult
	retired, networkLost, closed bool
	first                        error
}

// OpenResourceCurrent returns a nonnil partial after the first wire attempt,
// including a lost response. Callers must retain that exact object and its debt.
func OpenResourceCurrent(ctx context.Context, directory string, expected ProcessIdentity, selected contribution.ResourceIdentity) (*ResourceCurrentRPC, error) {
	if ctx == nil || !validProcessIdentity(expected) || selected.SourceID == "" || selected.InstanceID == "" || selected.ResourceKey == "" {
		return nil, ErrResourceHeld
	}
	if err := CheckProcessIdentity(ctx, expected); err != nil {
		return nil, err
	}
	uid := uint32(os.Geteuid())
	dir, err := privateDirectory(directory, uid)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(directory, SocketName)
	socket, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	owner, err := fileOwner(socket)
	if err != nil || owner != uid || socket.Mode()&os.ModeSocket == 0 || socket.Mode().Perm() != 0600 {
		return nil, ErrEndpointChanged
	}
	connection, err := (&net.Dialer{}).DialContext(ctx, "unix", path)
	if err != nil {
		return nil, err
	}
	unixConnection, ok := connection.(*net.UnixConn)
	if !ok {
		_ = connection.Close()
		return nil, ErrUnsupported
	}
	peer, err := kernelPeer(unixConnection)
	if err != nil || !peer.Verified() || !peer.pidAvailable || peer.pid != expected.PID || peer.uid != expected.UID || !samePath(path, socket) {
		_ = unixConnection.Close()
		return nil, ErrResourceIdentity
	}
	if err = CheckProcessIdentity(ctx, expected); err != nil {
		_ = unixConnection.Close()
		return nil, err
	}
	caller, err := ObserveProcessIdentity(ctx, int32(os.Getpid()))
	if err != nil {
		_ = unixConnection.Close()
		return nil, err
	}
	rpc := &ResourceCurrentRPC{gate: make(chan struct{}, 1), connection: unixConnection, buffer: bufio.NewReaderSize(unixConnection, 4096), directory: directory, path: path, directoryInfo: dir, socketInfo: socket, expected: expected, caller: caller, resource: selected}
	_, err = rpc.Current(ctx)
	return rpc, err
}
func (r *ResourceCurrentRPC) fail(err error, lost bool) {
	r.mu.Lock()
	if r.first == nil {
		r.first = err
	}
	if lost {
		r.networkLost = true
	}
	r.mu.Unlock()
	if lost {
		_ = r.connection.Close()
	}
}
func (r *ResourceCurrentRPC) originalPeer(ctx context.Context) error {
	if !samePath(r.path, r.socketInfo) {
		return ErrEndpointChanged
	}
	dir, err := privateDirectory(r.directory, r.expected.UID)
	if err != nil || !os.SameFile(dir, r.directoryInfo) {
		return ErrEndpointChanged
	}
	peer, err := kernelPeer(r.connection)
	if err != nil || !peer.Verified() || !peer.pidAvailable || peer.uid != r.expected.UID || peer.pid != r.expected.PID {
		return ErrResourceIdentity
	}
	return CheckProcessIdentity(ctx, r.expected)
}
func (r *ResourceCurrentRPC) roundTrip(ctx context.Context, operation string) (ResourceCurrentResult, error) {
	if r == nil || ctx == nil {
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	if err := ctx.Err(); err != nil {
		return ResourceCurrentResult{}, err
	}
	select {
	case r.gate <- struct{}{}:
	case <-ctx.Done():
		return ResourceCurrentResult{}, ctx.Err()
	}
	defer func() { <-r.gate }()
	r.mu.Lock()
	lost, closed := r.networkLost, r.closed
	r.mu.Unlock()
	if lost || closed {
		return ResourceCurrentResult{}, ErrResourceRemoteUnknown
	}
	if err := r.originalPeer(ctx); err != nil {
		r.fail(err, true)
		return ResourceCurrentResult{}, err
	}
	request := Request{Version: Version, ID: endpointID(), Operation: operation, Payload: json.RawMessage(`{}`)}
	raw, err := json.Marshal(request)
	if err != nil {
		return ResourceCurrentResult{}, err
	}
	deadline := time.Now().Add(OperationTimeout(operation))
	if value, ok := ctx.Deadline(); ok && value.Before(deadline) {
		deadline = value
	}
	_ = r.connection.SetDeadline(deadline)
	finished := make(chan struct{})
	stop := context.AfterFunc(ctx, func() { _ = r.connection.SetDeadline(time.Now()); close(finished) })
	defer func() {
		if !stop() {
			<-finished
		}
		_ = r.connection.SetDeadline(time.Time{})
	}()
	httpRequest, _ := http.NewRequest(http.MethodPost, "http://localipc/v1/call", bytes.NewReader(raw))
	httpRequest.Header.Set("Content-Type", "application/json")
	if err = httpRequest.Write(r.connection); err != nil {
		r.fail(err, true)
		return ResourceCurrentResult{}, err
	}
	httpResponse, err := http.ReadResponse(r.buffer, httpRequest)
	if err != nil {
		r.fail(err, true)
		return ResourceCurrentResult{}, err
	}
	body, err := io.ReadAll(io.LimitReader(httpResponse.Body, MaxMessageBytes+1))
	closeErr := httpResponse.Body.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil || len(body) > MaxMessageBytes {
		r.fail(ErrResourceRemoteUnknown, true)
		return ResourceCurrentResult{}, ErrResourceRemoteUnknown
	}
	var response Response
	if httpResponse.StatusCode != 200 || strictJSON(body, &response) != nil || response.Version != Version || response.ID != request.ID || !response.Peer.NativeIPCVerified || response.Peer.BrowserIdentityVerified || response.Peer.UID != r.caller.UID || response.Peer.PID == nil || *response.Peer.PID != r.caller.PID {
		r.fail(ErrResourceHeld, true)
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	canonical, _ := json.Marshal(response)
	if !equivalentJSON(body, canonical) {
		r.fail(ErrResourceHeld, true)
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	if response.Code != "OK" || response.Result == nil || validateResult(operation, *response.Result) != nil {
		r.fail(ErrResourceHeld, false)
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	var result ResourceCurrentResult
	if strictJSON(response.Result.Payload, &result) != nil {
		r.fail(ErrResourceHeld, true)
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	canonical, _ = json.Marshal(result)
	if !equivalentJSON(response.Result.Payload, canonical) || result.Classification != "UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA" || result.Authority || result.RegisteredIssuer || result.ProductionEnabled || result.Observation == nil || result.Observation.Server != r.expected || result.Observation.Caller != r.caller || !idPattern.MatchString(result.Observation.SessionID) {
		r.fail(ErrResourceHeld, true)
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	r.mu.Lock()
	if r.session == "" {
		r.session = result.Observation.SessionID
	}
	same := r.session == result.Observation.SessionID
	r.mu.Unlock()
	if !same {
		r.fail(ErrResourceHeld, true)
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	if data := result.ResourceCurrent; data != nil && (data.SourceID != r.resource.SourceID || data.InstanceID != r.resource.InstanceID || data.ResourceKey != r.resource.ResourceKey) {
		r.fail(ErrResourceHeld, true)
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	if err = r.originalPeer(ctx); err != nil {
		r.fail(err, true)
		return ResourceCurrentResult{}, err
	}
	r.mu.Lock()
	r.last = result
	r.mu.Unlock()
	return result, nil
}
func (r *ResourceCurrentRPC) Current(ctx context.Context) (ResourceCurrentResult, error) {
	if r == nil {
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	r.mu.Lock()
	retired, first := r.retired, r.first
	r.mu.Unlock()
	if retired || first != nil {
		return ResourceCurrentResult{}, errors.Join(ErrResourceHeld, first)
	}
	result, err := r.roundTrip(ctx, "resource_current")
	if err != nil {
		r.fail(err, false)
		return result, err
	}
	r.mu.Lock()
	retired = r.retired
	r.mu.Unlock()
	if retired || result.Code != "DATA_ONLY" || result.ResourceCurrent == nil || result.Observation.Lifetime.Retired {
		r.fail(ErrResourceHeld, false)
		return ResourceCurrentResult{}, ErrResourceHeld
	}
	return result, nil
}
func (r *ResourceCurrentRPC) ReadCurrentResourceDATA(ctx context.Context) (contribution.ResourceCurrentDATA, error) {
	result, err := r.Current(ctx)
	if err != nil {
		return contribution.ResourceCurrentDATA{}, err
	}
	return *result.ResourceCurrent, nil
}
func (r *ResourceCurrentRPC) Retire(ctx context.Context) error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	r.retired = true
	r.mu.Unlock()
	result, err := r.roundTrip(ctx, "resource_current_retire")
	if err != nil {
		return err
	}
	if !result.Observation.Lifetime.Retired {
		return ErrResourceHeld
	}
	return nil
}
func (r *ResourceCurrentRPC) Join(ctx context.Context) (bool, error) {
	if r == nil {
		return true, nil
	}
	r.mu.Lock()
	retired := r.retired
	r.mu.Unlock()
	if !retired {
		return false, ErrResourceHeld
	}
	result, err := r.roundTrip(ctx, "resource_current_join")
	if err != nil {
		return false, err
	}
	return result.Observation.Lifetime.Joined, nil
}
func (r *ResourceCurrentRPC) Close(ctx context.Context) (bool, error) {
	if r == nil {
		return true, nil
	}
	r.mu.Lock()
	closed := r.closed
	first := r.first
	r.mu.Unlock()
	if closed {
		return true, first
	}
	result, err := r.roundTrip(ctx, "resource_current_close")
	if err != nil {
		return false, errors.Join(ErrResourceRemoteUnknown, err)
	}
	if !result.Observation.Lifetime.PhysicalComplete {
		return false, ErrResourceHeld
	}
	r.mu.Lock()
	r.closed = true
	r.retired = true
	first = r.first
	r.mu.Unlock()
	_ = r.connection.Close()
	return true, first
}
