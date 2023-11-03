package cmd

import (
	"tiler/api"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func loadSetting() api.Settings {
	viper.SetEnvPrefix("tiler")
	viper.AutomaticEnv()

	return api.Settings{
		Addr:                 viper.GetString("bind"),
		HttpReadTimeout:      viper.GetInt("http_read_timeout"),
		HttpWriteTimeout:     viper.GetInt("http_write_timeout"),
		TilesDirectory:       viper.GetString("tiles_directory"),
		VipsConcurrencyLimit: viper.GetInt("vips_concurrency_limit"),
		TempDir:              viper.GetString("temp_dir"),
		VipsSubmitTimeout:    viper.GetDuration("vips_submit_timeout"),
	}
}

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start VPN Proxy Http Server",
	Long:  "Start VPN Proxy Http Server",
	Run: func(cmd *cobra.Command, args []string) {
		settings := loadSetting()
		api.Run(&settings)
	},
}

func init() {
	rootCmd.AddCommand(serveCmd)
	serveCmd.Flags().StringP("bind", "b", ":3000", "listen address for the server")
	serveCmd.Flags().Int("http_read_timeout", 120,
		"http server maximum duration in seconds for reading the entire request, including the body")
	serveCmd.Flags().Int("http_write_timeout",
		60,
		"http server maximum duration in seconds before timing out writes of the response.")

	serveCmd.Flags().StringP("tiles_directory", "d", "/var/tiles", "tiles directory")
	serveCmd.Flags().Int("vips_concurrency_limit", 2, "number of concurrent vips processes allowed")
	serveCmd.Flags().String("temp_dir", "/tmp", "directory used for temp directories")
	serveCmd.Flags().Int("vips_submit_timeout", 60,
		"maximum number of seconds to wait before a request is submittied to the vips run pool")

	viper.BindPFlag("bind", serveCmd.Flags().Lookup("bind"))
	viper.BindPFlag("http_read_timeout", serveCmd.Flags().Lookup("http_read_timeout"))
	viper.BindPFlag("http_write_timeout", serveCmd.Flags().Lookup("http_write_timeout"))
	viper.BindPFlag("tiles_directory", serveCmd.Flags().Lookup("tiles_directory"))
	viper.BindPFlag("vips_concurrency_limit", serveCmd.Flags().Lookup("vips_concurrency_limit"))
	viper.BindPFlag("temp_dir", serveCmd.Flags().Lookup("temp_dir"))
	viper.BindPFlag("vips_submit_timeout", serveCmd.Flags().Lookup("vips_submit_timeout"))
}
