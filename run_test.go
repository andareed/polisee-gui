package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestLauncherRebuildsAnExistingBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("run.sh is a Unix launcher")
	}
	launcher, err := os.ReadFile("run.sh")
	if err != nil {
		t.Fatal(err)
	}
	for _, failedBuild := range []bool{false, true} {
		name := "updated-source"
		if failedBuild {
			name = "failed-build"
		}
		t.Run(name, func(t *testing.T) {
			directory := t.TempDir()
			if err := os.Mkdir(filepath.Join(directory, "bin"), 0700); err != nil {
				t.Fatal(err)
			}
			makeScript := "#!/bin/sh\n[ \"$1\" = build ] || exit 2\ncp ./current-build ./bin/polisee-gui\n"
			if failedBuild {
				makeScript = "#!/bin/sh\nexit 9\n"
			}
			for path, content := range map[string]string{
				"run.sh": string(launcher), "make": makeScript,
				"current-build":   "#!/bin/sh\nprintf 'current frontend\\n'\n",
				"bin/polisee-gui": "#!/bin/sh\nprintf 'stale frontend\\n'\n",
			} {
				if err := os.WriteFile(filepath.Join(directory, path), []byte(content), 0700); err != nil {
					t.Fatal(err)
				}
			}
			command := exec.Command("bash", filepath.Join(directory, "run.sh"))
			command.Env = append(os.Environ(), "PATH="+directory+string(os.PathListSeparator)+os.Getenv("PATH"))
			output, err := command.CombinedOutput()
			if failedBuild {
				if err == nil || len(output) != 0 {
					t.Fatalf("failed build launched a stale app: %s, %v", output, err)
				}
			} else if err != nil || strings.TrimSpace(string(output)) != "current frontend" {
				t.Fatalf("launcher did not rebuild existing binary: %s, %v", output, err)
			}
		})
	}
}

// Exercise real Git and Go resolution: the worktree has no sibling library or
// usable symlink, but the primary checkout does have its normal sibling module.
func TestWorktreeLauncherResolvesLibraryWithoutSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the local Go wrapper is a Unix launcher")
	}
	wrapper, err := os.ReadFile("scripts/go-local.sh")
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "code.sandbox")
	projectGroup := filepath.Join(root, "polisee")
	primary := filepath.Join(projectGroup, "polisee-gui")
	library := filepath.Join(projectGroup, "polisee-lib")
	worktree := filepath.Join(root, ".worktrees", "polisee-gui", "launcher-test")
	write := func(path, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0700); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(primary, "go.mod"), "module example.com/viewer\n\ngo 1.25.0\n")
	write(filepath.Join(library, "go.mod"), "module github.com/andareed/polisee-lib\n\ngo 1.24.0\n")
	write(filepath.Join(library, "lib.go"), "package polisee\n")
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", args...)
		command.Dir = primary
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s: %v", args, output, err)
		}
	}
	git("init", "--quiet")
	git("-c", "user.name=Launcher Test", "-c", "user.email=launcher@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "fixture")
	git("worktree", "add", "--quiet", "--detach", worktree)
	write(filepath.Join(worktree, "go.mod"), "module example.com/viewer\n\ngo 1.25.0\n\nrequire github.com/andareed/polisee-lib v0.0.0\n\nreplace github.com/andareed/polisee-lib => ../polisee-lib\n")
	write(filepath.Join(worktree, "scripts", "go-local.sh"), string(wrapper))
	lookup := func(workspace, expected string) {
		t.Helper()
		command := exec.Command("bash", filepath.Join(worktree, "scripts", "go-local.sh"), "list", "-mod=readonly", "-f", "{{.Dir}}", "github.com/andareed/polisee-lib")
		command.Dir = worktree
		command.Env = append(os.Environ(), "GOWORK="+workspace, "GOPROXY=off", "GOSUMDB=off", "GOTOOLCHAIN=local")
		output, err := command.CombinedOutput()
		if err != nil || strings.TrimSpace(string(output)) != expected {
			t.Fatalf("library resolution: %s, %v; want %s", output, err, expected)
		}
	}
	lookup("auto", library)
	generated := filepath.Join(root, ".agent-work", "polisee-gui", "launcher-test", "go.work")
	if _, err := os.Stat(generated); err != nil {
		t.Fatalf("workspace was not generated under the task artifact directory: %v", err)
	}
	// Repeat the cold-start command and honor an explicitly chosen workspace.
	lookup("auto", library)
	alternate := filepath.Join(root, "alternate-lib")
	write(filepath.Join(alternate, "go.mod"), "module github.com/andareed/polisee-lib\n\ngo 1.24.0\n")
	write(filepath.Join(alternate, "lib.go"), "package polisee\n")
	custom := filepath.Join(root, "custom.work")
	write(custom, "go 1.25.0\nuse "+strconv.Quote(worktree)+"\nreplace github.com/andareed/polisee-lib => "+strconv.Quote(alternate)+"\n")
	lookup(custom, alternate)
}
