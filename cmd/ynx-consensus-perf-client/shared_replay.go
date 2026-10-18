package main

import (
	"context"
	"crypto/sha256"
)

// Candidate scaffolding: the RED test must demonstrate duplicate production
// decoding before any cache is wired into the durable observation path.
type sharedReplayValue struct {
	payload        []byte
	format         string
	completeBytes  int
	incompleteTail bool
}

type sharedReplayCache struct{}

func (c *sharedReplayCache) get(ctx context.Context, key [sha256.Size]byte, produce func() (sharedReplayValue, error)) (sharedReplayValue, error) {
	return produce()
}
