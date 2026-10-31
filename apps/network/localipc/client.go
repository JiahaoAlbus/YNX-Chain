package localipc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func jsonMarshalResponse(r Response) ([]byte, error) { return json.Marshal(r) }

// Call is the native local entry. It never dials TCP or accepts a URL. The peer
// UID is obtained again from the kernel before sending structured request data.
func Call(ctx context.Context, directory string, request Request) (Response, error) {
	var out Response
	if !supported() {
		return out, ErrUnsupported
	}
	if ctx == nil {
		return out, errors.New("call context required")
	}
	if err := validateRequest(request); err != nil {
		return out, err
	}
	uid := os.Geteuid()
	if uid < 0 {
		return out, ErrUnsupported
	}
	if _, err := privateDirectory(directory, uint32(uid)); err != nil {
		return out, err
	}
	path := filepath.Join(directory, SocketName)
	info, err := os.Lstat(path)
	if err != nil {
		return out, err
	}
	owner, err := fileOwner(info)
	if err != nil || owner != uint32(uid) || info.Mode()&os.ModeSocket == 0 || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o600 {
		return out, errors.New("owned private Unix socket required")
	}
	raw, err := json.Marshal(request)
	if err != nil || len(raw) > MaxMessageBytes {
		return out, errors.New("bounded structured request required")
	}
	transport := &http.Transport{DisableKeepAlives: true, DialContext: func(callCtx context.Context, network, address string) (net.Conn, error) {
		if _, err := privateDirectory(directory, uint32(uid)); err != nil {
			return nil, err
		}
		if !samePath(path, info) {
			return nil, ErrEndpointChanged
		}
		connection, err := (&net.Dialer{}).DialContext(callCtx, "unix", path)
		if err != nil {
			return nil, err
		}
		unixConn, ok := connection.(*net.UnixConn)
		if !ok {
			_ = connection.Close()
			return nil, ErrUnsupported
		}
		peer, err := kernelPeer(unixConn)
		if err != nil || !peer.Verified() || SameUID(uint32(uid), peer.UID()) != nil {
			_ = connection.Close()
			return nil, ErrPeerDenied
		}
		return connection, nil
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("IPC redirects denied") }}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://localipc/v1/call", bytes.NewReader(raw))
	if err != nil {
		return out, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	response, err := client.Do(httpRequest)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxMessageBytes+1))
	if err != nil || len(body) > MaxMessageBytes {
		return out, errors.New("invalid bounded IPC response")
	}
	if response.StatusCode != http.StatusOK || strictJSON(body, &out) != nil || out.Version != Version || out.ID != request.ID || !out.Peer.NativeIPCVerified || out.Peer.BrowserIdentityVerified || out.Peer.UID != uint32(uid) {
		return Response{}, errors.New("IPC response binding failed")
	}
	canonical, err := json.Marshal(out)
	if err != nil || !equivalentJSON(body, canonical) {
		return Response{}, errors.New("noncanonical IPC response")
	}
	if out.Code != "OK" {
		return out, responseError(out.Code)
	}
	if out.Result == nil || validateResult(request.Operation, *out.Result) != nil {
		return Response{}, errors.New("invalid structured IPC result")
	}
	return out, nil
}
