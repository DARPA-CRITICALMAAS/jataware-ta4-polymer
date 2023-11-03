package cmd

import (
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "tiler",
	Short: "tiler server",
}

func Execute() {
	cobra.CheckErr(rootCmd.Execute())
}

func init() {
	//rootCmd.CompletionOptions.DisableDefaultCmd = true
}
