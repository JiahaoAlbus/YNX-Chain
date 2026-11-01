// Package nativeconsent invokes one pinned native visible-decision producer.
// Its decision is local consent for an exact node intent, never publisher,
// account, validator, signer, reward or Root authority.
package nativeconsent

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

const Version = "YNX-NETWORK-NATIVE-CONSENT/v1"
const executableName = "ynx-network-native-consent"

var ErrUnavailable = errors.New("native visible consent producer unavailable")
var ErrCancelled = errors.New("native visible consent cancelled")
var ErrInvalid = errors.New("native consent identity or response changed")
var ErrBusy = errors.New("native visible consent already in progress")

type Packet struct {
	Version        string `json:"version"`
	RequestID      string `json:"requestId"`
	PayloadSHA256  string `json:"payloadSHA256"`
	Action         string `json:"action"`
	NodeID         string `json:"nodeId"`
	ArtifactSHA256 string `json:"artifactSHA256"`
	Generation     string `json:"generation"`
	Mode           string `json:"mode"`
	ExpiresAtUTC   string `json:"expiresAtUTC"`
}
type response struct {
	Version       string `json:"version"`
	RequestID     string `json:"requestId"`
	PayloadSHA256 string `json:"payloadSHA256"`
	Decision      string `json:"decision"`
}
type identity struct {
	info os.FileInfo
	pin  [32]byte
}
type Producer struct {
	mu                                       sync.Mutex
	path, captured, directory, locale, theme string
	source, capture                          identity
	dirInfo                                  os.FileInfo
	active                                   bool
	closed                                   bool
	cancel                                   context.CancelFunc
	done                                     chan struct{}
}

func Locale(value string) bool {
	for _, v := range []string{"en", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"} {
		if value == v {
			return true
		}
	}
	return false
}
func Theme(value string) bool { return value == "light" || value == "dark" || value == "system" }
func digest(value string) bool {
	b, err := hex.DecodeString(value)
	return err == nil && len(b) == 32 && hex.EncodeToString(b) == value
}
func inspect(path string, expected *identity, pin [32]byte) ([]byte, os.FileInfo, error) {
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm()&0022 != 0 || before.Mode().Perm()&0111 == 0 || before.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 || before.Size() <= 0 || before.Size() > 64<<20 || !owned(before) {
		return nil, nil, ErrInvalid
	}
	same := func(a, b os.FileInfo) bool {
		return os.SameFile(a, b) && a.Mode() == b.Mode() && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
	}
	if expected != nil && !same(before, expected.info) {
		return nil, nil, ErrInvalid
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, ErrInvalid
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !same(before, opened) {
		return nil, nil, ErrInvalid
	}
	raw, err := io.ReadAll(io.LimitReader(f, 64<<20+1))
	after, e := f.Stat()
	named, n := os.Lstat(path)
	if err != nil || e != nil || n != nil || !same(opened, after) || !same(after, named) || int64(len(raw)) != before.Size() || sha256.Sum256(raw) != pin {
		return nil, nil, ErrInvalid
	}
	return raw, before, nil
}

// New captures the fixed original native producer, not a caller-selected prompt
// program or JSON command. The independent pin is supplied by the QA builder.
func New(path, pin, locale, theme string) (*Producer, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Base(path) != executableName || !digest(pin) || !Locale(locale) || !Theme(theme) {
		return nil, ErrUnavailable
	}
	physical, err := filepath.EvalSymlinks(path)
	if err != nil || physical != path {
		return nil, ErrUnavailable
	}
	var hash [32]byte
	decoded, _ := hex.DecodeString(pin)
	copy(hash[:], decoded)
	raw, info, err := inspect(path, nil, hash)
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "ynx-network-native-consent-")
	if err != nil {
		return nil, err
	}
	dir, err = filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, err
	}
	dirInfo, err := os.Lstat(dir)
	if err != nil {
		return nil, err
	}
	p := &Producer{path: path, directory: dir, dirInfo: dirInfo, locale: locale, theme: theme, source: identity{info, hash}, captured: filepath.Join(dir, executableName)}
	f, err := os.OpenFile(p.captured, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0500)
	if err != nil {
		return nil, err
	}
	created, e := f.Stat()
	if e != nil {
		_ = f.Close()
		return nil, e
	}
	p.capture = identity{created, hash}
	_, writeErr := f.Write(raw)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
		return nil, err
	} // preserve incomplete own bytes for reconciliation
	_, captured, err := inspect(p.captured, nil, hash)
	if err != nil {
		return nil, err
	}
	p.capture.info = captured
	if _, _, err = inspect(path, &p.source, hash); err != nil {
		_ = p.Close()
		return nil, err
	}
	return p, nil
}

type capped struct {
	bytes.Buffer
	limit    int
	cancel   context.CancelFunc
	exceeded bool
}

func (w *capped) Write(b []byte) (int, error) {
	if len(b) > w.limit-w.Len() {
		w.exceeded = true
		w.cancel()
		return 0, ErrInvalid
	}
	return w.Buffer.Write(b)
}

// Confirm returns nil only after the exact pinned child reports an approved
// visible decision for this fresh challenge and original intent hash. Tests of
// the process protocol are not evidence that a person actually clicked a UI.
func (p *Producer) Confirm(ctx context.Context, intent ownednode.Intent, mode string) error {
	if ctx == nil || intent.NodeID != ownednode.NodeID || !digest(intent.ArtifactSHA256) || (intent.Action != "install" && intent.Action != "start" && intent.Action != "stop") || (mode != "production" && mode != "isolated-lifecycle-fixture") {
		return ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	deadline := time.Now().Add(60 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	// Whole UTC seconds are shared with the Cocoa parser, never rounded up.
	deadline = deadline.Truncate(time.Second)
	if !deadline.After(time.Now()) {
		return context.DeadlineExceeded
	}
	call, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return ErrUnavailable
	}
	if p.active {
		p.mu.Unlock()
		return ErrBusy
	}
	p.active = true
	p.cancel = cancel
	p.done = make(chan struct{})
	done := p.done
	p.mu.Unlock()
	defer func() { p.mu.Lock(); p.active = false; p.cancel = nil; close(done); p.mu.Unlock() }()
	if _, _, err := inspect(p.path, &p.source, p.source.pin); err != nil {
		return err
	}
	if _, _, err := inspect(p.captured, &p.capture, p.capture.pin); err != nil {
		return err
	}
	nonce := make([]byte, 24)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	packet := Packet{Version, hex.EncodeToString(nonce), intent.SHA256(), intent.Action, intent.NodeID, intent.ArtifactSHA256, strconv.FormatUint(intent.Generation, 10), mode, deadline.UTC().Format("2006-01-02T15:04:05Z")}
	raw, _ := json.Marshal(packet)
	output := &capped{limit: 2048, cancel: cancel}
	stderr := &capped{limit: 1024, cancel: cancel}
	command := exec.CommandContext(call, p.captured, "--native-consent")
	command.Dir = p.directory
	command.Env = []string{"LC_ALL=C", "YNX_NETWORK_NATIVE_LOCALE=" + p.locale, "YNX_NETWORK_NATIVE_THEME=" + p.theme}
	command.Stdin = bytes.NewReader(raw)
	command.Stdout = output
	command.Stderr = stderr
	command.WaitDelay = 250 * time.Millisecond
	err := command.Run() // Run always waits for the owned child and its pipes.
	if _, _, e := inspect(p.path, &p.source, p.source.pin); e != nil {
		return e
	}
	if _, _, e := inspect(p.captured, &p.capture, p.capture.pin); e != nil {
		return e
	}
	if call.Err() != nil {
		return call.Err()
	}
	if err != nil || stderr.Len() != 0 || output.exceeded || stderr.exceeded {
		return ErrInvalid
	}
	var result response
	dec := json.NewDecoder(bytes.NewReader(output.Bytes()))
	dec.DisallowUnknownFields()
	if dec.Decode(&result) != nil || dec.Decode(new(any)) != io.EOF || result.Version != Version || result.RequestID != packet.RequestID || result.PayloadSHA256 != packet.PayloadSHA256 {
		return ErrInvalid
	}
	if !time.Now().Before(deadline) {
		return context.DeadlineExceeded
	}
	switch result.Decision {
	case "approved":
		return nil
	case "cancelled":
		return ErrCancelled
	default:
		return ErrInvalid
	}
}

// Close waits for only its owned prompt and removes only the original captured
// file and empty original private directory. Unknown files are preserved.
func (p *Producer) Close() error {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	p.closed = true
	cancel, done := p.cancel, p.done
	active := p.active
	p.mu.Unlock()
	if active {
		cancel()
		<-done
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.directory == "" {
		return nil
	}
	info, err := os.Lstat(p.directory)
	if err != nil || !os.SameFile(info, p.dirInfo) || !info.IsDir() || info.Mode() != p.dirInfo.Mode() || info.Mode().Perm() != 0700 || !owned(info) {
		return ErrInvalid
	}
	dir, err := os.Open(p.directory)
	if err != nil {
		return err
	}
	defer dir.Close()
	opened, err := dir.Stat()
	if err != nil || !os.SameFile(opened, p.dirInfo) {
		return ErrInvalid
	}
	entries, err := dir.ReadDir(-1)
	if err != nil || len(entries) != 1 || entries[0].Name() != executableName {
		return fmt.Errorf("%w: unknown native producer capture preserved", ErrInvalid)
	}
	if _, _, err = inspect(p.captured, &p.capture, p.capture.pin); err != nil {
		return err
	}
	info, err = os.Lstat(p.directory)
	if err != nil || !os.SameFile(info, p.dirInfo) {
		return ErrInvalid
	}
	if err = unlink(dir); err != nil {
		return err
	}
	if err = os.Remove(p.directory); err != nil {
		return err
	}
	p.directory = ""
	return nil
}
