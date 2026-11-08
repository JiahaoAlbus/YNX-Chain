//go:build securelink_openssl && cgo

package native

/*
#include <stdlib.h>
#include "bridge.h"
*/
import "C"

import (
	"errors"
	"fmt"
	"io"
	"reflect"
	"runtime"
	"strings"
	"syscall"
	"unsafe"
)

// serverCASeal excludes access time, which pread may legitimately update. The
// Darwin/Linux syscall Stat_t timestamp field names differ; both are handled
// explicitly and other layouts fail closed. No pathname or key is inspected.
type serverCASeal struct {
	dev, ino, mode, uid, nlink uint64
	size                       int64
	mtimeSec, mtimeNsec        int64
	ctimeSec, ctimeNsec        int64
}

func serverCAStat(fd int) (serverCASeal, error) {
	var st syscall.Stat_t
	if err := syscall.Fstat(fd, &st); err != nil {
		return serverCASeal{}, err
	}
	if st.Mode&syscall.S_IFMT != syscall.S_IFREG || uint64(st.Uid) != uint64(syscall.Geteuid()) ||
		st.Mode&0022 != 0 || st.Nlink < 1 || st.Size <= 0 || st.Size > 1<<20 {
		return serverCASeal{}, errors.New("securelink: bounded owned regular public CA fd required")
	}
	timestamp := func(linux, darwin string) (int64, int64, bool) {
		value := reflect.ValueOf(st).FieldByName(linux)
		if !value.IsValid() {
			value = reflect.ValueOf(st).FieldByName(darwin)
		}
		if !value.IsValid() || value.Kind() != reflect.Struct {
			return 0, 0, false
		}
		sec, nsec := value.FieldByName("Sec"), value.FieldByName("Nsec")
		if !sec.IsValid() || !nsec.IsValid() || !sec.CanInt() || !nsec.CanInt() {
			return 0, 0, false
		}
		return sec.Int(), nsec.Int(), true
	}
	ms, mn, mok := timestamp("Mtim", "Mtimespec")
	cs, cn, cok := timestamp("Ctim", "Ctimespec")
	if !mok || !cok {
		return serverCASeal{}, ErrUnavailable
	}
	return serverCASeal{uint64(st.Dev), uint64(st.Ino), uint64(st.Mode), uint64(st.Uid), uint64(st.Nlink), st.Size, ms, mn, cs, cn}, nil
}

func serverPublicCAFromFD(fd int) (raw []byte, err error) {
	flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), uintptr(syscall.F_GETFL), 0)
	if errno != 0 {
		return nil, errno
	}
	if flags&syscall.O_ACCMODE != syscall.O_RDONLY {
		return nil, errors.New("securelink: original public CA fd must be read-only")
	}
	before, err := serverCAStat(fd)
	if err != nil {
		return nil, err
	}
	owned, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), uintptr(syscall.F_DUPFD_CLOEXEC), 0)
	if errno != 0 {
		return nil, errno
	}
	duplicate := int(owned)
	defer func() {
		// Close is attempted exactly once, including EINTR. No uncertain numeric
		// descriptor is retried, probed or converted into a successful close.
		if closeError := syscall.Close(duplicate); closeError != nil {
			raw = nil
			err = &ServerContextFDCleanupError{CertificateFD: -1, PrivateKeyFD: -1, CAFD: duplicate,
				CloseUnknown: 4, Cause: errors.Join(err, closeError)}
		}
	}()
	opened, err := serverCAStat(duplicate)
	if err != nil || opened != before {
		return nil, errors.Join(err, errors.New("securelink: original CA fd changed during duplication"))
	}
	raw = make([]byte, int(before.size))
	for at := 0; at < len(raw); {
		n, readError := syscall.Pread(duplicate, raw[at:], int64(at))
		if n > 0 {
			at += n
		}
		if readError == syscall.EINTR {
			continue
		}
		if readError != nil {
			return nil, readError
		}
		if n == 0 {
			return nil, io.ErrUnexpectedEOF
		}
	}
	var extra [1]byte
	n, readError := syscall.Pread(duplicate, extra[:], before.size)
	if readError != nil || n != 0 {
		return nil, errors.Join(readError, errors.New("securelink: original CA fd size changed"))
	}
	after, err := serverCAStat(duplicate)
	if err != nil || after != before {
		return nil, errors.Join(err, errors.New("securelink: original CA fd changed during read"))
	}
	originalAfter, err := serverCAStat(fd)
	if err != nil || originalAfter != before {
		return nil, errors.Join(err, errors.New("securelink: original CA fd identity changed during read"))
	}
	return raw, nil
}

// NewServerContextFromFDs is a low-level PRIVATE Native credential import, not
// a Root/pin/Source factory. The normal zero-input owner must supply its actual
// original Auth qualification and retain that same borrow through physical
// listener/connection completion, including a returned cleanup-UNKNOWN error.
//
// The existing pinned C helper parses certificate/key only through owned FD
// duplicates. Go reads only bounded PUBLIC CA PEM through pread of its owned
// duplicate; borrowed FDs are never closed or seeked and no path is resolved.
func NewServerContextFromFDs(certFD, keyFD, caFD int, peerSAN, expectedCertSHA string) (*Context, error) {
	for _, fd := range []int{certFD, keyFD, caFD} {
		if fd < 0 || uint64(fd) > uint64(1<<31-1) {
			return nil, errors.New("securelink: bounded original credential fd required")
		}
	}
	if certFD == keyFD || certFD == caFD || keyFD == caFD || peerSAN == "" ||
		strings.ContainsAny(peerSAN, "\x00*/ :\\\t\r\n") || len(expectedCertSHA) != 64 ||
		strings.Trim(expectedCertSHA, "0123456789abcdef") != "" {
		return nil, errors.New("securelink: exact original peer SAN and public certificate SHA required")
	}
	publicCA, err := serverPublicCAFromFD(caFD)
	if err != nil {
		return nil, err
	}
	certificateSHA := C.CString(expectedCertSHA)
	defer C.free(unsafe.Pointer(certificateSHA))
	var cleanup C.ynx_credential_fd_cleanup
	var message [192]C.char
	ptr := C.ynx_ctx_new_fds(C.int(certFD), C.int(keyFD), (*C.uchar)(unsafe.Pointer(&publicCA[0])), C.size_t(len(publicCA)),
		certificateSHA, 1, &cleanup, &message[0], C.size_t(len(message)))
	runtime.KeepAlive(publicCA)
	if cleanup.close_unknown != 0 {
		if ptr != nil {
			C.SSL_CTX_free(ptr)
		}
		return nil, &ServerContextFDCleanupError{CertificateFD: int(cleanup.certificate_fd), PrivateKeyFD: int(cleanup.private_key_fd), CAFD: -1,
			CloseUnknown: uint32(cleanup.close_unknown), Cause: errors.New(C.GoString(&message[0]))}
	}
	if ptr == nil {
		return nil, fmt.Errorf("securelink: %s", C.GoString(&message[0]))
	}
	ctx := &Context{ptr: ptr, cfg: Config{PeerSAN: peerSAN, Server: true}}
	runtime.SetFinalizer(ctx, func(c *Context) { _ = c.Close() })
	return ctx, nil
}
