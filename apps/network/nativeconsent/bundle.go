package nativeconsent

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"time"
)

const BundleName = "YNX Network Consent.app"
const IdentityVersion = "YNX-NETWORK-NATIVE-CONSENT-IDENTITY/v1"

var bundleIdentifier = regexp.MustCompile(`^dev\.ynx\.network\.consent\.qa\.h[0-9a-f]{16}$`)

type directoryIdentity struct {
	path string
	info os.FileInfo
}
type bundleCapture struct {
	id, sourceInfoPath, infoPath string
	sourceInfo, capturedInfo     identity
	dirs                         []directoryIdentity
}
type Identity struct {
	Version          string `json:"version"`
	BundleIdentifier string `json:"bundleIdentifier"`
	Executable       string `json:"executable"`
	Authority        bool   `json:"authority"`
}

func infoIdentifier(raw []byte) (string, error) {
	var doc struct {
		XMLName xml.Name `xml:"plist"`
		Dict    struct {
			Items []struct {
				XMLName  xml.Name
				Text     string                       `xml:",chardata"`
				Children []struct{ XMLName xml.Name } `xml:",any"`
			} `xml:",any"`
		} `xml:"dict"`
	}
	if xml.Unmarshal(raw, &doc) != nil || doc.XMLName.Local != "plist" || len(doc.Dict.Items)%2 != 0 {
		return "", ErrInvalid
	}
	values := map[string]string{}
	for i := 0; i < len(doc.Dict.Items); i += 2 {
		key, value := doc.Dict.Items[i], doc.Dict.Items[i+1]
		if key.XMLName.Space != "" || key.XMLName.Local != "key" || len(key.Children) != 0 || len(value.Children) != 0 || value.XMLName.Space != "" {
			return "", ErrInvalid
		}
		if _, exists := values[key.Text]; exists {
			return "", ErrInvalid
		}
		boolean := key.Text == "NSHighResolutionCapable" || key.Text == "LSUIElement"
		if boolean && value.XMLName.Local != "true" && value.XMLName.Local != "false" || !boolean && value.XMLName.Local != "string" {
			return "", ErrInvalid
		}
		switch value.XMLName.Local {
		case "string":
			values[key.Text] = value.Text
		case "true":
			if value.Text != "" {
				return "", ErrInvalid
			}
			values[key.Text] = "true"
		case "false":
			if value.Text != "" {
				return "", ErrInvalid
			}
			values[key.Text] = "false"
		default:
			return "", ErrInvalid
		}
	}
	required := map[string]string{"CFBundleExecutable": executableName, "CFBundlePackageType": "APPL", "CFBundleName": "YNX Network Consent", "CFBundleDisplayName": "YNX Network Consent", "CFBundleVersion": "0.3", "CFBundleShortVersionString": "0.3", "LSMinimumSystemVersion": "12.0", "NSHighResolutionCapable": "true", "NSPrincipalClass": "NSApplication", "LSUIElement": "false"}
	if len(values) != len(required)+1 || !bundleIdentifier.MatchString(values["CFBundleIdentifier"]) {
		return "", ErrInvalid
	}
	for key, value := range required {
		if values[key] != value {
			return "", ErrInvalid
		}
	}
	return values["CFBundleIdentifier"], nil
}

// NewBundled preserves the fixed producer's native application identity in its
// private capture. Executable and original Info.plist pins are independent build
// inputs. This is a local QA binding, not OS publisher or Root authentication.
func NewBundled(path, pin, infoPin, locale, theme string) (*Producer, error) {
	if !digest(infoPin) || filepath.Base(filepath.Dir(path)) != "MacOS" || filepath.Base(filepath.Dir(filepath.Dir(path))) != "Contents" || filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(path)))) != BundleName {
		return nil, ErrUnavailable
	}
	infoPath := filepath.Join(filepath.Dir(filepath.Dir(path)), "Info.plist")
	var hash [32]byte
	decoded, _ := hex.DecodeString(infoPin)
	copy(hash[:], decoded)
	raw, info, err := inspectBound(infoPath, nil, hash, false, 16<<10)
	if err != nil {
		return nil, err
	}
	id, err := infoIdentifier(raw)
	if err != nil {
		return nil, err
	}
	p, err := New(path, pin, locale, theme)
	if err != nil {
		return nil, err
	}
	b := &bundleCapture{id: id, sourceInfoPath: infoPath, sourceInfo: identity{info, hash}}
	// Construct only these known private directories. A failed construction is
	// preserved for reconciliation, never recursively deleted or silently reused.
	for _, relative := range []string{BundleName, filepath.Join(BundleName, "Contents"), filepath.Join(BundleName, "Contents", "MacOS")} {
		dir := filepath.Join(p.directory, relative)
		if err = os.Mkdir(dir, 0700); err != nil {
			return nil, err
		}
		st, e := os.Lstat(dir)
		if e != nil {
			return nil, e
		}
		b.dirs = append(b.dirs, directoryIdentity{dir, st})
	}
	b.infoPath = filepath.Join(b.dirs[1].path, "Info.plist")
	f, err := os.OpenFile(b.infoPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	_, writeErr := f.Write(raw)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
		return nil, err
	}
	_, captured, e := inspectBound(b.infoPath, nil, hash, false, 16<<10)
	if e != nil {
		return nil, e
	}
	b.capturedInfo = identity{captured, hash}
	destination := filepath.Join(b.dirs[2].path, executableName)
	if err = os.Rename(p.captured, destination); err != nil {
		return nil, err
	}
	p.captured = destination
	p.bundle = b
	if err = p.verifyBundle(true); err != nil {
		return nil, err
	}
	return p, nil
}
func sameDirectory(path string, expected os.FileInfo) error {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || !os.SameFile(info, expected) || info.Mode() != expected.Mode() || info.Mode().Perm() != 0700 || !owned(info) {
		return ErrInvalid
	}
	return nil
}
func (p *Producer) verifyBundle(source bool) error {
	if p.bundle == nil {
		return nil
	}
	b := p.bundle
	if err := sameDirectory(p.directory, p.dirInfo); err != nil {
		return err
	}
	for _, dir := range b.dirs {
		if err := sameDirectory(dir.path, dir.info); err != nil {
			return err
		}
	}
	if source {
		if _, _, err := inspectBound(b.sourceInfoPath, &b.sourceInfo, b.sourceInfo.pin, false, 16<<10); err != nil {
			return err
		}
	}
	_, _, err := inspectBound(b.infoPath, &b.capturedInfo, b.capturedInfo.pin, false, 16<<10)
	return err
}

// ReadIdentity executes only the fixed read-only --identity mode and verifies
// the actual Cocoa main bundle. It never creates NSApplication or a prompt.
func (p *Producer) ReadIdentity(ctx context.Context) (Identity, error) {
	var result Identity
	if ctx == nil || p.bundle == nil {
		return result, ErrUnavailable
	}
	call, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return result, ErrUnavailable
	}
	if p.active {
		p.mu.Unlock()
		return result, ErrBusy
	}
	p.active = true
	p.cancel = cancel
	p.done = make(chan struct{})
	done := p.done
	p.mu.Unlock()
	defer func() { p.mu.Lock(); p.active = false; p.cancel = nil; close(done); p.mu.Unlock() }()
	if err := p.verifyBundle(true); err != nil {
		return result, err
	}
	if _, _, err := inspect(p.path, &p.source, p.source.pin); err != nil {
		return result, err
	}
	if _, _, err := inspect(p.captured, &p.capture, p.capture.pin); err != nil {
		return result, err
	}
	output := &capped{limit: 2048, cancel: cancel}
	stderr := &capped{limit: 1024, cancel: cancel}
	command := exec.CommandContext(call, p.captured, "--identity")
	command.Dir = p.directory
	command.Env = []string{"LC_ALL=C"}
	command.Stdout = output
	command.Stderr = stderr
	command.WaitDelay = 250 * time.Millisecond
	err := command.Run()
	if e := p.verifyBundle(true); e != nil {
		return result, e
	}
	if _, _, e := inspect(p.path, &p.source, p.source.pin); e != nil {
		return result, e
	}
	if _, _, e := inspect(p.captured, &p.capture, p.capture.pin); e != nil {
		return result, e
	}
	if output.exceeded || stderr.exceeded {
		return result, ErrInvalid
	}
	if call.Err() != nil {
		return result, call.Err()
	}
	if err != nil || stderr.Len() != 0 {
		return result, ErrInvalid
	}
	dec := json.NewDecoder(bytes.NewReader(output.Bytes()))
	dec.DisallowUnknownFields()
	if dec.Decode(&result) != nil || dec.Decode(new(any)) != io.EOF || result.Version != IdentityVersion || result.BundleIdentifier != p.bundle.id || result.Executable != executableName || result.Authority {
		return Identity{}, ErrInvalid
	}
	return result, nil
}
func exactEntries(dir string, names ...string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	actual := make([]string, len(entries))
	for i, item := range entries {
		actual[i] = item.Name()
	}
	sort.Strings(actual)
	sort.Strings(names)
	if len(actual) != len(names) {
		return ErrInvalid
	}
	for i := range actual {
		if actual[i] != names[i] {
			return ErrInvalid
		}
	}
	return nil
}
func (p *Producer) closeBundle() error {
	b := p.bundle
	if err := p.verifyBundle(false); err != nil {
		return err
	}
	if _, _, err := inspect(p.captured, &p.capture, p.capture.pin); err != nil {
		return err
	}
	checks := []struct {
		path  string
		names []string
	}{{p.directory, []string{BundleName}}, {b.dirs[0].path, []string{"Contents"}}, {b.dirs[1].path, []string{"Info.plist", "MacOS"}}, {b.dirs[2].path, []string{executableName}}}
	for _, check := range checks {
		if err := exactEntries(check.path, check.names...); err != nil {
			return err
		}
	}
	mac, err := os.Open(b.dirs[2].path)
	if err != nil {
		return err
	}
	defer mac.Close()
	st, err := mac.Stat()
	if err != nil || !os.SameFile(st, b.dirs[2].info) {
		return ErrInvalid
	}
	contents, err := os.Open(b.dirs[1].path)
	if err != nil {
		return err
	}
	defer contents.Close()
	st, err = contents.Stat()
	if err != nil || !os.SameFile(st, b.dirs[1].info) {
		return ErrInvalid
	}
	if err = p.verifyBundle(false); err != nil {
		return err
	}
	if _, _, err = inspect(p.captured, &p.capture, p.capture.pin); err != nil {
		return err
	}
	if err = unlink(mac); err != nil {
		return err
	}
	if err = unlinkInfo(contents); err != nil {
		return err
	}
	for i := len(b.dirs) - 1; i >= 0; i-- {
		dir := b.dirs[i]
		if err = sameDirectory(dir.path, dir.info); err != nil {
			return err
		}
		if err = os.Remove(dir.path); err != nil {
			return err
		}
	}
	if err = sameDirectory(p.directory, p.dirInfo); err != nil {
		return err
	}
	if err = os.Remove(p.directory); err != nil {
		return err
	}
	p.directory = ""
	return nil
}
