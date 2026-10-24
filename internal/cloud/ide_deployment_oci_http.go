package cloud

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

func (e *OCIIDEDeploymentExecutor) ProjectRuntimeOrigin() string { return e.cfg.RuntimeOrigin }

func (e *OCIIDEDeploymentExecutor) projectURL(handle string) (string, error) {
	if e.cfg.RuntimeOrigin == "" || !ideRuntimeHandle.MatchString(handle) {
		return "", ErrInvalid
	}
	base, err := url.Parse(e.cfg.RuntimeOrigin)
	if err != nil {
		return "", err
	}
	base.Host = "h" + handle + "." + base.Host
	return base.String() + "/", nil
}

// Fixed bridge code executes INSIDE the same read-only, network=none sandbox.
// It talks only to the approved application's own loopback port. No host port,
// bridge network, external route, shell, credential or npm install is needed.
func ideNodeHTTPBridge(port int) string {
	return fmt.Sprintf(`const net=require('node:net');const s=net.connect({host:'127.0.0.1',port:%d});s.setTimeout(8000,()=>{process.exitCode=1;s.destroy();});s.on('error',()=>{process.exitCode=1;});s.on('close',()=>process.stdin.destroy());process.stdin.pipe(s,{end:false});s.pipe(process.stdout);`, port)
}

func (e *OCIIDEDeploymentExecutor) RoundTripProject(ctx context.Context, op IDEDeploymentOperation, request *http.Request) (*http.Response, error) {
	if e.cfg.RuntimeOrigin == "" || e.input == nil || request == nil {
		return nil, ErrIDEExistingRuntimeUnavailable
	}
	state, err := e.inspect(ctx, op)
	if err != nil {
		return nil, err
	}
	if !state.State.Running {
		return nil, ErrIDEExistingRuntimeUnavailable
	}
	forward := request.Clone(ctx)
	forward.RequestURI = ""
	forward.Close = true
	u := *request.URL
	u.Scheme = "http"
	u.Host = fmt.Sprintf("127.0.0.1:%d", e.cfg.HTTPPort)
	forward.URL = &u
	var encoded bytes.Buffer
	if err := forward.Write(&encoded); err != nil || encoded.Len() > MaxUploadBytes+(64<<10) {
		return nil, ErrInvalid
	}
	result, err := e.input(ctx, encoded.Bytes(), "exec", "--interactive", state.ID, "/usr/local/bin/node", "-e", ideNodeHTTPBridge(e.cfg.HTTPPort))
	if err != nil {
		return nil, err
	}
	if len(result) > MaxUploadBytes {
		return nil, ErrIDEExistingRuntimeUnavailable
	}
	response, err := http.ReadResponse(bufio.NewReader(bytes.NewReader(result)), forward)
	if err != nil {
		return nil, ErrIDEExistingRuntimeUnavailable
	}
	if response.StatusCode < 200 || response.StatusCode == http.StatusSwitchingProtocols {
		response.Body.Close()
		return nil, ErrIDEExistingRuntimeUnavailable
	}
	return response, nil
}

func (e *OCIIDEDeploymentExecutor) projectProbe(ctx context.Context, op IDEDeploymentOperation) (*http.Response, error) {
	r := &http.Request{Method: http.MethodHead, URL: &url.URL{Path: "/"}, Header: make(http.Header)}
	response, err := e.RoundTripProject(ctx, op, r)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		response.Body.Close()
		return nil, ErrIDEExistingRuntimeUnavailable
	}
	return response, nil
}
