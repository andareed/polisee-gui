package main

import (
	"os"
	"runtime"
)

// configureWebView runs before GTK/WebKit startup so the renderer and its child
// processes see the setting. Keep this in the application, rather than run.sh,
// so direct binary launches and make run receive the same workaround.
func configureWebView() error {
	if runtime.GOOS != "linux" {
		return nil
	}
	if _, specified := os.LookupEnv("WEBKIT_DISABLE_DMABUF_RENDERER"); specified {
		return nil
	}
	if _, err := os.Stat("/sys/module/nvidia"); err != nil {
		return nil
	}
	// WebKitGTK's DMA-BUF path can fail on NVIDIA with a blank window or a
	// Wayland protocol error on first paint. This follows Wails v3's workaround:
	// https://v3.wails.io/guides/build/linux/#blank-or-white-window-on-nvidia-gpu
	return os.Setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
}
