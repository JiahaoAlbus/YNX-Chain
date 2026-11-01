package localipc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
)

var ErrResourceIdentity = errors.New("original resource process identity mismatch")

// ProcessIdentity is independently observed OS DATA, never a Root, signer or
// caller assertion. Expected values must come from the original trusted host;
// a server's JSON or a node PID cannot supply its own expected Go identity.
type ProcessIdentity struct {
	PID           int32  `json:"pid"`
	UID           uint32 `json:"uid"`
	StartIdentity string `json:"startIdentity"`
	ImagePath     string `json:"imagePath"`
	ImageSHA256   string `json:"imageSHA256"`
}

type processImage struct {
	start, path, imagePath string
	uid                    uint32
}

func ObserveProcessIdentity(ctx context.Context, pid int32) (ProcessIdentity, error) {
	if ctx == nil || pid <= 0 {
		return ProcessIdentity{}, ErrResourceIdentity
	}
	if err := ctx.Err(); err != nil {
		return ProcessIdentity{}, err
	}
	before, err := observeProcessImage(pid)
	if err != nil || before.uid != uint32(os.Geteuid()) {
		return ProcessIdentity{}, ErrResourceIdentity
	}
	file, err := os.Open(before.path)
	if err != nil {
		return ProcessIdentity{}, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || opened.Size() > 512<<20 {
		return ProcessIdentity{}, ErrResourceIdentity
	}
	hash := sha256.New()
	buf := make([]byte, 64<<10)
	var total int64
	for {
		if err = ctx.Err(); err != nil {
			return ProcessIdentity{}, err
		}
		n, e := file.Read(buf)
		if n > 0 {
			total += int64(n)
			if total > 512<<20 {
				return ProcessIdentity{}, ErrResourceIdentity
			}
			_, _ = hash.Write(buf[:n])
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return ProcessIdentity{}, e
		}
	}
	after, err := observeProcessImage(pid)
	if err != nil || after != before {
		return ProcessIdentity{}, ErrResourceIdentity
	}
	current, err := os.Stat(after.path)
	if err != nil || !os.SameFile(opened, current) || opened.Size() != current.Size() || !opened.ModTime().Equal(current.ModTime()) {
		return ProcessIdentity{}, ErrResourceIdentity
	}
	return ProcessIdentity{pid, before.uid, before.start, before.imagePath, hex.EncodeToString(hash.Sum(nil))}, nil
}
func validProcessIdentity(v ProcessIdentity) bool {
	b, e := hex.DecodeString(v.ImageSHA256)
	return v.PID > 0 && v.UID == uint32(os.Geteuid()) && v.StartIdentity != "" && len(v.StartIdentity) <= 160 && len(v.ImagePath) > 0 && v.ImagePath[0] == '/' && len(v.ImagePath) <= 4096 && e == nil && len(b) == 32 && hex.EncodeToString(b) == v.ImageSHA256
}
func CheckProcessIdentity(ctx context.Context, expected ProcessIdentity) error {
	if !validProcessIdentity(expected) {
		return ErrResourceIdentity
	}
	actual, err := ObserveProcessIdentity(ctx, expected.PID)
	if err != nil {
		return err
	}
	if actual != expected {
		return ErrResourceIdentity
	}
	return nil
}
