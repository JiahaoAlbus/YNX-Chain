package oslimits

type LinuxControls struct {
	MemoryMax       string `json:"memoryMax"`
	SwapMax         string `json:"swapMax"`
	CPUMax          string `json:"cpuMax"`
	PidsMax         string `json:"pidsMax"`
	ScratchBytes    string `json:"scratchBytes"`
	ScratchReadOnly bool   `json:"scratchReadOnly"`
	RootReadOnly    bool   `json:"rootReadOnly"`
	CgroupReadOnly  bool   `json:"cgroupReadOnly"`
	CgroupInode     string `json:"cgroupInode"`
	NetNS           string `json:"netNS"`
	MountNS         string `json:"mountNS"`
	PIDNS           string `json:"pidNS"`
	UserNS          string `json:"userNS"`
	NoNewPrivileges bool   `json:"noNewPrivileges"`
	NoCapabilities  bool   `json:"noCapabilities"`
}
