package viewer

import (
	"sort"
	"strings"
)

type GroupOption struct {
	Name string `json:"name"`
	ID   string `json:"id"`
}

type groupOptions struct {
	named map[string]GroupOption
	names map[string]string
}

func newGroupOptions() *groupOptions {
	return &groupOptions{named: map[string]GroupOption{}, names: map[string]string{}}
}

func (g *groupOptions) add(name, id string) {
	if strings.TrimSpace(name) == "" {
		return
	}
	if id == "" {
		g.names[name] = name
		return
	}
	if _, exists := g.named[id]; !exists {
		g.named[id] = GroupOption{Name: name, ID: id}
	}
}

func (g *groupOptions) sorted() []GroupOption {
	var options []GroupOption
	knownNames := map[string]bool{}
	for _, option := range g.named {
		options = append(options, option)
		knownNames[option.Name] = true
	}
	for name := range g.names {
		if !knownNames[name] {
			options = append(options, GroupOption{Name: name})
		}
	}
	sort.Slice(options, func(i, j int) bool {
		left, right := strings.ToLower(options[i].Name), strings.ToLower(options[j].Name)
		if left == right {
			return options[i].ID < options[j].ID
		}
		return left < right
	})
	return options
}
