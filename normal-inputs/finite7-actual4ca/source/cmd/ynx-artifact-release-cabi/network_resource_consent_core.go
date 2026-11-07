package main

import (
	"errors"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	consent "github.com/JiahaoAlbus/YNX-Chain/internal/ynxresourceconsent"
)

const resourceOperationLimit = 32
const resourceOwnedLimit = 32 << 20
const resourceMemberCapacity = ynxbatch.MaxNetworkResourceMemberBytes

// Reserve maximum future policy/member storage, not merely current length.
// This bounds growth during fresh Current BEFORE any private read. The 8192
// allowance covers independent pair/text binding; no secret enters this map.
const resourceFixedReservation = ynxauth.MaxWalletPolicyProjectionBytes + resourceMemberCapacity + 8192
const resourceUnknownHandle resultCode = 11
const resourceAlreadySelected resultCode = 12
const resourceRetired resultCode = 13
const resourcePending resultCode = 14
const resourceResourceLimit resultCode = 15

type resourceEntry struct {
	attempt       *consent.MaterialAttempt
	owned, active int
}

var resourceOperations = struct {
	sync.Mutex
	next    uint64
	owned   int
	entries map[uint64]*resourceEntry
}{entries: make(map[uint64]*resourceEntry)}

func resourceReserve(scope, input int) (uint64, *resourceEntry, resultCode) {
	n := scope + input + resourceFixedReservation
	resourceOperations.Lock()
	defer resourceOperations.Unlock()
	if n < 0 || n > resourceOwnedLimit-resourceOperations.owned || len(resourceOperations.entries) >= resourceOperationLimit || resourceOperations.next == ^uint64(0) {
		return 0, nil, resourceResourceLimit
	}
	resourceOperations.next++
	id := resourceOperations.next
	e := &resourceEntry{owned: n, active: 1}
	resourceOperations.entries[id] = e
	resourceOperations.owned += n
	return id, e, resultOK
}
func resourceAcquire(id uint64) (*resourceEntry, resultCode) {
	resourceOperations.Lock()
	defer resourceOperations.Unlock()
	e := resourceOperations.entries[id]
	if e == nil || e.attempt == nil {
		return nil, resourceUnknownHandle
	}
	e.active++
	return e, resultOK
}
func resourceDone(e *resourceEntry) {
	resourceOperations.Lock()
	defer resourceOperations.Unlock()
	e.active--
}
func resourceAlone(e *resourceEntry) bool {
	resourceOperations.Lock()
	defer resourceOperations.Unlock()
	return e.active == 1
}
func resourceRemove(id uint64, e *resourceEntry) bool {
	resourceOperations.Lock()
	defer resourceOperations.Unlock()
	if resourceOperations.entries[id] != e || e.active != 1 {
		return false
	}
	delete(resourceOperations.entries, id)
	resourceOperations.owned -= e.owned
	return true
}
func resourceInstall(e *resourceEntry, a *consent.MaterialAttempt) {
	resourceOperations.Lock()
	defer resourceOperations.Unlock()
	e.attempt = a
}
func resourceCode(err error) resultCode {
	switch {
	case err == nil:
		return resultOK
	case errors.Is(err, consent.ErrCurrent):
		return resultOutputValidation
	case errors.Is(err, consent.ErrMaterial):
		return resultKeyMaterial
	case errors.Is(err, consent.ErrCleanup):
		return resultCleanup
	case errors.Is(err, consent.ErrInternal):
		return resultInternal
	case errors.Is(err, consent.ErrAttempted):
		return resourceAlreadySelected
	case errors.Is(err, consent.ErrRetired):
		return resourceRetired
	default:
		return resultSigning
	}
}
