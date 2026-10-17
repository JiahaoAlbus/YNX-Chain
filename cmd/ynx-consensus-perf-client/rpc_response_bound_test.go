package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"
	"time"
)

type boundedTestBody struct {
	remaining int64
	closed    bool
}

func (b *boundedTestBody) Read(p []byte) (int, error) {
	if b.remaining == 0 {
		return 0, io.EOF
	}
	n := int64(len(p))
	if n > b.remaining {
		n = b.remaining
	}
	for i := int64(0); i < n; i++ {
		p[i] = 'a'
	}
	b.remaining -= n
	return int(n), nil
}
func (b *boundedTestBody) Close() error { b.closed = true; return nil }

func TestRPCResponseBoundRejectsOversizeAndClosesOriginalBody(t *testing.T) {
	for _, size := range []int64{3, rpcResponseByteLimit, rpcResponseByteLimit + 1} {
		original := &boundedTestBody{remaining: size}
		transport := boundedRPCTransport{base: transportFunc(func(request *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: original, Request: request}, nil
		})}
		request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "http://127.0.0.1:1", nil)
		if err != nil {
			t.Fatal(err)
		}
		response, err := transport.RoundTrip(request)
		if err != nil {
			t.Fatal(err)
		}
		n, err := io.Copy(io.Discard, response.Body)
		if size <= rpcResponseByteLimit {
			if err != nil || n != size {
				t.Fatal("valid bounded response lost", size, n, err)
			}
		} else if !errors.Is(err, errRPCResponseBound) || n > rpcResponseByteLimit {
			t.Fatal("oversized response accepted", n, err)
		}
		if err = response.Body.Close(); err != nil || !original.closed {
			t.Fatal("original response body not closed")
		}
	}
}

func TestBlockScanConfigurationRequiresNodeAffinityAndPacing(t *testing.T) {
	valid := options{manifest: "isolated", transactions: "signed", output: "new.json", rounds: 4, senderMode: "ready-pool", inclusionMode: "block-scan", concurrency: 4, observers: 4, offeredRate: 256, timeout: 10 * time.Second, poll: 100 * time.Millisecond}
	if err := validateOptions(valid); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"unknown", "one_observer", "no_pacing"} {
		o := valid
		switch mode {
		case "unknown":
			o.inclusionMode = "other"
		case "one_observer":
			o.observers = 1
		case "no_pacing":
			o.offeredRate = 0
		}
		if validateOptions(o) == nil {
			t.Fatal("unsafe scanner configuration accepted", mode)
		}
	}
}
