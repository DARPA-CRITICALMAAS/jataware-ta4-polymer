package main

import (
	"os"
	"tiler/cmd"
	"tiler/common"

	log "github.com/sirupsen/logrus"
)

var (
	Version   string
	BuildDate string
	Commit    string
)

func main() {
	common.GlobalBuildInfo.Version = Version
	common.GlobalBuildInfo.BuildDate = BuildDate
	cmd.Execute()
}

func init() {
	log.SetOutput(os.Stdout)
	log.SetLevel(log.DebugLevel)
}
