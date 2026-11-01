package main

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
)

//go:generate go run ./internal/gen

// The bytes are owned, embedded at build time and never chosen by a task.
// Regeneration is reproducible from internal/gen; the digest is pinned below.
//
//go:embed histogram.wasm
var histogramWASM []byte

const fixedModuleSHA256 = "72d241c74a72b5aaf49b1799150676c30b6972fc0bd2e2beaea324bc7e7c6fa6"

func fixedModuleValid() bool {
	sum := sha256.Sum256(histogramWASM)
	return hex.EncodeToString(sum[:]) == fixedModuleSHA256
}
