package common

import "fmt"

type BuildInfo struct {
	Version   string `json:"version"`
	BuildDate string `json:"build_date"`
}

func (b BuildInfo) String() string {
	return fmt.Sprintf("Version: %s\nBuildDate: %s\n", b.Version, b.BuildDate)
}

var (
	GlobalBuildInfo = &BuildInfo{}
)
