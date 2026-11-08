//go:build cgo && ynx_source_native_collector && (darwin || linux)

package kernel

/*
#include <stdlib.h>
#include "ynx_social_finite_joint_provider_source_private_v1.h"
*/
import "C"
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"sync"
	"unsafe"

	joint "github.com/JiahaoAlbus/YNX-Chain/sdk/socialfreshjointprofile"
)

// Only this process's independently verified capture enters the existing R6
// inventory. No caller reference, Go pointer, private key or Source DTO does.
var originalJointProviders = struct {
	sync.Mutex
	next   uint64
	owners map[uint64]*originalJointProvider
}{owners: make(map[uint64]*originalJointProvider)}

type originalJointProvider struct {
	mu        sync.Mutex
	thread    uint64
	capture   *originalSocialJointIssuerCapture
	borrow    *originalSocialJointIssuerCaptureBorrow
	reference *socialJointCaptureReference
	first     error
	closed    bool
	// A view whose release is not physically proven is retained, never retried
	// or silently forgotten. It prevents releasing this Source's parent debt.
	view    *C.ynx_social_joint_binding_view_v1
	binding *C.ynx_social_joint_binding_v1
}

func lookupOriginalJointProvider(id uint64) *originalJointProvider {
	originalJointProviders.Lock()
	p := originalJointProviders.owners[id]
	originalJointProviders.Unlock()
	if p == nil || p.thread != originalSocialJointCurrentThread() {
		return nil
	}
	return p
}
func (p *originalJointProvider) remember(e error) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.first == nil && e != nil {
		p.first = e
	}
	return p.first
}
func (p *originalJointProvider) current() error {
	if p == nil {
		return errSocialSessionPrincipalRequired
	}
	p.mu.Lock()
	first, closed, ref, c := p.first, p.closed, p.reference, p.capture
	p.mu.Unlock()
	if first != nil {
		return first
	}
	if closed || c == nil || ref == nil {
		return p.remember(errSocialSessionPrincipalChanged)
	}
	if e := c.current(context.Background()); e != nil {
		return p.remember(e)
	}
	ref.mu.Lock()
	e := captureReferenceCurrent(ref, p.thread)
	ref.mu.Unlock()
	if e != nil {
		return p.remember(e)
	}
	return p.remember(c.current(context.Background()))
}

//export ynx_auth_social_joint_provider_source_open_v1
func ynx_auth_social_joint_provider_source_open_v1(in *C.ynx_social_joint_source_input_v1, out *C.uint64_t, status *C.ynx_social_joint_status_v1) {
	if out != nil {
		*out = 0
	}
	if status == nil {
		return
	}
	fail := func(e error) { originalJointCaptureStatus(status, e, false) }
	if in == nil || out == nil || in.version != 2 || in.size != C.uint32_t(C.sizeof_ynx_social_joint_source_input_v1) || in.same_process_capture_reference != 0 {
		fail(errSocialSessionPrincipalRequired)
		return
	}
	var raw socialJointCapturedPublicOriginals
	var e error
	if raw.Registration, e = originalJointInputBytes(in.registration); e != nil {
		fail(e)
		return
	}
	if raw.Issuer, e = originalJointInputBytes(in.issuer_credential); e != nil {
		fail(e)
		return
	}
	if raw.Anchor, e = originalJointInputBytes(in.anchor_credential); e != nil {
		fail(e)
		return
	}
	if raw.History, e = originalJointInputBytes(in.history_envelope); e != nil {
		fail(e)
		return
	}
	var resource [32]byte
	copy(resource[:], unsafe.Slice((*byte)(unsafe.Pointer(&in.registered_source_resource[0])), 32))
	if resource == ([32]byte{}) {
		fail(errSocialSessionPrincipalRequired)
		return
	}
	p := &originalJointProvider{thread: originalSocialJointCurrentThread()}
	originalJointProviders.Lock()
	if originalJointProviders.next == ^uint64(0) {
		originalJointProviders.Unlock()
		fail(errJointIssuerPending)
		return
	}
	originalJointProviders.next++
	id := originalJointProviders.next
	originalJointProviders.owners[id] = p
	originalJointProviders.Unlock()
	*out = C.uint64_t(id) // Adopt even failed/partial qualification before status.
	p.capture, e = loadOriginalSocialJointProviderCapture(context.Background(), raw)
	if e == nil && p.capture == nil {
		e = errSocialSessionPrincipalRequired
	}
	if e == nil {
		p.borrow, e = p.capture.retain(context.Background())
	}
	if e == nil {
		p.reference, e = registerOriginalSocialJointProviderCapture(context.Background(), p.borrow, resource)
	}
	if e == nil {
		e = p.current()
	}
	fail(p.remember(e))
}

//export ynx_auth_social_joint_provider_source_reference_v1
func ynx_auth_social_joint_provider_source_reference_v1(id C.uint64_t, out *C.uint64_t, status *C.ynx_social_joint_status_v1) {
	if out != nil {
		*out = 0
	}
	if status == nil {
		return
	}
	p := lookupOriginalJointProvider(uint64(id))
	if p == nil || out == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	if e := p.current(); e != nil {
		originalJointCaptureStatus(status, e, false)
		return
	}
	*out = C.uint64_t(p.reference.id)
	originalJointCaptureStatus(status, p.current(), false)
}

//export ynx_auth_social_joint_provider_source_current_v1
func ynx_auth_social_joint_provider_source_current_v1(id C.uint64_t, status *C.ynx_social_joint_status_v1) {
	if status == nil {
		return
	}
	p := lookupOriginalJointProvider(uint64(id))
	if p == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	originalJointCaptureStatus(status, p.current(), false)
}

func originalJointProviderText(out []byte, s string) error {
	if !sourceASCII(s, len(out)-1) {
		return errSourceProofInvalid
	}
	copy(out, []byte(s))
	return nil
}

//export ynx_auth_social_joint_provider_source_facts_v1
func ynx_auth_social_joint_provider_source_facts_v1(id C.uint64_t, role C.uint32_t, out *C.ynx_social_joint_provider_facts_v1, status *C.ynx_social_joint_status_v1) {
	if out != nil {
		*out = C.ynx_social_joint_provider_facts_v1{}
	}
	if status == nil {
		return
	}
	p := lookupOriginalJointProvider(uint64(id))
	if p == nil || out == nil || (role != 1 && role != 2) {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	if e := p.current(); e != nil {
		originalJointCaptureStatus(status, e, false)
		return
	}
	c := p.capture
	c.mu.Lock()
	credential := c.origin.issuer
	if role == 2 {
		credential = c.origin.anchor
	}
	scope := c.scope
	history := append([]byte(nil), c.history...)
	nonce := c.origin.history.Nonce
	policy := c.policy
	c.mu.Unlock()
	classic, e := sourceBytes(credential.Public.Classic, 33, 33)
	if e != nil {
		originalJointCaptureStatus(status, p.remember(e), false)
		return
	}
	pq, e := sourceBytes(credential.Public.PQ, 2592, 2592)
	if e != nil {
		originalJointCaptureStatus(status, p.remember(e), false)
		return
	}
	n, e := sourceBytes(nonce, 32, 32)
	if e != nil {
		originalJointCaptureStatus(status, p.remember(e), false)
		return
	}
	scopeRaw, e := json.Marshal(scope)
	if e != nil {
		originalJointCaptureStatus(status, p.remember(e), false)
		return
	}
	facts := C.ynx_social_joint_provider_facts_v1{version: 1, size: C.uint32_t(C.sizeof_ynx_social_joint_provider_facts_v1), role: role, credential_epoch: C.uint64_t(credential.Epoch)}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&facts.classic_public[0])), 33), classic)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&facts.pq_public[0])), 2592), pq)
	a, b := sha256.Sum256(scopeRaw), sha256.Sum256(history)
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&facts.scope_sha256[0])), 32), a[:])
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&facts.history_original_sha256[0])), 32), b[:])
	copy(unsafe.Slice((*byte)(unsafe.Pointer(&facts.history_nonce[0])), 32), n)
	for _, v := range []struct {
		out []byte
		s   string
	}{
		{unsafe.Slice((*byte)(unsafe.Pointer(&facts.custodian[0])), 513), credential.Custodian},
		{unsafe.Slice((*byte)(unsafe.Pointer(&facts.realm[0])), 129), policy.Realm},
		{unsafe.Slice((*byte)(unsafe.Pointer(&facts.client[0])), 129), policy.Client},
		{unsafe.Slice((*byte)(unsafe.Pointer(&facts.network[0])), 129), policy.Network},
		{unsafe.Slice((*byte)(unsafe.Pointer(&facts.header_sha256[0])), 65), policy.HeaderSHA256},
	} {
		if e = originalJointProviderText(v.out, v.s); e != nil {
			originalJointCaptureStatus(status, p.remember(e), false)
			return
		}
	}
	p.reference.mu.Lock()
	facts.not_before_ms = C.int64_t(p.reference.notBeforeMS)
	facts.expires_ms = C.int64_t(p.reference.expiresMS)
	p.reference.mu.Unlock()
	*out = facts // PUBLIC original output is retained even on a late current error.
	originalJointCaptureStatus(status, p.current(), false)
}

//export ynx_auth_social_joint_provider_source_seal_original_v1
func ynx_auth_social_joint_provider_source_seal_original_v1(id C.uint64_t, source *C.ynx_social_joint_source_v1, binding *C.ynx_social_joint_binding_v1, role C.uint32_t, body, frame C.ynx_social_joint_bytes_v1, status *C.ynx_social_joint_status_v1) {
	if status == nil {
		return
	}
	p := lookupOriginalJointProvider(uint64(id))
	if p == nil || source == nil || binding == nil || (role != 1 && role != 2) {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	if e := p.current(); e != nil {
		originalJointCaptureStatus(status, e, false)
		return
	}
	p.mu.Lock()
	pending := p.view != nil
	p.mu.Unlock()
	if pending {
		originalJointCaptureStatus(status, p.remember(errJointIssuerPending), false)
		return
	}
	raw, e := jointCopy(body, 32768)
	if e != nil || len(raw) == 0 {
		originalJointCaptureStatus(status, p.remember(errSourceProofInvalid), false)
		return
	}
	f, e := jointCopy(frame, 49152)
	if e != nil {
		originalJointCaptureStatus(status, p.remember(e), false)
		return
	}
	name := "record-issuer"
	if role == 2 {
		name = "record-anchor"
	}
	expected, e := sourceSigningInput(name, raw)
	if e != nil || !bytes.Equal(expected, f) {
		originalJointCaptureStatus(status, p.remember(errSourceProofInvalid), false)
		return
	}
	var decoded joint.BodyDATA
	if e = decodeSourceCanonical(raw, &decoded, 32768); e != nil {
		originalJointCaptureStatus(status, p.remember(e), false)
		return
	}
	nativeCurrent := func() error {
		var s C.ynx_social_joint_status_v1
		C.ynx_social_joint_source_current_v1(source, &s)
		if e := jointStatus(s, false); e != nil {
			return e
		}
		s = C.ynx_social_joint_status_v1{}
		C.ynx_social_joint_binding_current_v1(binding, &s)
		return jointStatus(s, false)
	}
	if e = nativeCurrent(); e != nil {
		originalJointCaptureStatus(status, p.remember(e), false)
		return
	}
	view := (*C.ynx_social_joint_binding_view_v1)(C.calloc(1, C.size_t(C.sizeof_ynx_social_joint_binding_view_v1)))
	if view == nil {
		originalJointCaptureStatus(status, p.remember(errJointIssuerPending), false)
		return
	}
	p.mu.Lock()
	p.view = view
	p.binding = binding
	p.mu.Unlock() // adopt before paired status
	var s C.ynx_social_joint_status_v1
	C.ynx_social_joint_binding_view_v1_open(binding, view, &s)
	e = jointStatus(s, false)
	held := view.version == 1 && view.size == C.uint32_t(C.sizeof_ynx_social_joint_binding_view_v1)
	if !held && e == nil {
		e = errSocialSessionPrincipalChanged
	}
	if held && e == nil {
		var data joint.RegisteredBindingDATA
		var nb, end int64
		data, nb, end, e = jointBindingViewDATA(*view)
		if e == nil {
			e = p.reference.sealBodyOriginal(context.Background(), p.thread, data, nb, end, raw, decoded.IssuedMS, decoded.ExpiresMS)
		}
		if e == nil {
			e = nativeCurrent()
		}
		if e == nil {
			e = p.current()
		}
	}
	p.remember(e)
	if held {
		s = C.ynx_social_joint_status_v1{}
		C.ynx_social_joint_binding_view_v1_release(binding, view, &s)
		p.remember(jointStatus(s, false))
	}
	// Only the actual callee's cleared view proves physical release. Untouched
	// all-zero early output owns no view. Unknown/nonzero output is never freed.
	if view.version == 0 && view.size == 0 {
		C.free(unsafe.Pointer(view))
		p.mu.Lock()
		p.view = nil
		p.binding = nil
		p.mu.Unlock()
	} else {
		p.remember(errJointIssuerPending)
	}
	if e == nil {
		p.remember(p.current())
	}
	originalJointCaptureStatus(status, p.remember(nil), false)
}

//export ynx_auth_social_joint_provider_source_close_v1
func ynx_auth_social_joint_provider_source_close_v1(id *C.uint64_t, status *C.ynx_social_joint_status_v1) {
	if status == nil {
		return
	}
	if id == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	p := lookupOriginalJointProvider(uint64(*id))
	if p == nil {
		originalJointCaptureStatus(status, errSocialSessionPrincipalRequired, false)
		return
	}
	p.mu.Lock()
	pending, closed := p.view != nil, p.closed
	p.mu.Unlock()
	if closed {
		*id = 0
		originalJointCaptureStatus(status, p.remember(nil), true)
		return
	}
	if pending {
		originalJointCaptureStatus(status, p.remember(errJointIssuerPending), false)
		return
	}
	if p.reference != nil {
		done, e := p.reference.close(p.thread)
		p.remember(e)
		if !done {
			originalJointCaptureStatus(status, p.remember(errJointIssuerPending), false)
			return
		}
		p.reference = nil
	}
	if p.borrow != nil {
		done, e := p.borrow.close()
		p.remember(e)
		if !done {
			originalJointCaptureStatus(status, p.remember(errJointIssuerPending), false)
			return
		}
		p.borrow = nil
	}
	if p.capture != nil {
		done, e := p.capture.close()
		p.remember(e)
		if !done {
			originalJointCaptureStatus(status, p.remember(errJointIssuerPending), false)
			return
		}
		p.capture = nil
	}
	p.mu.Lock()
	p.closed = true
	p.mu.Unlock()
	*id = 0
	originalJointCaptureStatus(status, p.remember(nil), true)
}
