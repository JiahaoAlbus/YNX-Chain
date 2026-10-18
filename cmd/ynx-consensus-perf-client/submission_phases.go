package main

import (
	"context"
	"net/http/httptrace"
	"sync"
	"time"
)

// Offsets use the original submission's monotonic clock. Missing hooks stay
// absent, including failed/UNKNOWN requests. Counts expose repeated hooks rather
// than silently treating a multi-attempt transport as one network exchange.
// These boundaries are client observations, not pure network/server durations.
type submissionPhases struct {
	GetConnCalls        int    `json:"getConnCalls"`
	GotConnCalls        int    `json:"gotConnCalls"`
	WroteRequestCalls   int    `json:"wroteRequestCalls"`
	FirstByteCalls      int    `json:"firstByteCalls"`
	WriteErrors         int    `json:"writeErrors"`
	FirstGetConnNs      *int64 `json:"firstGetConnNs,omitempty"`
	FirstGotConnNs      *int64 `json:"firstGotConnNs,omitempty"`
	FirstWroteRequestNs *int64 `json:"firstWroteRequestNs,omitempty"`
	FirstResponseByteNs *int64 `json:"firstResponseByteNs,omitempty"`
	FirstConnReused     *bool  `json:"firstConnReused,omitempty"`
	CallbackReturnNs    int64  `json:"callbackReturnNs"`
}

func traceSubmission(ctx context.Context, started time.Time) (context.Context, func() *submissionPhases) {
	var mu sync.Mutex
	var facts submissionPhases
	mark := func(count *int, offset **int64) {
		*count++
		if *offset == nil {
			n := time.Since(started).Nanoseconds()
			*offset = &n
		}
	}
	trace := &httptrace.ClientTrace{
		GetConn: func(string) {
			mu.Lock()
			defer mu.Unlock()
			mark(&facts.GetConnCalls, &facts.FirstGetConnNs)
		},
		GotConn: func(info httptrace.GotConnInfo) {
			mu.Lock()
			defer mu.Unlock()
			mark(&facts.GotConnCalls, &facts.FirstGotConnNs)
			if facts.FirstConnReused == nil {
				reused := info.Reused
				facts.FirstConnReused = &reused
			}
		},
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			mu.Lock()
			defer mu.Unlock()
			mark(&facts.WroteRequestCalls, &facts.FirstWroteRequestNs)
			if info.Err != nil {
				facts.WriteErrors++
			}
		},
		GotFirstResponseByte: func() {
			mu.Lock()
			defer mu.Unlock()
			mark(&facts.FirstByteCalls, &facts.FirstResponseByteNs)
		},
	}
	return httptrace.WithClientTrace(ctx, trace), func() *submissionPhases {
		mu.Lock()
		defer mu.Unlock()
		out := facts
		out.CallbackReturnNs = time.Since(started).Nanoseconds()
		return &out
	}
}
