//go:build linux || darwin

package consensus

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
)

var errPQSourceIdentity = errors.New("original resource process identity mismatch")

// pqSourceProcessIdentity is independently observed OS DATA, never a Root, signer or
// caller assertion. Expected values must come from the original trusted host;
// a server's JSON or a node PID cannot supply its own expected Go identity.
type pqSourceProcessIdentity struct {
	PID           int32  `json:"pid"`
	UID           uint32 `json:"uid"`
	StartIdentity string `json:"startIdentity"`
	ImagePath     string `json:"imagePath"`
	ImageSHA256   string `json:"imageSHA256"`
}

type pqSourceProcessImage struct {
	start, path, imagePath string
	uid                    uint32
}

func observePQSourceProcessIdentity(ctx context.Context, pid int32) (pqSourceProcessIdentity, error) {
	if ctx == nil || pid <= 0 {
		return pqSourceProcessIdentity{}, errPQSourceIdentity
	}
	if err := ctx.Err(); err != nil {
		return pqSourceProcessIdentity{}, err
	}
	before, err := observePQSourceProcessImage(pid)
	if err != nil || before.uid != uint32(os.Geteuid()) {
		return pqSourceProcessIdentity{}, errPQSourceIdentity
	}
	file, err := os.Open(before.path)
	if err != nil {
		return pqSourceProcessIdentity{}, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || opened.Size() > 512<<20 {
		return pqSourceProcessIdentity{}, errPQSourceIdentity
	}
	hash := sha256.New()
	buf := make([]byte, 64<<10)
	var total int64
	for {
		if err = ctx.Err(); err != nil {
			return pqSourceProcessIdentity{}, err
		}
		n, e := file.Read(buf)
		if n > 0 {
			total += int64(n)
			if total > 512<<20 {
				return pqSourceProcessIdentity{}, errPQSourceIdentity
			}
			_, _ = hash.Write(buf[:n])
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return pqSourceProcessIdentity{}, e
		}
	}
	after, err := observePQSourceProcessImage(pid)
	if err != nil || after != before {
		return pqSourceProcessIdentity{}, errPQSourceIdentity
	}
	current, err := os.Stat(after.path)
	if err != nil || !os.SameFile(opened, current) || opened.Size() != current.Size() || !opened.ModTime().Equal(current.ModTime()) {
		return pqSourceProcessIdentity{}, errPQSourceIdentity
	}
	return pqSourceProcessIdentity{pid, before.uid, before.start, before.imagePath, hex.EncodeToString(hash.Sum(nil))}, nil
}
func validPQSourceProcessIdentity(v pqSourceProcessIdentity) bool {
	b, e := hex.DecodeString(v.ImageSHA256)
	return v.PID > 0 && v.UID == uint32(os.Geteuid()) && v.StartIdentity != "" && len(v.StartIdentity) <= 160 && len(v.ImagePath) > 0 && v.ImagePath[0] == '/' && len(v.ImagePath) <= 4096 && e == nil && len(b) == 32 && hex.EncodeToString(b) == v.ImageSHA256
}
func checkPQSourceProcessIdentity(ctx context.Context, expected pqSourceProcessIdentity) error {
	if !validPQSourceProcessIdentity(expected) {
		return errPQSourceIdentity
	}
	actual, err := observePQSourceProcessIdentity(ctx, expected.PID)
	if err != nil {
		return err
	}
	if actual != expected {
		return errPQSourceIdentity
	}
	return nil
}
