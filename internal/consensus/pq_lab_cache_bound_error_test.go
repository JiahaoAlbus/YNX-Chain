//go:build unix

package consensus

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestPQLabStaticCacheBoundCleanRefusalIsExact(t *testing.T) {
	path := filepath.Join(t.TempDir(), "public")
	if err := os.WriteFile(path, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	reads := &pqLabStaticReads{cacheable: true, bytes: pqLabStaticMaxBytes}
	if _, err := reads.read(path, 1); err != ErrPQLabStaticCacheBound {
		t.Fatal("clean optional-budget refusal is not the exact sentinel", err)
	}
	if reads.cacheable || len(reads.originals) != 0 || reads.bytes != 0 {
		t.Fatal("bounded reader retained an unheld reusable source")
	}
}

func TestPQLabStaticCacheBoundCleanupFailureIsNotOnlyBound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "public")
	if err := os.WriteFile(path, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	reads := &pqLabStaticReads{cacheable: true, bytes: pqLabStaticMaxBytes, originals: []*proofHostOriginal{{file: f}}}
	_, err = reads.read(path, 1)
	if err == ErrPQLabStaticCacheBound || !errors.Is(err, ErrPQLabStaticCacheBound) {
		t.Fatal("actual descriptor close failure was lost", err)
	}
	joined, ok := err.(interface{ Unwrap() []error })
	if !ok || len(joined.Unwrap()) != 2 || joined.Unwrap()[1] == nil {
		t.Fatal("actual mixed failure was reduced to cache eligibility", err)
	}
}
