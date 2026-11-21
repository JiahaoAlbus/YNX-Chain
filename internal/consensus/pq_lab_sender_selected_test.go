//go:build unix

package consensus

import (
	"bytes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// This fixture opens only freshly generated synthetic custody. It retains no
// plaintext outside t.TempDir and never logs or exports key bytes as evidence.
func selectedSenderVault(t *testing.T, directory string, credential []byte) ([][]byte, cipher.AEAD, []byte) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(directory, "private-senders", "keys.vault"))
	if err != nil {
		t.Fatal(err)
	}
	head, err := ynxbatch.DecodeFields(raw, 8, 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := pqLabSenderAEAD(credential, head[5])
	if err != nil {
		t.Fatal(err)
	}
	aad, err := ynxbatch.EncodeFields(head[:7]...)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := aead.Open(nil, head[6], head[7], aad)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		clear(plain)
		for _, item := range head {
			clear(item)
		}
	})
	return head, aead, plain
}

func TestPQLabSenderSelectedCustodyConcurrentRestartUnknown(t *testing.T) {
	p, pin, credential, checkpoint := senderParentFixture(t, 2)
	directory := filepath.Join(p.RootDir, "workload")
	_, _, plain := selectedSenderVault(t, directory, credential)
	// The original complete-copy decoder remains the byte oracle for imports.
	original, err := ynxbatch.DecodeFields(plain, 3, 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		for _, field := range original {
			clear(field)
		}
	}()
	var senders [2]*PQLabSender
	var failures [2]error
	var wg sync.WaitGroup
	start := make(chan struct{})
	for index := range senders {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			senders[index], failures[index] = OpenPQLabSender(directory, pin, index, credential)
		}(index)
	}
	close(start)
	wg.Wait()
	for index, sender := range senders {
		if sender != nil {
			defer sender.Close()
		}
		if failures[index] != nil || sender == nil {
			t.Fatal("independent owner open failed", failures[index])
		}
		oldMaterial, err := ynxbatch.DecodeFields(original[index+1], 4, 4096)
		if err != nil {
			t.Fatal(err)
		}
		got, err := ynxbatch.ExportKeyMaterial(sender.key)
		if err != nil {
			t.Fatal(err)
		}
		matches := bytes.Equal(got.PKCS8A, oldMaterial[0]) && bytes.Equal(got.PKCS8B, oldMaterial[1]) && bytes.Equal(got.PKA, oldMaterial[2]) && bytes.Equal(got.PKB, oldMaterial[3])
		got.Clear()
		for _, field := range oldMaterial {
			clear(field)
		}
		if !matches {
			t.Fatal("selected import differs from original complete decoder")
		}
	}
	if bytes.Equal(senders[0].public.PKA, senders[1].public.PKA) || bytes.Equal(senders[0].public.PKB, senders[1].public.PKB) {
		t.Fatal("owners share imported keys")
	}
	if duplicate, err := OpenPQLabSender(directory, pin, 0, credential); err == nil {
		duplicate.Close()
		t.Fatal("same owner lease admitted twice")
	}
	request := PQLabSenderRequest{Version: "YNX-PQ-LAB-SENDER-REQUEST/v1", OperationID: strings.Repeat("d", 64), OwnerIndex: 0, FirstNonce: 2, Members: 1}
	first := errors.New("synthetic original parent sync failure")
	senders[0].operationParentSync = func(*os.File) error { return first }
	if _, err := senders[0].Sign(request, checkpoint); !errors.Is(err, first) {
		t.Fatal("original persistence first cause lost", err)
	}
	operation := filepath.Join(directory, "sender-public", "0000", request.OperationID)
	before := senderParentOriginals(t, operation)
	if err := senders[0].Close(); err != nil {
		t.Fatal(err)
	}
	// Closing one imported key must not clear another owner's live copy.
	otherRequest := request
	otherRequest.OwnerIndex = 1
	otherRequest.OperationID = strings.Repeat("e", 64)
	result, err := senders[1].Sign(otherRequest, checkpoint)
	if err != nil {
		t.Fatal("other owner key changed after close", err)
	}
	if err := senders[1].Close(); err != nil {
		t.Fatal(err)
	}
	for index := range senders {
		cold, err := OpenPQLabSender(directory, pin, index, credential)
		if err != nil {
			t.Fatal("original owner reopen failed", err)
		}
		if index == 0 {
			if _, err := cold.Recover(request); !errors.Is(err, ErrPQLabSenderUnknown) {
				t.Fatal("cold UNKNOWN was promoted", err)
			}
			metrics := &PQLabMetrics{}
			if _, err := cold.SignMeasured(request, checkpoint, metrics); !errors.Is(err, ErrPQLabSenderUnknown) {
				t.Fatal("cold UNKNOWN was re-signed", err)
			}
			if metrics.Snapshot().Stages["sender.dualSignEncodeAndSelfVerify"].Calls != 0 {
				t.Fatal("UNKNOWN signed again")
			}
		} else if recovered, err := cold.Recover(otherRequest); err != nil || recovered.Transaction != result.Transaction {
			t.Fatal("original other-owner recovery differs", err)
		}
		if err := cold.Close(); err != nil {
			t.Fatal(err)
		}
	}
	if !reflect.DeepEqual(before, senderParentOriginals(t, operation)) {
		t.Fatal("UNKNOWN original files changed")
	}
}

func TestPQLabSenderSelectedCustodyCompleteFrameAndFirstCause(t *testing.T) {
	p, options, credential := publicOwnerSessionFixture(t)
	directory := filepath.Join(p.RootDir, "workload")
	head, aead, plain := selectedSenderVault(t, directory, credential)
	fields, err := ynxbatch.DecodeFields(plain, 3, 8<<20)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		for _, field := range fields {
			clear(field)
		}
	}()
	writePlain := func(value []byte) {
		t.Helper()
		// Even controlled malformed custody uses a fresh AEAD nonce each time.
		if _, err := rand.Read(head[6]); err != nil {
			t.Fatal(err)
		}
		aad, err := ynxbatch.EncodeFields(head[:7]...)
		if err != nil {
			t.Fatal(err)
		}
		head[7] = aead.Seal(nil, head[6], value, aad)
		raw, err := ynxbatch.EncodeFields(head...)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "private-senders", "keys.vault"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	openError := func(owner int, key []byte, want string) {
		t.Helper()
		sender, err := OpenPQLabSender(directory, options.WorkloadSHA256, owner, key)
		if sender != nil {
			sender.Close()
		}
		if err == nil || err.Error() != want {
			t.Fatalf("original open first cause changed: got %v want %s", err, want)
		}
	}
	badTail := bytes.Clone(plain)
	defer clear(badTail)
	offset := 4 + 4 + len(fields[0]) + 4 + len(fields[1])
	binary.BigEndian.PutUint32(badTail[offset:], ^uint32(0))
	writePlain(badTail)
	openError(0, credential, "synthetic key material profile invalid")
	openError(-1, credential, "bounded original synthetic online owner required")
	openError(2, credential, "bounded original synthetic online owner required")
	wrongCredential := make([]byte, len(credential))
	openError(0, wrongCredential, "synthetic sender credential or custody binding invalid")
	trailing := append(bytes.Clone(plain), 0)
	defer clear(trailing)
	writePlain(trailing)
	openError(0, credential, "synthetic key material profile invalid")
	badTag, _ := ynxbatch.EncodeFields([]byte("bad tag"), fields[1], fields[2])
	defer clear(badTag)
	writePlain(badTag)
	openError(0, credential, "synthetic key material profile invalid")
	// The old path validated all OUTER framing, but only the selected owner's
	// INNER material. Keep that exact boundary rather than inventing validation.
	unusedBad, _ := ynxbatch.EncodeFields(fields[0], fields[1], []byte("bad inner frame"))
	defer clear(unusedBad)
	writePlain(unusedBad)
	owner, err := OpenPQLabSender(directory, options.WorkloadSHA256, 0, credential)
	if err != nil {
		t.Fatal("unselected inner contents changed original behavior", err)
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
	openError(1, credential, "synthetic owner material malformed")
	// Material framing still precedes later policy checks, and the latter still
	// run after a valid import. Every failure occurs before lease acquisition.
	policyPath := filepath.Join(directory, owner.manifest.Policy.Path)
	if err := os.WriteFile(policyPath, []byte("changed synthetic policy"), 0600); err != nil {
		t.Fatal(err)
	}
	openError(1, credential, "synthetic owner material malformed")
	writePlain(plain)
	openError(1, credential, "original synthetic policy changed")
	for index := 0; index < 2; index++ {
		lease, err := AcquireApplicationStateWriterLease(filepath.Join(directory, "private-senders", []string{"owner-0000", "owner-0001"}[index]))
		if err != nil {
			t.Fatal("failed open retained owner lease", err)
		}
		if err := lease.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
