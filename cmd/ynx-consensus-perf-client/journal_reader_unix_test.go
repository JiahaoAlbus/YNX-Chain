//go:build darwin || linux

package main

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"golang.org/x/sys/unix"
)

func TestJournalReaderWaitsForWriterAndNeverCreatesMissingLock(t *testing.T) {
	_, migration, path, raw, height := journalReaderFixture(t)
	r, err := newDurableReader(migration, []string{path})
	if err != nil {
		t.Fatal(err)
	}
	lock, err := os.OpenFile(path+".read.lock", os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), path, raw, height); !errors.Is(err, errDurableNotReady) {
		t.Fatal("active writer did not postpone readback", err)
	}
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_UN); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), path, raw, height); err != nil {
		t.Fatal("writer release did not restore readback", err)
	}
	// Every reader lock must have been released before an observer makes RPCs.
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		t.Fatal("reader leaked its shared lock", err)
	}
	_ = unix.Flock(int(lock.Fd()), unix.LOCK_UN)
	if err := os.Remove(path + ".read.lock"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), path, raw, height); err == nil {
		t.Fatal("missing writer lock accepted")
	}
	if _, err := os.Stat(path + ".read.lock"); !os.IsNotExist(err) {
		t.Fatal("readback created a lock")
	}
	if err := os.WriteFile(path+".read.lock", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	release, err := consensus.LockSnapshotJournalRead(path)
	if err != nil {
		t.Fatal(err)
	}
	release()
	release()
	recreated, err := os.OpenFile(path+".read.lock", os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer recreated.Close()
	if err := unix.Flock(int(recreated.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		t.Fatal("idempotent release failed")
	}
}
