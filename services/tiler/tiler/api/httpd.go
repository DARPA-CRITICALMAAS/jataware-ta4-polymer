package api

import (
	"fmt"

	"math"
	"net/http"

	"os"
	"strings"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"path/filepath"
	"time"
)

func allowCors() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if len(origin) == 0 {
			// request is not a CORS request
			return
		}

		c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == http.MethodOptions {
			//preflight
			c.Writer.Header().Set("Access-Control-Allow-Methods",
				strings.Join([]string{http.MethodPost, http.MethodGet, http.MethodPut, http.MethodOptions, http.MethodDelete},
					", "))

			c.Writer.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
			// Using 204 is better than 200 when the request status is OPTIONS
			defer c.AbortWithStatus(http.StatusNoContent)
		}
	}
}

func health() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	}
}

func ginErrorString(a []*gin.Error) string {
	if len(a) == 0 {
		return ""
	}
	var buffer strings.Builder
	for i, msg := range a {
		if i > 0 {
			fmt.Fprintf(&buffer, "\n")
		}
		fmt.Fprintf(&buffer, "Error #%02d: %s", i+1, msg.Err)
		if msg.Meta != nil {
			fmt.Fprintf(&buffer, "\n")
			fmt.Fprintf(&buffer, "     Meta: %v", msg.Meta)
		}
	}
	return buffer.String()
}

func loggerMiddleware(notLogged ...string) gin.HandlerFunc {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}

	var skip map[string]struct{}

	if length := len(notLogged); length > 0 {
		skip = make(map[string]struct{}, length)

		for _, p := range notLogged {
			skip[p] = struct{}{}
		}
	}

	return func(c *gin.Context) {
		// other handler can change c.Path so:
		path := c.Request.URL.Path
		start := time.Now()
		c.Next()
		stop := time.Since(start)
		latency := int(math.Ceil(float64(stop.Nanoseconds()) / 1000000.0))
		statusCode := c.Writer.Status()
		clientIP := c.ClientIP()
		clientUserAgent := c.Request.UserAgent()
		referer := c.Request.Referer()
		dataLength := c.Writer.Size()
		if dataLength < 0 {
			dataLength = 0
		}

		if _, ok := skip[path]; ok {
			return
		}

		var timeFormat = "02/Jan/2006:15:04:05 -0700"

		if len(c.Errors) > 0 {
			log.Errorf("%s - %s \"%s %s\" - %s", clientIP, hostname, c.Request.Method, path, ginErrorString(c.Errors.ByType(gin.ErrorTypeAny)))
		}

		msg := fmt.Sprintf("%s - %s [%s] \"%s %s\" %d %d \"%s\" \"%s\" (%dms)", clientIP, hostname, time.Now().Format(timeFormat), c.Request.Method, path, statusCode, dataLength, referer, clientUserAgent, latency)
		if statusCode >= http.StatusInternalServerError {
			log.Error(msg)
		} else if statusCode >= http.StatusBadRequest {
			log.Warn(msg)
		} else {
			log.Info(msg)
		}
	}
}

func uploadTiff(settings *Settings) gin.HandlerFunc {
	return func(c *gin.Context) {

		tiff, err := c.FormFile("tiff")
		if err != nil {
			c.String(http.StatusBadRequest, fmt.Sprintf("tiff err : %s", err.Error()))
			return
		}

		tiffFilename := filepath.Base(tiff.Filename)
		name := strings.TrimSuffix(tiff.Filename, filepath.Ext(tiff.Filename))
		outputDir := filepath.Join(settings.TilesDirectory, name)

		if err := os.Mkdir(outputDir, 0755); err != nil && !os.IsExist(err) {
			log.Errorf("error creating tmp directory")
			c.String(http.StatusInternalServerError, "error creating tmp directory")
			return
		}

		tiffFile := filepath.Join(outputDir, tiffFilename)
		if err := c.SaveUploadedFile(tiff, tiffFile); err != nil {
			c.String(http.StatusBadRequest, "upload file err: %s", err.Error())
			return
		}

		vipsRunEvent := VipsRunEvent{
			OutputDir:    outputDir,
			TiffFilename: tiffFilename,
		}

		select {
		case settings.vipsPool <- vipsRunEvent:
		case <-time.After(settings.VipsSubmitTimeout * time.Second):
			c.String(http.StatusInternalServerError,
				"Request timed out processing vips. Server maybe too busy processing previous requests")
			return
		}
		c.Status(http.StatusAccepted)
	}
}

func listTiles(settings *Settings) gin.HandlerFunc {
	return func(c *gin.Context) {

		des, err := os.ReadDir(settings.TilesDirectory)
		if err != nil {
			log.Errorf("Error reading tiles directory %+v", err)
			c.String(http.StatusInternalServerError, fmt.Sprintf("%+v", err))
			return
		}

		tiles := []string{}

		for _, de := range des {
			if de.IsDir() {
				tiles = append(tiles, de.Name())
			}
		}
		c.JSON(http.StatusOK, gin.H{"tiles": tiles})
	}
}

func SetupRoutes(settings *Settings) *gin.Engine {
	router := gin.New()
	router.Use(allowCors())
	router.Use(loggerMiddleware("/health"), gin.Recovery())
	router.GET("/health", health())
	tilesGroup := router.Group("/tiles")
	{
		tilesGroup.GET("/", listTiles(settings))
		tilesGroup.POST("/upload", uploadTiff(settings))
	}
	return router
}
