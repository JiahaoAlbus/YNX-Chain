//go:build pay_pq

package paynativesource

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"golang.org/x/sys/unix"
)

type originalPayRelease struct {
	directory, nodeImage, verifierImage, runtimeManifest         string
	nodeSHA, verifierSHA, manifestSHA                            string
	rootSHA, enrollmentSHA, profileSHA, headSHA                  string
	endpoint, spki, nodeOrigin, nodeSPKI, nativeChainID, purpose string
	platform                                                     string
	engine                                                       OriginalPayEngine
	enrollmentFrame, profileFrame, currentFrame                  string
	genesis                                                      []byte
	nativeID                                                     uint64
	// Selection key/value schema remains sole SDK's contract. No fallback to
	// Cloud Principal/old V4 GET, or acceptance of unknown-purpose projection.
	selectionKey                       string
	sourceID, productID, applicationID string
}

// Only original Root/A commissioning may supply a reviewed genuine tuple;
// there is no setter, ENV/config/provider or public admission constructor.
func originalPayReleases() []originalPayRelease { return nil }

var errOriginalPayPlatformRequired = errors.New("PAY_ORIGINAL_PLATFORM_NOT_SUPPLIED")
var errOriginalPayPlatformInvalid = errors.New("PAY_ORIGINAL_PLATFORM_INVALID")

// This is the explicit original Pay release policy value, not GOOS inference,
// a client/header field, a default Linux claim or an old macOS enrollment.
func requireOriginalPayPlatform(platform string) error {
	if platform == "" {
		return errOriginalPayPlatformRequired
	}
	switch platform {
	case "linux", "macos", "windows":
		return nil
	}
	return errOriginalPayPlatformInvalid
}

type heldPayFile struct {
	file *os.File
	info os.FileInfo
	path string
}
type originalPayCommissioning struct {
	mu              sync.Mutex
	files           []heldPayFile
	directories     []heldPayFile
	until           time.Time
	first           error
	closeSelected   bool
	closeFirst      error
	physicalClosed  bool
	ancestors       map[string]os.FileInfo
	wallFloor       int64
	monotonicAnchor time.Time
	wallAnchor      int64
}

func payMetadata(s os.FileInfo) string {
	v := reflect.ValueOf(s.Sys())
	if v.Kind() == reflect.Pointer {
		v = v.Elem()
	}
	out := ""
	for _, n := range []string{"Uid", "Gid", "Nlink", "Ctimespec", "Ctim"} {
		f := v.FieldByName(n)
		if f.IsValid() {
			out += fmt.Sprint(f.Interface()) + "|"
		}
	}
	return out
}

func (c *originalPayCommissioning) current() error {
	if c == nil {
		return ErrNotSupplied
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.first != nil {
		return c.first
	}
	now := time.Now()
	wall := now.UnixMilli()
	if !c.monotonicAnchor.IsZero() {
		logical := c.wallAnchor + time.Since(c.monotonicAnchor).Milliseconds()
		if logical >= c.until.UnixMilli() || wall < c.wallFloor {
			c.first = ErrDenied
			return c.first
		}
	}
	c.wallFloor = wall
	if c.closeSelected || !now.Before(c.until) {
		c.first = ErrDenied
		return c.first
	}
	for _, f := range c.files {
		a, e := f.file.Stat()
		b, be := os.Lstat(f.path)
		if e != nil || be != nil || !os.SameFile(a, f.info) || !os.SameFile(b, f.info) || a.Size() != f.info.Size() || a.ModTime() != f.info.ModTime() || a.Mode() != f.info.Mode() || payMetadata(a) != payMetadata(f.info) {
			c.first = ErrDenied
			return c.first
		}
	}
	for path, original := range c.ancestors {
		s, e := os.Lstat(path)
		if e != nil || !os.SameFile(s, original) || s.Mode() != original.Mode() || s.Mode()&os.ModeSymlink != 0 || s.Mode().Perm()&0022 != 0 || payMetadata(s) != payMetadata(original) {
			c.first = ErrDenied
			return c.first
		}
	}
	for _, held := range c.directories {
		s, e := held.file.Stat()
		if e != nil || !os.SameFile(s, held.info) || s.Mode() != held.info.Mode() || payMetadata(s) != payMetadata(held.info) {
			c.first = ErrDenied
			return c.first
		}
	}
	return nil
}
func (c *originalPayCommissioning) close() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closeSelected {
		return c.closeFirst
	}
	c.closeSelected = true
	for _, f := range c.files {
		if e := f.file.Close(); e != nil && c.closeFirst == nil {
			c.closeFirst = e
		}
	}
	for _, f := range c.directories {
		if e := f.file.Close(); e != nil && c.closeFirst == nil {
			c.closeFirst = e
		}
	}
	c.physicalClosed = c.closeFirst == nil
	return c.closeFirst
}
func (c *originalPayCommissioning) closed() bool {
	if c == nil {
		return true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.physicalClosed
}
func (c *originalPayCommissioning) hold(path, digest string, max int64) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || len(digest) != 64 {
		return nil, ErrDenied
	}
	// Open every component relative to its held parent. A lstat followed by
	// opening the full pathname would leave a parent-symlink race.
	parts := strings.Split(strings.TrimPrefix(path, string(filepath.Separator)), string(filepath.Separator))
	p := string(filepath.Separator)
	fd, e := unix.Open(p, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_DIRECTORY, 0)
	if e != nil {
		return nil, e
	}
	for index := 0; ; index++ {
		dir := os.NewFile(uintptr(fd), p)
		s, se := dir.Stat()
		// Adopt before validation so factory partial always owns the drain.
		c.directories = append(c.directories, heldPayFile{dir, s, p})
		if se != nil || !s.IsDir() || s.Mode().Perm()&0022 != 0 {
			return nil, ErrDenied
		}
		stat, ok := s.Sys().(*syscall.Stat_t)
		if !ok || (stat.Uid != 0 && stat.Uid != uint32(os.Getuid())) {
			return nil, ErrDenied
		}
		if c.ancestors == nil {
			c.ancestors = make(map[string]os.FileInfo)
		}
		if original, exists := c.ancestors[p]; exists && !os.SameFile(s, original) {
			return nil, ErrDenied
		}
		c.ancestors[p] = s
		if index == len(parts)-1 {
			break
		}
		next, ne := unix.Openat(fd, parts[index], unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_DIRECTORY, 0)
		if ne != nil {
			return nil, ne
		}
		fd, p = next, filepath.Join(p, parts[index])
	}
	fd, e = unix.Openat(fd, parts[len(parts)-1], unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if e != nil {
		return nil, e
	}
	f := os.NewFile(uintptr(fd), path)
	s, e := f.Stat()
	if e != nil || !s.Mode().IsRegular() || s.Mode().Perm()&0022 != 0 || s.Size() <= 0 || s.Size() > max {
		_ = f.Close()
		return nil, ErrDenied
	}
	stat, ok := s.Sys().(*syscall.Stat_t)
	if !ok || stat.Nlink != 1 || (stat.Uid != 0 && stat.Uid != uint32(os.Getuid())) {
		_ = f.Close()
		return nil, ErrDenied
	}
	c.files = append(c.files, heldPayFile{f, s, path}) // adopt before read/hash/error
	b, e := io.ReadAll(io.LimitReader(f, max+1))
	if e != nil || int64(len(b)) != s.Size() {
		return nil, ErrDenied
	}
	h := sha256.Sum256(b)
	if hex.EncodeToString(h[:]) != digest {
		return nil, ErrDenied
	}
	return b, nil
}

// NewOriginalNativePaySource is the normal Auth factory. A nonnull owner is
// returned before any error. Resource pointers do not manufacture Source or
// caller permission, and typed parents are never closed by this child.
func NewOriginalNativePaySource(resources OriginalNativePayResources) (*Owner, error) {
	o := &Owner{active: make(map[*securelink.LocalCaller]*requestLease)}
	engine, e := selectOriginalPayEngine(resources)
	if e != nil {
		o.first = e
		return o, e
	}
	releases := originalPayReleases()
	if len(releases) != 1 {
		o.first = ErrNotSupplied
		return o, o.first
	}
	if resources.PayStore == nil || resources.CloudBills == nil {
		o.first = errors.New("PAY_ORIGINAL_TYPED_PARENT_RESOURCES_NOT_SUPPLIED")
		return o, o.first
	}
	r := releases[0]
	if r.engine != engine.engine {
		o.first = ErrPayEngineResources
		return o, o.first
	}
	lease := &originalPayCommissioning{}
	o.commissioning = lease
	profile, selection, e := lease.readOriginalSDK(r)
	if e != nil {
		o.first = e
		return o, e
	}
	runtime, e := assembleOriginalPayRuntime(resources, r, profile, selection, lease)
	if e != nil {
		o.first = e
		return o, e
	}
	o.runtime = runtime
	return o, nil
}

// Actual Source-v2 SDK private runner protocol, not a public callback. The
// independently admitted complete runtime must include the Pay family codec;
// an older verifier's unknown-purpose rejection is preserved, never bypassed.
func (c *originalPayCommissioning) readOriginalSDK(r originalPayRelease) (map[string]json.RawMessage, json.RawMessage, error) {
	var empty map[string]json.RawMessage
	if e := requireOriginalPayFamily(r); e != nil {
		return nil, nil, e
	}
	if e := requireOriginalPayPlatform(r.platform); e != nil {
		return nil, nil, e
	}
	if len(r.genesis) != 32 || r.nativeID == 0 || r.purpose == "" || r.selectionKey == "" || r.nodeOrigin == "" || r.nodeSPKI == "" {
		return nil, nil, ErrNotSupplied
	}
	root, e := c.hold(filepath.Join(r.directory, "root.original"), r.rootSHA, 16384)
	if e != nil {
		return nil, nil, e
	}
	enrollment, e := c.hold(filepath.Join(r.directory, "enrollment.original"), r.enrollmentSHA, 393216)
	if e != nil {
		return nil, nil, e
	}
	profile, e := c.hold(filepath.Join(r.directory, "profile.original"), r.profileSHA, 393216)
	if e != nil {
		return nil, nil, e
	}
	head, e := c.hold(filepath.Join(r.directory, "head.original"), r.headSHA, 393216)
	if e != nil {
		return nil, nil, e
	}
	projection, e := c.runOriginalSDK(r, root, enrollment, profile, head)
	if e != nil {
		return empty, nil, e
	}
	return projection, projection["selection"], nil
}
