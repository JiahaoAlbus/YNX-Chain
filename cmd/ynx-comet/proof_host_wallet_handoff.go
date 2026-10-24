//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"golang.org/x/sys/unix"
)

const proofHostWalletModuleName = "wallet-pq-host-catalog-registration.mjs"
const proofHostWalletModulePrefix = "export const originalPQHostCatalogRegistration=Object.freeze("

// This file is source-owned commissioning DATA for the existing Main import.
// It never edits/installs Main or qualifies a Root, Host, issuer or transaction.
// The original Main owner must accept it through the protected SourceOwner
// handoff. Paths remain on this host: no copying or string-only relocation.
type proofHostWalletHandoff struct {
	path   string
	parent *os.File
	info   os.FileInfo
	uid    uint32
}

func proofHostWalletOwner(real, effective int) error {
	if real <= 0 || effective != real {
		return errors.New("Wallet source handoff requires the same nonroot real and effective owner")
	}
	return nil
}

func proofHostWalletPath(path string) bool {
	return utf8.ValidString(path) && len(path) <= 4096 && !strings.ContainsRune(path, '\x00') && filepath.IsAbs(path) && filepath.Clean(path) == path && filepath.Dir(path) != path
}

func prepareProofHostWalletHandoff(path string) (_ *proofHostWalletHandoff, resultErr error) {
	if err := proofHostWalletOwner(os.Getuid(), os.Geteuid()); err != nil {
		return nil, err
	}
	if !proofHostWalletPath(path) || filepath.Base(path) != proofHostWalletModuleName {
		return nil, errors.New("Wallet source handoff requires its exact fixed module basename and canonical absolute path")
	}
	parentPath := filepath.Dir(path)
	resolved, err := filepath.EvalSymlinks(parentPath)
	if err != nil || resolved != parentPath {
		return nil, errors.New("Wallet source handoff parent must be original without symlink traversal")
	}
	fd, err := unix.Open(parentPath, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	parent := os.NewFile(uintptr(fd), "original-wallet-source-handoff-parent")
	info, err := parent.Stat()
	h := &proofHostWalletHandoff{path: path, parent: parent, info: info, uid: uint32(os.Geteuid())}
	defer func() {
		if resultErr != nil {
			resultErr = errors.Join(resultErr, h.close())
		}
	}()
	if err != nil {
		return nil, err
	}
	if err = h.parentCurrent(); err != nil {
		return nil, err
	}
	var target unix.Stat_t
	if err = unix.Fstatat(fd, filepath.Base(path), &target, unix.AT_SYMLINK_NOFOLLOW); !errors.Is(err, unix.ENOENT) {
		if err == nil {
			return nil, errors.New("existing Wallet handoff or partial/UNKNOWN result must be retained")
		}
		return nil, err
	}
	return h, nil
}

func (h *proofHostWalletHandoff) close() error {
	if h == nil || h.parent == nil {
		return nil
	}
	file := h.parent
	h.parent = nil
	return file.Close()
}

func (h *proofHostWalletHandoff) parentCurrent() error {
	if h == nil || h.parent == nil || h.info == nil {
		return errors.New("original Wallet handoff parent is unavailable")
	}
	path := filepath.Dir(h.path)
	resolved, err := filepath.EvalSymlinks(path)
	current, pathErr := os.Lstat(path)
	held, heldErr := h.parent.Stat()
	var stat unix.Stat_t
	if err != nil || resolved != path || pathErr != nil || heldErr != nil || !os.SameFile(h.info, current) || !os.SameFile(h.info, held) || !current.IsDir() || current.Mode().Perm() != 0700 || current.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 || unix.Fstat(int(h.parent.Fd()), &stat) != nil || stat.Uid != h.uid {
		return errors.New("original Wallet handoff parent identity or private ownership changed")
	}
	// Register and this writer may each create their one exclusive destination
	// in the same parent. Those owned directory mtime/ctime changes are expected;
	// directory inode/owner/protection must never be replaced or relaxed.
	return nil
}

func walletProofHostSelectionRequest(bindingPath, bindingPin string) ([]byte, error) {
	raw, err := readInitializationInput(bindingPath, consensus.MaxProofHostSourceSelectionRequestBytes)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(raw)
	if len(bindingPin) != 64 || strings.Trim(bindingPin, "0") == "" || hex.EncodeToString(digest[:]) != bindingPin {
		return nil, errors.New("Wallet handoff binding differs from the original independent pin")
	}
	var binding consensus.ProofHostDeliveryBinding
	if err = decodeStrict(raw, &binding); err != nil {
		return nil, err
	}
	if binding.OriginalHash != "0x"+binding.NativeWireHash {
		return nil, errors.New("Wallet handoff must preserve both original transaction hashes")
	}
	return json.Marshal(consensus.ProofHostSourceSelectionRequest{Version: consensus.ProofHostSourceSelectionRequestVersion, OperationID: binding.OperationID, Account: binding.Account, NetworkID: binding.NetworkID, TransactionHash: binding.TransactionHash, NativeWireHash: binding.NativeWireHash})
}

// Private test fault boundaries only; the normal CLI always passes nil. No
// environment/renderer option can replace filesystem operations or approval.
type proofHostWalletWriteFaults struct {
	afterWrite func(*os.File) error
	closeFile  func(*os.File) error
}

func proofHostWalletChangeStamp(stat unix.Stat_t) (string, error) {
	v := reflect.ValueOf(stat)
	for _, name := range []string{"Ctim", "Ctimespec"} {
		s := v.FieldByName(name)
		if s.IsValid() && s.Kind() == reflect.Struct {
			sec, nsec := s.FieldByName("Sec"), s.FieldByName("Nsec")
			if sec.IsValid() && nsec.IsValid() && sec.CanInt() && nsec.CanInt() {
				return strconv.FormatInt(sec.Int(), 10) + ":" + strconv.FormatInt(nsec.Int(), 10), nil
			}
		}
	}
	return "", errors.New("Wallet handoff change identity unavailable")
}

func proofHostWalletFileIdentity(file *os.File) (string, error) {
	var s unix.Stat_t
	info, err := file.Stat()
	if err != nil || unix.Fstat(int(file.Fd()), &s) != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 || s.Nlink != 1 || s.Uid != uint32(os.Geteuid()) {
		return "", errors.New("original Wallet source module is not a private single-link regular file")
	}
	change, err := proofHostWalletChangeStamp(s)
	if err != nil {
		return "", err
	}
	// Deliberately exclude atime: this writer's first readback may update it.
	return fmt.Sprintf("%d/%d/%d/%d/%d/%d/%d/%d/%s", s.Dev, s.Ino, s.Mode, s.Uid, s.Gid, s.Nlink, info.Size(), info.ModTime().UnixNano(), change), nil
}

func proofHostWalletFileCurrent(file *os.File, path, identity string) error {
	after, err := proofHostWalletFileIdentity(file)
	current, pathErr := os.Lstat(path)
	held, heldErr := file.Stat()
	if err != nil || after != identity || pathErr != nil || heldErr != nil || !os.SameFile(held, current) || current.Mode() != held.Mode() || current.Size() != held.Size() || !current.ModTime().Equal(held.ModTime()) {
		return errors.New("Wallet source handoff replaced during readback; retain UNKNOWN")
	}
	return nil
}

func (h *proofHostWalletHandoff) write(receipt consensus.ProofHostSourceCatalogReceipt, bindingPath, bindingPin string, faults *proofHostWalletWriteFaults) (resultErr error) {
	if !proofHostWalletPath(receipt.CatalogPath) || receipt.CatalogPath == h.path {
		return errors.New("original local catalog and fixed source module must be distinct")
	}
	request, err := walletProofHostSelectionRequest(bindingPath, bindingPin)
	if err != nil {
		return err
	}
	// This is the existing exact original binding/manifest/source selector. It
	// reads only small headers and never substitutes for Host acquire/current.
	if _, err = consensus.SelectRegisteredProofHostSource(receipt.CatalogPath, receipt.CatalogSHA256, request); err != nil {
		return err
	}
	pair, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	raw := append(append([]byte(proofHostWalletModulePrefix), pair...), []byte(");\n")...)
	if len(raw) > 32<<10 {
		return errors.New("fixed Wallet source module exceeds its bound")
	}
	if err = h.parentCurrent(); err != nil {
		return err
	}
	fd, err := unix.Openat(int(h.parent.Fd()), proofHostWalletModuleName, unix.O_CREAT|unix.O_EXCL|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return err
	}
	file := os.NewFile(uintptr(fd), "exclusive-wallet-source-handoff")
	defer func() {
		close := file.Close
		if faults != nil && faults.closeFile != nil {
			close = func() error { return faults.closeFile(file) }
		}
		resultErr = errors.Join(resultErr, close())
	}()
	// No remove, truncate, overwrite or retry after this exclusive creation.
	if n, err := file.Write(raw); err != nil || n != len(raw) {
		return errors.Join(errors.New("partial Wallet source handoff retained"), err)
	}
	if faults != nil && faults.afterWrite != nil {
		if err := faults.afterWrite(file); err != nil {
			return err
		}
	}
	if err = file.Sync(); err != nil {
		return err
	}
	identity, err := proofHostWalletFileIdentity(file)
	if err != nil {
		return err
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	readback, err := io.ReadAll(io.LimitReader(file, int64(len(raw)+1)))
	if err != nil || !bytes.Equal(readback, raw) {
		return errors.Join(errors.New("Wallet source handoff readback differs; retain UNKNOWN"), err)
	}
	if err = proofHostWalletFileCurrent(file, h.path, identity); err != nil {
		return err
	}
	if _, err = consensus.SelectRegisteredProofHostSource(receipt.CatalogPath, receipt.CatalogSHA256, request); err != nil {
		return err
	}
	if err = h.parentCurrent(); err != nil {
		return err
	}
	if err = h.parent.Sync(); err != nil {
		return err
	}
	return proofHostWalletFileCurrent(file, h.path, identity)
}
