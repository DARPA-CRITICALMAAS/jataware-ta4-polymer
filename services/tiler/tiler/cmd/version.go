package cmd

import (
	"fmt"
	"tiler/common"

	"github.com/spf13/cobra"
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print Version",
	Long:  "Print Version",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Print(common.GlobalBuildInfo)
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}
