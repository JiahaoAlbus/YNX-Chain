//go:build unix

package consensus

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strconv"

	"golang.org/x/sys/unix"
)

const ProofHostSourceCatalogVersion = "YNX-CONSENSUS-PROOF-HOST-SOURCE-CATALOG/v1"
const ProofHostSourceSelectionRequestVersion = "YNX-CONSENSUS-PROOF-HOST-SELECTION-REQUEST/v1"
const MaxProofHostSourceCatalogBytes = 16 << 10
const MaxProofHostSourceSelectionRequestBytes = 4096

// One independently registered delivery, not a mutable registry or authority
// grant. A different epoch needs a new exclusive catalog and independent pin.
type ProofHostSourceCatalog struct {
	Version        string                   `json:"version"`
	ManifestPath   string                   `json:"manifestPath"`
	ManifestSHA256 string                   `json:"manifestSHA256"`
	Binding        ProofHostDeliveryBinding `json:"binding"`
	SourcePath     string                   `json:"sourcePath"`
	SourceSHA256   string                   `json:"sourceSha256"`
	SourceID       string                   `json:"sourceId"`
	Epoch          string                   `json:"epoch"`
}

type ProofHostSourceCatalogReceipt struct {
	CatalogPath   string `json:"catalogPath"`
	CatalogSHA256 string `json:"catalogSha256"`
}

type ProofHostSourceSelectionRequest struct {
	Version         string `json:"version"`
	OperationID     string `json:"operationId"`
	Account         string `json:"account"`
	NetworkID       string `json:"networkId"`
	TransactionHash string `json:"transactionHash"`
	NativeWireHash  string `json:"nativeWireHash"`
}

// Exact Main selection DATA ABI. Only acquire/current can qualify the source;
// this object supplies neither an opaque Host lease nor a Native Root grant.
type ProofHostSourceSelection struct {
	SourcePath   string `json:"sourcePath"`
	SourceSHA256 string `json:"sourceSha256"`
	SourceID     string `json:"sourceId"`
	Epoch        string `json:"epoch"`
}

func proofSelectionJSON(raw []byte, target any, limit int) error {
	if len(raw) == 0 || len(raw) > limit || pqLightUniqueJSON(raw) != nil || json.Unmarshal(raw, target) != nil {
		return errors.New("invalid bounded unique selection JSON")
	}
	canonical, err := json.Marshal(target)
	if err != nil || !pqLightJSONEquivalent(raw, canonical) {
		return errors.New("selection JSON requires exact closed field names and types")
	}
	return nil
}

func validProofSelectionBinding(binding ProofHostDeliveryBinding) bool {
	return proofDeliveryOperation.MatchString(binding.OperationID) && proofDeliveryAccount.MatchString(binding.Account) && validProofDeliveryHash(binding.NetworkID) && validProofDeliveryHash(binding.TransactionHash) && validProofDeliveryHash(binding.NativeWireHash) && binding.OriginalHash == "0x"+binding.NativeWireHash
}

type proofSelectionParent struct {
	path string
	file *os.File
	info os.FileInfo
}

func openProofSelectionParent(path string) (*proofSelectionParent, error) {
	if err := requireInspectionPath(path); err != nil {
		return nil, err
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "private-proof-source-catalog-parent")
	info, err := f.Stat()
	p := &proofSelectionParent{path: path, file: f, info: info}
	if err != nil || p.unchanged() != nil {
		_ = f.Close()
		return nil, errors.New("existing original private 0700 source parent required")
	}
	return p, nil
}

func (p *proofSelectionParent) unchanged() error {
	info, err := os.Lstat(p.path)
	held, heldErr := p.file.Stat()
	var stat unix.Stat_t
	resolved, resolveErr := filepath.EvalSymlinks(p.path)
	if err != nil || heldErr != nil || resolveErr != nil || resolved != p.path || p.info == nil || !os.SameFile(p.info, info) || !os.SameFile(p.info, held) || !info.IsDir() || info.Mode().Perm() != 0700 || info.Mode()&(os.ModeSticky|os.ModeSetuid|os.ModeSetgid) != 0 || unix.Fstat(int(p.file.Fd()), &stat) != nil || stat.Uid != uint32(os.Geteuid()) {
		return errors.New("private source parent identity or protection changed")
	}
	return nil
}

type proofSelectionReads struct {
	files   []*proofHostOriginal
	parents []*proofSelectionParent
}

func (r *proofSelectionReads) close() {
	for _, f := range r.files {
		_ = f.file.Close()
	}
	for _, p := range r.parents {
		_ = p.file.Close()
	}
}

func (r *proofSelectionReads) read(path, pin string, limit int64) ([]byte, error) {
	if _, err := proofHostHash(pin); err != nil {
		return nil, err
	}
	for _, f := range r.files {
		if f.path == path {
			return nil, errors.New("distinct original selection file roles required")
		}
	}
	p, err := openProofSelectionParent(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	r.parents = append(r.parents, p)
	f, err := readProofHostOriginal(path, pin, limit)
	if err != nil {
		return nil, err
	}
	r.files = append(r.files, f)
	var stat unix.Stat_t
	if f.info.Mode().Perm() != 0600 || f.info.Mode()&(os.ModeSticky|os.ModeSetuid|os.ModeSetgid) != 0 || unix.Fstat(int(f.file.Fd()), &stat) != nil || stat.Uid != uint32(os.Geteuid()) {
		return nil, errors.New("original private 0600 selection file required")
	}
	return f.raw, nil
}

func (r *proofSelectionReads) unchanged() error {
	for _, f := range r.files {
		if err := f.unchanged(); err != nil {
			return err
		}
	}
	for _, p := range r.parents {
		if err := p.unchanged(); err != nil {
			return err
		}
	}
	return nil
}

// No state, proof, context or lifecycle body is read here. The small source
// header is checked against every original manifest role pin; the original
// Host's acquire/current retains full context, lifecycle, trust and finality.
func (r *proofSelectionReads) delivery(path, pin string, binding ProofHostDeliveryBinding) (ProofHostSourceCatalog, error) {
	var catalog ProofHostSourceCatalog
	if !validProofSelectionBinding(binding) {
		return catalog, errors.New("complete independent original transaction binding required")
	}
	raw, err := r.read(path, pin, MaxProofHostSourceCatalogBytes)
	if err != nil {
		return catalog, err
	}
	var manifest ProofHostDeliveryManifest
	if err := proofSelectionJSON(raw, &manifest, MaxProofHostSourceCatalogBytes); err != nil {
		return catalog, err
	}
	if manifest.Version != ProofHostDeliveryVersion || manifest.Binding != binding || !proofDeliverySourceID.MatchString(manifest.SourceID) || manifest.SourceFile != "host-source.json" || !validProofDeliveryHash(manifest.SourceSHA256) || len(manifest.Files) != 8 && len(manifest.Files) != 9 || filepath.Base(path) != "delivery.json" {
		return catalog, errors.New("delivery differs from independently supplied original binding")
	}
	if _, err := proofHostUint(manifest.Epoch, math.MaxUint64, false); err != nil {
		return catalog, err
	}
	roles := make(map[string]ProofHostDeliveryFile, len(manifest.Files))
	var total uint64
	index := 0
	for _, role := range proofHostDeliveryRoles {
		if role.role == "runtime" && len(manifest.Files) == 8 {
			continue
		}
		entry := manifest.Files[index]
		size, err := proofHostUint(entry.Bytes, uint64(role.maximum), false)
		if err != nil || entry.Role != role.role || entry.Name != role.name || !validProofDeliveryHash(entry.SHA256) || math.MaxUint64-total < size {
			return catalog, errors.New("delivery has an invalid complete original role catalog")
		}
		total += size
		roles[entry.Role] = entry
		index++
	}
	if manifest.TotalBytes != strconv.FormatUint(total, 10) || roles["source"].SHA256 != manifest.SourceSHA256 {
		return catalog, errors.New("delivery original total or source SHA256 differs")
	}
	directory := filepath.Dir(path)
	sourcePath := filepath.Join(directory, manifest.SourceFile)
	sourceRaw, err := r.read(sourcePath, manifest.SourceSHA256, 16<<10)
	if err != nil || strconv.Itoa(len(sourceRaw)) != roles["source"].Bytes {
		return catalog, errors.New("original source header bytes or identity differ")
	}
	var source struct {
		Version                 string `json:"version"`
		SourceID                string `json:"sourceId"`
		Epoch                   string `json:"epoch"`
		ContextFile             string `json:"contextFile"`
		ContextSHA256           string `json:"contextSHA256"`
		LifecycleFile           string `json:"lifecycleFile"`
		LifecycleSHA256         string `json:"lifecycleSHA256"`
		MigrationSHA256         string `json:"migrationSHA256"`
		GenesisSHA256           string `json:"genesisSHA256"`
		StateSHA256             string `json:"stateSHA256"`
		ScheduleSHA256          string `json:"scheduleSHA256"`
		RuntimePlanSHA256       string `json:"runtimePlanSHA256"`
		TrustedLightBlockSHA256 string `json:"trustedLightBlockSHA256"`
	}
	if err := proofSelectionJSON(sourceRaw, &source, 16<<10); err != nil {
		return catalog, err
	}
	if source.Version != "YNX-CONSENSUS-PROOF-HOST-SOURCE/v1" || source.SourceID != manifest.SourceID || source.Epoch != manifest.Epoch || source.ContextFile != filepath.Join(directory, roles["context"].Name) || source.LifecycleFile != filepath.Join(directory, roles["lifecycle"].Name) || source.ContextSHA256 != roles["context"].SHA256 || source.LifecycleSHA256 != roles["lifecycle"].SHA256 || source.MigrationSHA256 != roles["migration"].SHA256 || source.GenesisSHA256 != roles["genesis"].SHA256 || source.StateSHA256 != roles["state"].SHA256 || source.ScheduleSHA256 != roles["schedule"].SHA256 || source.RuntimePlanSHA256 != roles["runtime"].SHA256 || source.TrustedLightBlockSHA256 != roles["trustedLightBlock"].SHA256 {
		return catalog, errors.New("source header differs from complete original delivery pins or epoch")
	}
	return ProofHostSourceCatalog{Version: ProofHostSourceCatalogVersion, ManifestPath: path, ManifestSHA256: pin, Binding: binding, SourcePath: sourcePath, SourceSHA256: manifest.SourceSHA256, SourceID: manifest.SourceID, Epoch: manifest.Epoch}, nil
}

// RegisterProofHostSourceCatalog records independently supplied DATA only. The
// private parent and external digests protect selection, not Root/Host status.
// All preflight checks finish before reserving the exclusive destination.
func RegisterProofHostSourceCatalog(manifestPath, manifestPin, bindingPath, bindingPin, output string) (ProofHostSourceCatalogReceipt, error) {
	var receipt ProofHostSourceCatalogReceipt
	reads := &proofSelectionReads{}
	defer reads.close()
	raw, err := reads.read(bindingPath, bindingPin, MaxProofHostSourceSelectionRequestBytes)
	if err != nil {
		return receipt, err
	}
	var binding ProofHostDeliveryBinding
	if err := proofSelectionJSON(raw, &binding, MaxProofHostSourceSelectionRequestBytes); err != nil {
		return receipt, err
	}
	catalog, err := reads.delivery(manifestPath, manifestPin, binding)
	if err != nil {
		return receipt, err
	}
	if !filepath.IsAbs(output) || filepath.Clean(output) != output {
		return receipt, errors.New("canonical explicit new catalog path required")
	}
	parent, err := openProofSelectionParent(filepath.Dir(output))
	if err != nil {
		return receipt, err
	}
	defer parent.file.Close()
	encoded, err := json.Marshal(catalog)
	if err != nil || len(encoded)+1 > MaxProofHostSourceCatalogBytes {
		return receipt, errors.New("selection catalog exceeds its bound")
	}
	encoded = append(encoded, '\n')
	if err := reads.unchanged(); err != nil {
		return receipt, err
	}
	if err := parent.unchanged(); err != nil {
		return receipt, err
	}
	fd, err := unix.Openat(int(parent.file.Fd()), filepath.Base(output), unix.O_CREAT|unix.O_EXCL|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return receipt, err
	}
	f := os.NewFile(uintptr(fd), "exclusive-proof-source-catalog")
	defer f.Close()
	// An incomplete/unknown write is retained; never unlink, truncate or retry.
	if n, err := f.Write(encoded); err != nil || n != len(encoded) {
		return receipt, errors.New("incomplete catalog write retained")
	}
	if err := f.Sync(); err != nil {
		return receipt, err
	}
	info, err := f.Stat()
	var stat unix.Stat_t
	if err != nil || unix.Fstat(fd, &stat) != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Mode()&(os.ModeSticky|os.ModeSetuid|os.ModeSetgid) != 0 || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) {
		return receipt, errors.New("exclusive private catalog write changed")
	}
	stamp, err := proofHostChangeStamp(stat)
	if err != nil {
		return receipt, err
	}
	held := &proofHostOriginal{path: output, raw: encoded, file: f, info: info, changed: stamp}
	if err := held.unchanged(); err != nil {
		return receipt, err
	}
	if err := reads.unchanged(); err != nil {
		return receipt, err
	}
	if err := parent.unchanged(); err != nil {
		return receipt, err
	}
	if err := parent.file.Sync(); err != nil {
		return receipt, err
	}
	if err := f.Close(); err != nil {
		return receipt, err
	}
	return ProofHostSourceCatalogReceipt{CatalogPath: output, CatalogSHA256: proofHostSHA(encoded)}, nil
}

// SelectRegisteredProofHostSource reads at most catalog/manifest/source headers
// and compares both original hashes. It neither repairs nor checks current by
// proxy; a revoked, retired or expired source still fails normal acquire/current.
func SelectRegisteredProofHostSource(catalogPath, catalogPin string, requestRaw []byte) (ProofHostSourceSelection, error) {
	var result ProofHostSourceSelection
	var request ProofHostSourceSelectionRequest
	if err := proofSelectionJSON(requestRaw, &request, MaxProofHostSourceSelectionRequestBytes); err != nil || request.Version != ProofHostSourceSelectionRequestVersion {
		return result, errors.New("exact original source selection request required")
	}
	binding := ProofHostDeliveryBinding{OperationID: request.OperationID, Account: request.Account, NetworkID: request.NetworkID, TransactionHash: request.TransactionHash, NativeWireHash: request.NativeWireHash, OriginalHash: "0x" + request.NativeWireHash}
	if !validProofSelectionBinding(binding) {
		return result, errors.New("invalid exact original transaction selection binding")
	}
	reads := &proofSelectionReads{}
	defer reads.close()
	raw, err := reads.read(catalogPath, catalogPin, MaxProofHostSourceCatalogBytes)
	if err != nil {
		return result, err
	}
	var catalog ProofHostSourceCatalog
	if err := proofSelectionJSON(raw, &catalog, MaxProofHostSourceCatalogBytes); err != nil || catalog.Version != ProofHostSourceCatalogVersion || catalog.Binding != binding {
		return result, errors.New("catalog differs from original transaction selection")
	}
	original, err := reads.delivery(catalog.ManifestPath, catalog.ManifestSHA256, binding)
	if err != nil || original != catalog {
		return result, errors.New("registered delivery source, epoch or original pins changed")
	}
	if err := reads.unchanged(); err != nil {
		return result, err
	}
	return ProofHostSourceSelection{SourcePath: catalog.SourcePath, SourceSHA256: catalog.SourceSHA256, SourceID: catalog.SourceID, Epoch: catalog.Epoch}, nil
}
