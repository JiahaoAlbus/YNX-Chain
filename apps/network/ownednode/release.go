package ownednode

import (
	"bytes"
	"context"
	"crypto/sha256"
	"debug/elf"
	"debug/macho"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

// RuntimeManifestVersion is Network's public intake metadata, not an original
// CORE signed envelope, publisher registration, runtime ABI or Source grant.
const RuntimeManifestVersion = "YNX-NETWORK-ORDINARY-RUNTIME-INTAKE/v1"

var ErrRuntimeManifest = errors.New("invalid or incompatible ordinary runtime intake metadata")

type RuntimeNetwork struct {
	NetworkID32         string `json:"networkId32"`
	NativeChainID       string `json:"nativeChainId"`
	NativeGenesisSHA256 string `json:"nativeGenesisSHA256"`
	CometChainID        string `json:"cometChainId"`
	CometGenesisSHA256  string `json:"cometGenesisSHA256"`
}
type RuntimeManifest struct {
	Version                string         `json:"version"`
	ReleaseVersion         string         `json:"releaseVersion"`
	OS                     string         `json:"os"`
	Arch                   string         `json:"arch"`
	ManagedFilename        string         `json:"managedFilename"`
	ArtifactBytes          string         `json:"artifactBytes"`
	ArtifactSHA256         string         `json:"artifactSHA256"`
	SourceRevision         string         `json:"sourceRevision"`
	SourceRepository       string         `json:"sourceRepository"`
	ArtifactSource         string         `json:"artifactSource"`
	OriginalManifestSHA256 string         `json:"originalManifestSHA256"`
	RuntimeContractSHA256  string         `json:"runtimeContractSHA256"`
	Role                   string         `json:"role"`
	BlockProduction        bool           `json:"blockProduction"`
	Validator              bool           `json:"validator"`
	Signer                 bool           `json:"signer"`
	ValidatorKeys          bool           `json:"validatorKeys"`
	Network                RuntimeNetwork `json:"network"`
}
type RuntimeCandidateView struct {
	Code                    string          `json:"code"`
	ManifestSHA256          string          `json:"manifestSHA256"`
	Manifest                RuntimeManifest `json:"manifest"`
	Authority               bool            `json:"authority"`
	OriginalReleaseAdmitted bool            `json:"originalReleaseAdmitted"`
}

// RuntimeCandidate owns detached public bytes. Successful construction proves
// syntax/platform/identity/digest consistency only; it cannot enable execution.
type RuntimeCandidate struct {
	manifest                     RuntimeManifest
	manifestRaw, executableRaw   []byte
	manifestPath, executablePath string
	manifestInfo, executableInfo os.FileInfo
	manifestPin                  string
}

type runtimeInstallRecord struct {
	ManifestSHA256   string `json:"manifestSHA256"`
	ManifestOriginal []byte `json:"manifestOriginal"`
}
type InstalledRuntime struct {
	Code                    string          `json:"code"`
	ManifestSHA256          string          `json:"manifestSHA256"`
	ManifestOriginal        []byte          `json:"manifestOriginal"`
	Manifest                RuntimeManifest `json:"manifest"`
	Authority               bool            `json:"authority"`
	OriginalReleaseAdmitted bool            `json:"originalReleaseAdmitted"`
}

func (m *Manager) installedRuntime() (InstalledRuntime, error) {
	if m.state.Runtime == nil {
		return InstalledRuntime{Code: "NOT_SUPPLIED"}, nil
	}
	r := m.state.Runtime
	sum := sha256.Sum256(r.ManifestOriginal)
	var manifest RuntimeManifest
	if len(r.ManifestOriginal) > 16<<10 || hex.EncodeToString(sum[:]) != r.ManifestSHA256 || strictRecord(r.ManifestOriginal, &manifest) != nil || validateRuntimeManifest(manifest) != nil || manifest.ArtifactSHA256 != m.state.ArtifactSHA256 {
		return InstalledRuntime{}, ErrRuntimeManifest
	}
	code := "PUBLIC_BYTES_CHECKED_NO_AUTHORITY"
	if m.fixture {
		code = "ISOLATED_LIFECYCLE_FIXTURE"
	}
	return InstalledRuntime{Code: code, ManifestSHA256: r.ManifestSHA256, ManifestOriginal: append([]byte(nil), r.ManifestOriginal...), Manifest: manifest}, nil
}

// InstalledRuntimeReadback preserves exact intake metadata bytes and the
// original node binding. It does not turn metadata into an original signature.
func (m *Manager) InstalledRuntimeReadback(peer localipc.Peer) (InstalledRuntime, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.peerAllowed(peer); err != nil {
		return InstalledRuntime{}, err
	}
	if m.closed {
		return InstalledRuntime{}, ErrClosed
	}
	if err := m.rootUnchanged(); err != nil {
		return InstalledRuntime{}, err
	}
	if _, _, err := m.artifact(); err != nil {
		return InstalledRuntime{}, err
	}
	return m.installedRuntime()
}

// InstallConfiguredFixture exercises the shared exact-byte installer with a
// checked public candidate, while retaining the explicit fixture mode. There
// is no mock production issuer or factory which upgrades these bytes to trust.
func (m *Manager) InstallConfiguredFixture(ctx context.Context, peer localipc.Peer, intent Intent, approval *Approval) error {
	if ctx == nil {
		return ErrConsent
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.fixture {
		return ErrOriginalReleaseMissing
	}
	if m.runtime == nil {
		return ErrRuntimeManifest
	}
	if err := m.runtime.unchanged(); err != nil {
		return err
	}
	if intent.ArtifactSHA256 != m.runtime.manifest.ArtifactSHA256 {
		return ErrConsent
	}
	record := &runtimeInstallRecord{ManifestSHA256: m.runtime.manifestPin, ManifestOriginal: append([]byte(nil), m.runtime.manifestRaw...)}
	return m.installArtifactLocked(ctx, peer, intent, approval, m.runtime.executableRaw, record)
}

func lowerHex(value string, bytes int) bool {
	raw, err := hex.DecodeString(value)
	return err == nil && len(raw) == bytes && hex.EncodeToString(raw) == value
}
func runtimeText(value string, limit int) bool {
	if len(value) == 0 || len(value) > limit {
		return false
	}
	for i := range value {
		if value[i] < 33 || value[i] > 126 {
			return false
		}
	}
	return true
}
func runtimeSource(value string) bool {
	if !runtimeText(value, 512) {
		return false
	}
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && u.String() == value && !strings.Contains(value, "\\")
}
func runtimeVersion(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	alnum := func(c byte) bool { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' }
	if !alnum(value[0]) || !alnum(value[len(value)-1]) {
		return false
	}
	for i := range value {
		if !alnum(value[i]) && value[i] != '.' && value[i] != '-' && value[i] != '+' {
			return false
		}
	}
	return true
}
func validateRuntimeManifest(m RuntimeManifest) error {
	size, err := strconv.ParseUint(m.ArtifactBytes, 10, 64)
	chainID, chainErr := strconv.ParseUint(m.Network.NativeChainID, 10, 64)
	if m.Version != RuntimeManifestVersion || !runtimeVersion(m.ReleaseVersion) || m.OS != runtime.GOOS || m.Arch != runtime.GOARCH ||
		m.ManagedFilename != artifactName || err != nil || size == 0 || size > 64<<20 || strconv.FormatUint(size, 10) != m.ArtifactBytes ||
		!lowerHex(m.ArtifactSHA256, 32) || !lowerHex(m.SourceRevision, 20) || !runtimeSource(m.SourceRepository) || !runtimeSource(m.ArtifactSource) ||
		!lowerHex(m.OriginalManifestSHA256, 32) || !lowerHex(m.RuntimeContractSHA256, 32) || m.Role != "ordinary-observer" ||
		m.BlockProduction || m.Validator || m.Signer || m.ValidatorKeys ||
		!lowerHex(m.Network.NetworkID32, 32) || !lowerHex(m.Network.NativeGenesisSHA256, 32) || !lowerHex(m.Network.CometGenesisSHA256, 32) ||
		chainErr != nil || chainID == 0 || strconv.FormatUint(chainID, 10) != m.Network.NativeChainID || !runtimeText(m.Network.CometChainID, 128) {
		return ErrRuntimeManifest
	}
	return nil
}

func validateExecutableFormat(code []byte) error {
	if runtime.GOARCH != "arm64" && runtime.GOARCH != "amd64" {
		return ErrUnsupported
	}
	switch runtime.GOOS {
	case "darwin":
		// Parse only fixed-width headers here. Do not allocate a table using an
		// untrusted command/section count from a candidate executable.
		if len(code) < 32 || binary.LittleEndian.Uint32(code[:4]) != macho.Magic64 {
			return ErrRuntimeManifest
		}
		cpu := binary.LittleEndian.Uint32(code[4:8])
		kind := binary.LittleEndian.Uint32(code[12:16])
		count, size := binary.LittleEndian.Uint32(code[16:20]), binary.LittleEndian.Uint32(code[20:24])
		if kind != uint32(macho.TypeExec) || count == 0 || count > 4096 || uint64(size) > uint64(len(code)-32) || count > size/8 ||
			runtime.GOARCH == "arm64" && cpu != uint32(macho.CpuArm64) || runtime.GOARCH == "amd64" && cpu != uint32(macho.CpuAmd64) {
			return ErrRuntimeManifest
		}
		offset, end := uint64(32), uint64(32)+uint64(size)
		for i := uint32(0); i < count; i++ {
			if offset > end || end-offset < 8 {
				return ErrRuntimeManifest
			}
			n := uint64(binary.LittleEndian.Uint32(code[offset+4 : offset+8]))
			if n < 8 || n > end-offset {
				return ErrRuntimeManifest
			}
			offset += n
		}
		if offset != end {
			return ErrRuntimeManifest
		}
	case "linux":
		if len(code) < 64 || !bytes.Equal(code[:4], []byte(elf.ELFMAG)) || code[4] != byte(elf.ELFCLASS64) || code[5] != byte(elf.ELFDATA2LSB) || code[6] != byte(elf.EV_CURRENT) {
			return ErrRuntimeManifest
		}
		kind, machine := binary.LittleEndian.Uint16(code[16:18]), binary.LittleEndian.Uint16(code[18:20])
		offset, count := binary.LittleEndian.Uint64(code[32:40]), uint64(binary.LittleEndian.Uint16(code[56:58]))
		if binary.LittleEndian.Uint16(code[52:54]) != 64 || binary.LittleEndian.Uint16(code[54:56]) != 56 || count == 0 || count > 4096 || offset < 64 || offset > uint64(len(code)) || count > (uint64(len(code))-offset)/56 ||
			kind != uint16(elf.ET_EXEC) && kind != uint16(elf.ET_DYN) || runtime.GOARCH == "arm64" && machine != uint16(elf.EM_AARCH64) || runtime.GOARCH == "amd64" && machine != uint16(elf.EM_X86_64) {
			return ErrRuntimeManifest
		}
	default:
		return ErrUnsupported
	}
	return nil
}

func readRuntimePublic(path, pin string, maximum int64, expected os.FileInfo) ([]byte, os.FileInfo, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || !lowerHex(pin, 32) {
		return nil, nil, ErrUnsafePath
	}
	physical, err := filepath.EvalSymlinks(path)
	if err != nil || physical != path {
		return nil, nil, ErrUnsafePath
	}
	before, err := os.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	uid, err := ownerUID(before)
	if err != nil || uid != uint32(os.Geteuid()) || !before.Mode().IsRegular() || before.Mode().Perm()&0022 != 0 || before.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 || before.Size() <= 0 || before.Size() > maximum {
		return nil, nil, ErrUnsafePath
	}
	same := func(a, b os.FileInfo) bool {
		return os.SameFile(a, b) && a.Mode() == b.Mode() && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
	}
	if expected != nil && !same(expected, before) {
		return nil, nil, ErrUnsafePath
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !same(before, opened) {
		return nil, nil, ErrUnsafePath
	}
	raw, err := io.ReadAll(io.LimitReader(f, maximum+1))
	after, e1 := f.Stat()
	named, e2 := os.Lstat(path)
	if err != nil || e1 != nil || e2 != nil || !same(opened, after) || !same(opened, named) || int64(len(raw)) != before.Size() {
		return nil, nil, ErrUnsafePath
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != pin {
		return nil, nil, ErrUnsafePath
	}
	return raw, before, nil
}

// OpenRuntimeCandidate accepts only locally selected paths and an independently
// supplied exact metadata pin. Metadata contains no command, argv, environment,
// PID or executable path. A provenance URL is a label; this method never fetches.
func OpenRuntimeCandidate(manifestPath, independentSHA256, executablePath string) (*RuntimeCandidate, error) {
	raw, manifestInfo, err := readRuntimePublic(manifestPath, independentSHA256, 16<<10, nil)
	if err != nil {
		return nil, err
	}
	var manifest RuntimeManifest
	if strictRecord(raw, &manifest) != nil || validateRuntimeManifest(manifest) != nil {
		return nil, ErrRuntimeManifest
	}
	code, executableInfo, err := readRuntimePublic(executablePath, manifest.ArtifactSHA256, 64<<20, nil)
	if err != nil {
		return nil, err
	}
	if strconv.Itoa(len(code)) != manifest.ArtifactBytes {
		return nil, ErrUnsafePath
	}
	if err := validateExecutableFormat(code); err != nil {
		return nil, err
	}
	return &RuntimeCandidate{manifest: manifest, manifestRaw: raw, executableRaw: code, manifestPath: manifestPath, executablePath: executablePath, manifestInfo: manifestInfo, executableInfo: executableInfo, manifestPin: independentSHA256}, nil
}
func (c *RuntimeCandidate) View() RuntimeCandidateView {
	if c == nil {
		return RuntimeCandidateView{Code: "NOT_SUPPLIED"}
	}
	return RuntimeCandidateView{Code: "PUBLIC_BYTES_CHECKED_NO_AUTHORITY", ManifestSHA256: c.manifestPin, Manifest: c.manifest}
}
func (c *RuntimeCandidate) unchanged() error {
	if c == nil {
		return ErrOriginalReleaseMissing
	}
	_, _, e1 := readRuntimePublic(c.manifestPath, c.manifestPin, 16<<10, c.manifestInfo)
	_, _, e2 := readRuntimePublic(c.executablePath, c.manifest.ArtifactSHA256, 64<<20, c.executableInfo)
	return errors.Join(e1, e2)
}

// ConfigureRuntimeCandidate is startup-only public intake, not publisher or
// native approval. The host must supply its independently pinned network too.
// Nothing in this API enables the production Install/Start gate.
func (m *Manager) ConfigureRuntimeCandidate(peer localipc.Peer, c *RuntimeCandidate, expected RuntimeNetwork) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.peerAllowed(peer); err != nil {
		return err
	}
	return m.bindRuntimeCandidate(c, expected)
}
func (m *Manager) bindRuntimeCandidate(c *RuntimeCandidate, expected RuntimeNetwork) error {
	if m.closed {
		return ErrClosed
	}
	if err := m.rootUnchanged(); err != nil {
		return err
	}
	if c == nil || c.manifest.Network != expected || m.process != nil || m.state.Stage != "not_installed" && m.state.Stage != "installed" && m.state.Stage != "stopped" {
		return ErrOriginalReleaseMissing
	}
	if m.state.Stage != "not_installed" && (m.state.Runtime == nil || m.state.Runtime.ManifestSHA256 != c.manifestPin) {
		return ErrRuntimeManifest
	}
	if err := c.unchanged(); err != nil {
		return err
	}
	m.runtime = c
	return nil
}
