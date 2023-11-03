package api

import (
	"bufio"
	"context"
	"fmt"
	log "github.com/sirupsen/logrus"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

type VipsRunEvent struct {
	OutputDir    string `json:"output_dir" binding:"required"`
	TiffFilename string `json:"filename" binding:"required"`
}

func StartVipsPool(settings *Settings) {
	for {
		select {
		case event := <-settings.vipsPool:
			log.Debugf("Vips event %s", event.TiffFilename)
			VipsProcess(settings, event)
		case <-(*settings.globalContext).Done():
			log.Info("Stopping Build Pool")
			return
		}
	}
}

const (
	bufferReadSize = 8192
)

func bufferReader(buff *bufio.Reader, report chan<- string, wg *sync.WaitGroup) {
	for {
		ob := make([]byte, bufferReadSize)
		n, err := buff.Read(ob)
		if err != nil {
			if err != io.EOF {
				fmt.Printf("stderr eof\n")
			}
			wg.Done()
			return
		}
		report <- string(ob[0:n])
	}
}

func VipsProcess(settings *Settings, event VipsRunEvent) {

	log.Debugf("vips name %s", event.TiffFilename)

	args := []string{
		"dzsave",
		filepath.Join(event.OutputDir, event.TiffFilename),
		event.OutputDir,
		"--overlap",
		"0",
		"--tile-size",
		"512",
		"--layout",
		"google",
		"--suffix",
		".png",
	}

	cmd := exec.Command("vips", args...)

	o, _ := cmd.StdoutPipe()
	e, _ := cmd.StderrPipe()
	outbuf := bufio.NewReader(o)
	errbuf := bufio.NewReader(e)

	var wg sync.WaitGroup
	var outputWg sync.WaitGroup

	progress := make(chan string)

	ctx, cancel := context.WithCancel(context.Background())
	outputWg.Add(1)
	sb := strings.Builder{}

	go func(builder *strings.Builder) {
		// Capture stdout / stderr to string
		for {
			select {
			case s := <-progress:
				//TODO: report realtime progress
				builder.WriteString(s)
			case <-ctx.Done():
				outputWg.Done()
				return
			}
		}
	}(&sb)

	wg.Add(1)
	go bufferReader(outbuf, progress, &wg)
	wg.Add(1)
	go bufferReader(errbuf, progress, &wg)

	err := cmd.Start()
	if err != nil {
		log.Errorf("Error starting cmd %+v", err)
		return
	}
	wg.Wait()
	cancel()
	outputWg.Wait()

	if err := cmd.Wait(); err != nil {
		if exiterr, ok := err.(*exec.ExitError); ok {
			log.Errorf("Non-zero exit status: %d", exiterr.ExitCode())
		} else {
			log.Errorf("Error cmd.Wait: %v", err)
			return
		}
	}
	//todo: send results somewhere rather than just the log
	log.Debugf("Vips dir: %s\noutput: %s", event.OutputDir, sb.String())
}
