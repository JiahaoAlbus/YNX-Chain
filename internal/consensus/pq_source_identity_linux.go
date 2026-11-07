//go:build linux

package consensus

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
)

func observePQSourceProcessImage(pid int32) (pqSourceProcessImage, error) {
	base := fmt.Sprintf("/proc/%d", pid)
	info, err := os.Stat(base)
	if err != nil {
		return pqSourceProcessImage{}, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return pqSourceProcessImage{}, errPQSourceIdentity
	}
	uid := stat.Uid
	raw, err := os.ReadFile(base + "/stat")
	if err != nil || len(raw) > 16384 {
		return pqSourceProcessImage{}, errPQSourceIdentity
	}
	end := strings.LastIndexByte(string(raw), ')')
	if end < 0 {
		return pqSourceProcessImage{}, errPQSourceIdentity
	}
	fields := strings.Fields(string(raw)[end+1:])
	if len(fields) < 20 {
		return pqSourceProcessImage{}, errPQSourceIdentity
	}
	ticks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil || ticks == 0 {
		return pqSourceProcessImage{}, errPQSourceIdentity
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil || len(boot) > 80 {
		return pqSourceProcessImage{}, errPQSourceIdentity
	}
	// Opening the kernel exe link, not a reported argv or mutable resource file,
	// pins the actual image inode. observePQSourceProcessIdentity rechecks after hashing.
	image, err := os.Readlink(base + "/exe")
	if err != nil || !strings.HasPrefix(image, "/") || strings.HasSuffix(image, " (deleted)") {
		return pqSourceProcessImage{}, errPQSourceIdentity
	}
	return pqSourceProcessImage{fmt.Sprintf("linux:%s:%d", strings.TrimSpace(string(boot)), ticks), base + "/exe", image, uid}, nil
}
