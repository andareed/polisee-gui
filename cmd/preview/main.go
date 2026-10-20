package main

import (
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/andareed/polisee-gui/internal/preview"
	"github.com/andareed/polisee-gui/internal/viewer"
)

func main() {
	port := flag.Int("port", 47831, "local preview port")
	flag.Parse()
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Polisee preview: http://" + listener.Addr().String())
	server := &http.Server{Handler: preview.Handler(viewer.New()), ReadHeaderTimeout: 5 * time.Second}
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
