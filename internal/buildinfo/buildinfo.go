package buildinfo

import "strings"

type Info struct {
	Commit    string `json:"commit"`
	Release   string `json:"release"`
	BuildTime string `json:"buildTime"`
}

func Normalize(input Info) Info {
	input.Commit = strings.TrimSpace(input.Commit)
	input.Release = strings.TrimSpace(input.Release)
	input.BuildTime = strings.TrimSpace(input.BuildTime)
	if input.Commit == "" {
		input.Commit = "unknown"
	}
	if input.Release == "" {
		input.Release = "local"
	}
	if input.BuildTime == "" {
		input.BuildTime = "unknown"
	}
	return input
}
