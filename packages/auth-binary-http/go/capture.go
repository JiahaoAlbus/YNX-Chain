package binaryhttpsource

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"weak"
)

// Sole SDK HTTP_PROOF_V5_CONTRACT_FINAL_PATH.json (fe65fd12...) normal cap/path.
// This new V5 domain does not modify the old 1MiB UTF8 principal contract.
const MaxCaptureResourceBytes int64 = 68288512
const MaxArtifactContractBytes int64 = 64 << 20
const OriginalBinaryHTTPPath = "/api/v1/ide/deployments"
const proofHeader = "x-ynx-product-session-proof-v5"
const maxJournalFrame = 512 << 10
const maxJournalBytes = 1 << 20

var requestID = regexp.MustCompile(`^req_[A-Za-z0-9_-]{12,80}$`)
var captureName = regexp.MustCompile(`^capture_[0-9a-f]{32}$`)
var binaryContentType = regexp.MustCompile(`^multipart/form-data; boundary=[A-Za-z0-9_-]{1,70}$`)
var (
	errDirectory   = errors.New("BINARY_CAPTURE_DIRECTORY_REQUIRED")
	errChanged     = errors.New("BINARY_CAPTURE_ORIGINAL_CHANGED")
	errRequest     = errors.New("BINARY_CAPTURE_REQUEST_INVALID")
	errDuplicate   = errors.New("BINARY_CAPTURE_ALREADY_ENTERED")
	errLimit       = errors.New("BINARY_CAPTURE_RESOURCE_LIMIT")
	errUnknown     = errors.New("BINARY_CAPTURE_UNKNOWN")
	errAborted     = errors.New("BINARY_CAPTURE_ABORTED")
	errBorrowed    = errors.New("BINARY_CAPTURE_BORROW_RETAINED")
	errClosed      = errors.New("BINARY_CAPTURE_CLOSED")
	errRecovery    = errors.New("BINARY_CAPTURE_RECOVERY_READ_ONLY")
	errNotSupplied = errors.New("BINARY_HTTP_V5_ROOT_SELECTION_NOT_SUPPLIED")
)

type RequestDATA struct{ Method, Path, ContentType, RequestID string }
type requestSnapshot struct {
	RequestDATA
	ProofHeader, Host, URI string
	Length                 int64
	Transfer               []string
	originalURL            *url.URL
	done                   <-chan struct{}
}

func ascii(s string, max int) bool {
	if len(s) == 0 || len(s) > max {
		return false
	}
	for i := range len(s) {
		if s[i] < 32 || s[i] > 126 {
			return false
		}
	}
	return true
}
func single(h http.Header, name string) (string, bool) {
	var values []string
	for k, v := range h {
		if strings.EqualFold(k, name) {
			values = append(values, v...)
		}
	}
	if len(values) != 1 {
		return "", false
	}
	return values[0], true
}
func snapshot(r *http.Request) (requestSnapshot, error) {
	var s requestSnapshot
	if r == nil || r.URL == nil || r.Context().Err() != nil || r.URL.RawQuery != "" || r.URL.ForceQuery || r.URL.Fragment != "" || r.URL.Opaque != "" {
		return s, errRequest
	}
	id, ok := single(r.Header, "x-request-id")
	proof, pok := single(r.Header, proofHeader)
	ct, cok := single(r.Header, "content-type")
	p := r.URL.EscapedPath()
	if !ok || !pok || !cok || !requestID.MatchString(id) || !ascii(proof, 196608) || !binaryContentType.MatchString(ct) || r.Method != "POST" || p != OriginalBinaryHTTPPath || r.ContentLength > MaxCaptureResourceBytes {
		return s, errRequest
	}
	total := 0
	for k, values := range r.Header {
		lower := strings.ToLower(k)
		if strings.HasPrefix(lower, "x-ynx-product-session-proof") && lower != proofHeader {
			return s, errRequest
		}
		for _, v := range values {
			total += len(k) + len(v) + 4
			if total > 262144 {
				return s, errLimit
			}
		}
	}
	s = requestSnapshot{RequestDATA: RequestDATA{r.Method, p, ct, id}, ProofHeader: proof, Host: r.Host, URI: r.RequestURI, Length: r.ContentLength, Transfer: append([]string(nil), r.TransferEncoding...), originalURL: r.URL, done: r.Context().Done()}
	return s, nil
}

type Store struct {
	mu          sync.Mutex
	directory   *secureDirectory
	records     map[weak.Pointer[http.Request]]*Capture
	children    int
	closeCalled bool
	closeResult error
	cause       error
}

func (*Store) String() string { return "BinaryCaptureStore{private originals redacted}" }
func OpenStore(existingPrivateDirectory string) (*Store, error) {
	s := &Store{records: make(map[weak.Pointer[http.Request]]*Capture)}
	var e error
	s.directory, e = openDirectory(existingPrivateDirectory)
	if e != nil {
		s.cause = e
		return s, errDirectory
	}
	return s, nil
}
func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closeCalled {
		return s.closeResult
	}
	s.closeCalled = true
	s.closeResult = s.drain()
	return s.closeResult
}
func (s *Store) DrainPartial() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closeCalled {
		return errClosed
	}
	return s.drain()
}
func (s *Store) drain() error {
	if s.children != 0 {
		return errBorrowed
	}
	if e := s.directory.close(); e != nil {
		if s.cause == nil {
			s.cause = e
		}
		return errUnknown
	}
	return nil
}

type Capture struct {
	self                                                                                                        *Capture
	mu                                                                                                          sync.Mutex
	store                                                                                                       *Store
	req                                                                                                         *http.Request
	identity                                                                                                    weak.Pointer[http.Request]
	snapshot                                                                                                    requestSnapshot
	marker                                                                                                      *capturedMarker
	original                                                                                                    io.ReadCloser
	originalClose                                                                                               sync.Once
	originalCloseError                                                                                          error
	body, journal                                                                                               *heldFile
	id                                                                                                          string
	size                                                                                                        int64
	digest                                                                                                      [32]byte
	hasher                                                                                                      hash.Hash
	sha3Digest, sha512Digest                                                                                    [64]byte
	sha3Hasher, sha512Hasher                                                                                    hash.Hash
	complete, recovered, active, aborted, unknown, closeCalled, drained, borrowed, borrowEntered, verifyEntered bool
	cause, errorClose                                                                                           error
	verified                                                                                                    *verifiedBinaryPrincipal
	originalBorrow                                                                                              *Borrow
	principalCloseCalled, principalDrained                                                                      bool
}

func (*Capture) String() string {
	return "OriginalBinaryCapture{body/proof/paths redacted; not authority}"
}
func (c *Capture) fail(e error) error {
	if c.cause == nil {
		c.cause = e
	}
	c.unknown = true
	return errUnknown
}
func (c *Capture) closeOriginal() {
	c.originalClose.Do(func() {
		if c.original != nil {
			c.originalCloseError = c.original.Close()
		}
	})
}

type capturedMarker struct{ c *Capture }

func (m *capturedMarker) Read(p []byte) (int, error) {
	if m == nil || m.c == nil {
		return 0, errBorrowed
	}
	c := m.c
	c.mu.Lock()
	b := c.originalBorrow
	ok := c.self == c && c.marker == m && b != nil && c.borrowed
	c.mu.Unlock()
	if !ok {
		return 0, errBorrowed
	}
	return b.Read(p)
}
func (m *capturedMarker) Close() error {
	m.c.mu.Lock()
	b := m.c.originalBorrow
	m.c.mu.Unlock()
	if b != nil {
		_ = b.Close()
	}
	m.c.mu.Lock()
	active := m.c.active
	m.c.mu.Unlock()
	if active {
		_ = m.c.Abort()
	}
	return m.c.Close()
}

type journalEntered struct {
	Version                string
	ID                     string
	Request                RequestDATA
	ProofHeader, Host, URI string
	Length                 int64
	Transfer               []string
}
type journalComplete struct {
	State            string
	Bytes            int64
	SHA256           string
	SHA3_512, SHA512 string
}

func appendFrame(h *heldFile, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	if len(b) > maxJournalFrame {
		return errLimit
	}
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(b)))
	if _, e = h.file.Write(n[:]); e == nil {
		_, e = h.file.Write(b)
	}
	if e == nil {
		e = h.file.Sync()
	}
	return e
}
func CaptureOriginalBinaryHTTPRequest(s *Store, r *http.Request) (c *Capture, e error) {
	if s == nil {
		return nil, errDirectory
	}
	view, e := snapshot(r)
	if e != nil {
		return nil, e
	}
	s.mu.Lock()
	if s.closeCalled || s.cause != nil {
		s.mu.Unlock()
		return nil, errClosed
	}
	token := weak.Make(r)
	for k := range s.records {
		if k.Value() == nil {
			delete(s.records, k)
		}
	}
	if _, exists := s.records[token]; exists {
		s.mu.Unlock()
		return nil, errDuplicate
	}
	if s.children >= 32 || len(s.records) >= 1024 {
		s.mu.Unlock()
		return nil, errLimit
	}
	c = &Capture{store: s, req: r, identity: token, snapshot: view, original: r.Body, active: true, hasher: sha256.New(), sha3Hasher: sha3.New512(), sha512Hasher: sha512.New()}
	c.self = c
	c.marker = &capturedMarker{c}
	s.records[token] = c
	s.children++
	r.Body = c.marker
	s.mu.Unlock()
	// From here c is retained in SAME request/store inventory before file, body
	// read or late-current failure. Return original partial, never nil-on-error.
	defer func() {
		c.mu.Lock()
		c.active = false
		if e != nil {
			e = c.fail(e)
		} else if c.unknown {
			e = errUnknown
		}
		c.mu.Unlock()
	}()
	var nonce [16]byte
	if _, e = rand.Read(nonce[:]); e != nil {
		return c, e
	}
	c.id = "capture_" + hex.EncodeToString(nonce[:])
	c.journal, e = openOwned(s.directory, c.id+".journal", true)
	if e != nil {
		return c, e
	}
	c.body, e = openOwned(s.directory, c.id+".body", true)
	if e != nil {
		return c, e
	}
	if e = appendFrame(c.journal, journalEntered{"YNX-LOCAL-BINARY-CAPTURE/v1", c.id, view.RequestDATA, view.ProofHeader, view.Host, view.URI, view.Length, view.Transfer}); e != nil {
		return c, e
	}
	if e = s.directory.parts[len(s.directory.parts)-1].sync(); e != nil {
		return c, e
	}
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-r.Context().Done():
			c.mu.Lock()
			c.aborted = true
			c.fail(errAborted)
			c.mu.Unlock()
			c.closeOriginal()
		case <-stop:
		}
	}()
	scratch := make([]byte, 64<<10)
	defer clear(scratch)
	if c.original != nil {
		for {
			c.mu.Lock()
			aborted := c.aborted
			c.mu.Unlock()
			if aborted {
				return c, errAborted
			}
			n, readError := c.original.Read(scratch)
			if n < 0 || n > len(scratch) {
				return c, errRequest
			}
			c.mu.Lock()
			aborted = c.aborted
			c.mu.Unlock()
			if aborted {
				return c, errAborted
			}
			if int64(n) > MaxCaptureResourceBytes-c.size {
				return c, errLimit
			}
			if n > 0 {
				if _, e = c.body.file.Write(scratch[:n]); e != nil {
					return c, e
				}
				_, _ = c.hasher.Write(scratch[:n])
				_, _ = c.sha3Hasher.Write(scratch[:n])
				_, _ = c.sha512Hasher.Write(scratch[:n])
				c.size += int64(n)
			}
			if readError == io.EOF {
				break
			}
			if readError != nil {
				return c, readError
			}
			if n == 0 {
				return c, io.ErrNoProgress
			}
		}
	}
	c.closeOriginal()
	if c.originalCloseError != nil {
		return c, c.originalCloseError
	}
	if view.Length >= 0 && view.Length != c.size {
		return c, errChanged
	}
	if c.size < 1 {
		return c, errRequest
	}
	copy(c.digest[:], c.hasher.Sum(nil))
	copy(c.sha3Digest[:], c.sha3Hasher.Sum(nil))
	copy(c.sha512Digest[:], c.sha512Hasher.Sum(nil))
	c.hasher = nil
	c.sha3Hasher = nil
	c.sha512Hasher = nil
	if e = c.body.file.Sync(); e != nil {
		return c, e
	}
	// Retire writer first. Reopen the SAME original inode read-only, never retain
	// a writable body handle as trusted input. Every later read rehashes bytes.
	if e = c.body.close(); e != nil {
		return c, e
	}
	before := c.body.original
	c.body, e = openOwned(s.directory, c.id+".body", false)
	if e != nil {
		return c, e
	}
	if !sameNode(&before, &c.body.original) {
		return c, errChanged
	}
	if e = appendFrame(c.journal, journalComplete{"CAPTURED", c.size, hex.EncodeToString(c.digest[:]), hex.EncodeToString(c.sha3Digest[:]), hex.EncodeToString(c.sha512Digest[:])}); e != nil {
		return c, e
	}
	if e = c.journal.close(); e != nil {
		return c, e
	}
	c.journal, e = openOwned(s.directory, c.id+".journal", false)
	if e != nil {
		return c, e
	}
	c.complete = true
	if e = c.checkOriginalLocked(r); e != nil {
		return c, e
	}
	return c, nil
}
func (p *directoryPart) sync() error { return unixFsync(p.fd) }
func (c *Capture) checkOriginalIdentityLocked(r *http.Request) error {
	if c.self != c {
		return errChanged
	}
	if c.recovered {
		return errRecovery
	}
	if c.closeCalled || c.aborted || c.unknown || !c.complete || r == nil || c.req != r || r.Body != c.marker {
		return errChanged
	}
	c.store.mu.Lock()
	parentClosed := c.store.closeCalled || c.store.cause != nil
	c.store.mu.Unlock()
	if parentClosed {
		return errClosed
	}
	now, e := snapshot(r)
	if e != nil {
		return e
	}
	old := c.snapshot
	if now.RequestDATA != old.RequestDATA || now.ProofHeader != old.ProofHeader || now.Host != old.Host || now.URI != old.URI || now.Length != old.Length || now.originalURL != old.originalURL || now.done != old.done || !equalStrings(now.Transfer, old.Transfer) {
		return errChanged
	}
	if e = c.body.current(c.store.directory); e != nil {
		return e
	}
	if e = c.journal.current(c.store.directory); e != nil {
		return e
	}
	return nil
}
func (c *Capture) checkOriginalLocked(r *http.Request) error {
	if e := c.checkOriginalIdentityLocked(r); e != nil {
		return e
	}
	h := sha256.New()
	h3, h512 := sha3.New512(), sha512.New()
	n, e := io.Copy(io.MultiWriter(h, h3, h512), io.NewSectionReader(c.body.file, 0, c.size+1))
	if e != nil {
		return e
	}
	if n != c.size || !bytes.Equal(h.Sum(nil), c.digest[:]) || !bytes.Equal(h3.Sum(nil), c.sha3Digest[:]) || !bytes.Equal(h512.Sum(nil), c.sha512Digest[:]) {
		return errChanged
	}
	return nil
}
func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func (c *Capture) CurrentOriginalRequest(r *http.Request) error {
	if c == nil {
		return errRequest
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.checkOriginalLocked(r); e != nil {
		return c.fail(e)
	}
	return nil
}
func (c *Capture) Abort() error {
	if c == nil {
		return nil
	}
	if c.self != c {
		return errChanged
	}
	c.mu.Lock()
	c.aborted = true
	c.fail(errAborted)
	active := c.active
	c.mu.Unlock()
	if active {
		c.closeOriginal()
	}
	return errUnknown
}
func (c *Capture) Close() error {
	if c == nil {
		return nil
	}
	if c.self != c {
		return errChanged
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closeCalled {
		return c.errorClose
	}
	c.closeCalled = true
	c.errorClose = c.drainLocked()
	return c.errorClose
}
func (c *Capture) DrainPartial() error {
	if c == nil {
		return nil
	}
	if c.self != c {
		return errChanged
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closeCalled {
		return errClosed
	}
	return c.drainLocked()
}
func (c *Capture) drainLocked() error {
	if c.drained {
		if c.unknown {
			return errUnknown
		}
		return nil
	}
	if c.active || c.borrowed {
		return errBorrowed
	}
	if c.verified != nil && c.verified.original != nil && !c.principalDrained {
		var drained bool
		var e error
		if !c.principalCloseCalled {
			c.principalCloseCalled = true
			drained, e = c.verified.original.closeOriginalBinaryRequestOnce()
		} else {
			drained, e = c.verified.original.drainOriginalBinaryRequestPartial()
		}
		c.principalDrained = drained
		if e != nil {
			c.fail(e)
		}
		if !drained {
			return c.fail(errBorrowed)
		}
	}
	c.closeOriginal()
	if c.originalCloseError != nil {
		return c.fail(c.originalCloseError)
	}
	if e := c.body.close(); e != nil {
		return c.fail(e)
	}
	if e := c.journal.close(); e != nil {
		return c.fail(e)
	}
	c.drained = true
	c.store.mu.Lock()
	c.store.children--
	if !c.recovered {
		c.store.records[c.identity] = nil
	}
	c.store.mu.Unlock()
	c.req = nil
	if c.unknown {
		return errUnknown
	}
	return nil
}

type CaptureFacts struct {
	Version                                                     string
	Request                                                     RequestDATA
	CaptureID                                                   string
	Bytes                                                       int64
	CapturedSHA256                                              string
	Complete, Unknown, RecoveryReadOnly, BorrowEntered, Drained bool
	Authority                                                   bool
	FirstCauseCode, FirstCloseCode                              string
}

func safeCode(e error) string {
	if e == nil {
		return ""
	}
	for _, known := range []error{errDirectory, errChanged, errRequest, errDuplicate, errLimit, errUnknown, errAborted, errBorrowed, errClosed, errRecovery, errNotSupplied} {
		if e == known {
			return known.Error()
		}
	}
	return "BINARY_CAPTURE_PRIVATE_IO_CAUSE_RETAINED"
}
func (c *Capture) Facts() CaptureFacts {
	if c == nil {
		return CaptureFacts{Authority: false}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return CaptureFacts{"YNX-LOCAL-BINARY-CAPTURE-FACTS/v1", c.snapshot.RequestDATA, c.id, c.size, hex.EncodeToString(c.digest[:]), c.complete, c.unknown, c.recovered, c.borrowEntered, c.drained, false, safeCode(c.cause), safeCode(c.errorClose)}
}
func (c *Capture) GoString() string { return c.String() }
func (s *Store) GoString() string   { return s.String() }

var _ fmt.GoStringer = (*Capture)(nil)
