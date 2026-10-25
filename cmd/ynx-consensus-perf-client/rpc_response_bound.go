package main

import (
	"errors"
	"io"
	"net/http"
)

const rpcResponseByteLimit = 16 << 20

var errRPCResponseBound = errors.New("local performance RPC response exceeds 16 MiB bound")

type boundedRPCTransport struct{ base http.RoundTripper }

func (t boundedRPCTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(request)
	if err != nil {
		return nil, err
	}
	if response != nil && response.Body != nil {
		response.Body = &boundedRPCBody{ReadCloser: response.Body, remaining: rpcResponseByteLimit}
	}
	return response, nil
}

type boundedRPCBody struct {
	io.ReadCloser
	remaining int64
}

func (b *boundedRPCBody) Read(p []byte) (int, error) {
	if b.remaining < 0 {
		return 0, errRPCResponseBound
	}
	if int64(len(p)) > b.remaining+1 {
		p = p[:b.remaining+1]
	}
	n, err := b.ReadCloser.Read(p)
	b.remaining -= int64(n)
	if b.remaining < 0 {
		return 0, errRPCResponseBound
	}
	return n, err
}
