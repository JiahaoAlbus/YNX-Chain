package datafabricapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
)

type traceContextKey struct{}

func requestTraceContext(parent context.Context, supplied string) (context.Context, string, string) {
	traceID := validTraceID(supplied)
	if traceID == "" {
		traceID = randomHex(16)
	}
	traceparent := "00-" + traceID + "-" + randomHex(8) + "-01"
	return context.WithValue(parent, traceContextKey{}, traceID), traceID, traceparent
}

func childTraceparent(ctx context.Context) string {
	traceID, _ := ctx.Value(traceContextKey{}).(string)
	if traceID == "" {
		return ""
	}
	return "00-" + traceID + "-" + randomHex(8) + "-01"
}

func validTraceID(value string) string {
	parts := strings.Split(strings.ToLower(value), "-")
	if len(parts) != 4 || parts[0] != "00" || len(parts[1]) != 32 || len(parts[2]) != 16 || len(parts[3]) != 2 || allZero(parts[1]) || allZero(parts[2]) {
		return ""
	}
	for _, part := range parts[1:] {
		if _, err := hex.DecodeString(part); err != nil {
			return ""
		}
	}
	return parts[1]
}

func randomHex(size int) string {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		// Trace context is diagnostic rather than authoritative. Omitting a
		// random span is safer than weakening any request authorization path.
		return strings.Repeat("f", size*2)
	}
	return hex.EncodeToString(value)
}

func allZero(value string) bool { return strings.Trim(value, "0") == "" }
