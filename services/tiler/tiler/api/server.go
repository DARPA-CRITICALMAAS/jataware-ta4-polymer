package api

import (
	//"context"
	"net/http"
	"time"

	"context"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

type Settings struct {
	Addr                 string
	HttpReadTimeout      int
	HttpWriteTimeout     int
	TilesDirectory       string
	VipsConcurrencyLimit int
	TempDir              string
	VipsSubmitTimeout    time.Duration
	vipsPool             chan VipsRunEvent
	globalContext        *context.Context
	globalContextCancel  *context.CancelFunc
}

func setup(settings *Settings) *gin.Engine {
	ctx, cancel := context.WithCancel(context.Background())
	settings.globalContext = &ctx
	settings.globalContextCancel = &cancel
	settings.vipsPool = make(chan VipsRunEvent, settings.VipsConcurrencyLimit)
	go StartVipsPool(settings)
	engine := SetupRoutes(settings)
	return engine
}

func Run(settings *Settings) {
	log.Infof("Listening on %s", settings.Addr)
	router := setup(settings)

	s := &http.Server{
		Addr:           settings.Addr,
		Handler:        router,
		ReadTimeout:    time.Duration(settings.HttpReadTimeout) * time.Second,
		WriteTimeout:   time.Duration(settings.HttpWriteTimeout) * time.Second,
		MaxHeaderBytes: 1 << 20,
	}
	s.SetKeepAlivesEnabled(false)
	log.Fatal(s.ListenAndServe())
}
