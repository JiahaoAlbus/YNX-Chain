//go:build linux

package localipc

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

func observeProcessImage(pid int32) (processImage, error) {
	base := fmt.Sprintf("/proc/%d", pid)
	info, err := os.Stat(base)
	if err != nil {
		return processImage{}, err
	}
	uid, err := fileOwner(info)
	if err != nil {
		return processImage{}, err
	}
	raw, err := os.ReadFile(base + "/stat")
	if err != nil || len(raw) > 16384 {
		return processImage{}, ErrResourceIdentity
	}
	end := strings.LastIndexByte(string(raw), ')')
	if end < 0 {
		return processImage{}, ErrResourceIdentity
	}
	fields := strings.Fields(string(raw)[end+1:])
	if len(fields) < 20 {
		return processImage{}, ErrResourceIdentity
	}
	ticks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil || ticks == 0 {
		return processImage{}, ErrResourceIdentity
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil || len(boot) > 80 {
		return processImage{}, ErrResourceIdentity
	}
	// Opening the kernel exe link, not a reported argv or mutable resource file,
	// pins the actual image inode. ObserveProcessIdentity rechecks after hashing.
	image, err := os.Readlink(base + "/exe")
	if err != nil || !strings.HasPrefix(image, "/") || strings.HasSuffix(image, " (deleted)") {
		return processImage{}, ErrResourceIdentity
	}
	return processImage{fmt.Sprintf("linux:%s:%d", strings.TrimSpace(string(boot)), ticks), base + "/exe", image, uid}, nil
}
