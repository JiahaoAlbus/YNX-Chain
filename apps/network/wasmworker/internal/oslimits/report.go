// Package oslimits applies only fixed-worker process limits, never task,
// consent, issuer, reward or account authority.
package oslimits

const Version = "YNX-NETWORK-WORKER-OS-LIMITS/v1"

type Report struct {
	Version       string         `json:"version"`
	Platform      string         `json:"platform"`
	CPUSeconds    string         `json:"cpuSeconds"`
	FileSizeBytes string         `json:"fileSizeBytes"`
	CoreBytes     string         `json:"coreBytes"`
	OpenFiles     string         `json:"openFiles"`
	Processes     string         `json:"processes"`
	ParentBound   bool           `json:"parentBound"`
	MemoryHard    bool           `json:"memoryHard"`
	CPUShareHard  bool           `json:"cpuShareHard"`
	DiskQuotaHard bool           `json:"diskQuotaHard"`
	Linux         *LinuxControls `json:"linux,omitempty"`
	Challenge     string         `json:"challenge"`
}
