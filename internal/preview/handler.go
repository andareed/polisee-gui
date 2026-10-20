// Package preview exposes the same Go service for local browser verification.
package preview

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/andareed/polisee-gui/frontend"
	"github.com/andareed/polisee-gui/internal/viewer"
	"github.com/andareed/polisee-lib"
)

func Handler(service *viewer.Service) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/demo", func(w http.ResponseWriter, r *http.Request) {
		result, err := service.LoadDemo()
		respond(w, result, err)
	})
	mux.HandleFunc("POST /api/import", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Name string `json:"name"`
			Text string `json:"text"`
		}
		if err := decode(w, r, &request); err != nil {
			respond(w, nil, err)
			return
		}
		result, err := service.LoadXML(request.Name, request.Text)
		respond(w, result, err)
	})
	mux.HandleFunc("POST /api/search", func(w http.ResponseWriter, r *http.Request) {
		var query polisee.Query
		if err := decode(w, r, &query); err != nil {
			respond(w, nil, err)
			return
		}
		result, err := service.Search(query)
		respond(w, result, err)
	})
	mux.HandleFunc("POST /api/rule", func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ID string `json:"id"`
		}
		if err := decode(w, r, &request); err != nil {
			respond(w, nil, err)
			return
		}
		result, err := service.GetRule(request.ID)
		respond(w, result, err)
	})
	mux.HandleFunc("POST /api/segments", func(w http.ResponseWriter, r *http.Request) {
		var query viewer.BrowseQuery
		if err := decode(w, r, &query); err != nil {
			respond(w, nil, err)
			return
		}
		result, err := service.Segments(query)
		respond(w, result, err)
	})
	mux.HandleFunc("POST /api/ranges", func(w http.ResponseWriter, r *http.Request) {
		var query viewer.BrowseQuery
		if err := decode(w, r, &query); err != nil {
			respond(w, nil, err)
			return
		}
		result, err := service.Ranges(query)
		respond(w, result, err)
	})
	mux.Handle("/", http.FileServer(http.FS(frontend.Assets)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
			http.Error(w, "unexpected origin", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		mux.ServeHTTP(w, r)
	})
}

func decode(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 2*viewer.MaxPolicyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("expected one JSON request")
	}
	return nil
}

func respond(w http.ResponseWriter, value any, err error) {
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(value)
}
