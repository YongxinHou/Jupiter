// 云寺 Cloud Temple — realtime server (Go standard library only).
// Static files embedded from ./public, presence via Server-Sent Events, actions via POST.
package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	mrand "math/rand/v2"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

//go:embed public
var publicFS embed.FS

const (
	worldW     = 1000.0
	worldH     = 700.0
	floorY     = 330.0
	dataFile   = "data.json"
	numWheels  = 8 // must match the wheels array in public/app.js
	numIncense = 5 // must match INCENSE in public/app.js
)

var (
	adj   = []string{"悠闲的", "淡淡的", "安静的", "慢慢的", "清晨的", "微凉的", "远山的", "不急的", "温柔的", "空空的", "轻轻的", "午后的"}
	noun  = []string{"云", "月光", "松风", "溪水", "竹影", "雨声", "晨钟", "落叶", "灯火", "山雾", "石阶", "茶烟"}
	robes = []string{"#8a8f98", "#b5763a", "#6b7b5e", "#7d6a8c", "#a65e4e", "#5f7f91"}
)

type Stats struct {
	Bows         int `json:"bows"`
	Palms        int `json:"palms"`
	Beads        int `json:"beads"`
	Prostrations int `json:"prostrations"`
	Incense      int `json:"incense"`
	Wheels       int `json:"wheels"`
	Online       int `json:"online"`
	Here         int `json:"here,omitempty"`
}

type PubPlayer struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Robe string  `json:"robe"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

type Player struct {
	PubPlayer
	token    string
	room     int
	out      chan []byte // serialized SSE frames, drained by the connection goroutine
	lastMove time.Time
	lastAct  time.Time
}

type Temple struct {
	mu      sync.Mutex
	roomCap int
	rooms   []map[string]*Player // index = room id - 1
	players map[string]*Player
	stats   Stats
	dirty   bool
}

func newTemple(roomCap int) *Temple {
	t := &Temple{roomCap: roomCap, players: map[string]*Player{}}
	if b, err := os.ReadFile(dataFile); err == nil {
		_ = json.Unmarshal(b, &t.stats)
	}
	return t
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func pick(a []string) string { return a[mrand.IntN(len(a))] }

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func frame(event string, data any) []byte {
	b, _ := json.Marshal(data)
	return []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", event, b))
}

// send never blocks: a client too slow to keep up just drops frames.
func (p *Player) send(f []byte) {
	select {
	case p.out <- f:
	default:
	}
}

// broadcast must be called with t.mu held.
func (t *Temple) broadcast(room int, f []byte, exceptID string) {
	for id, p := range t.rooms[room-1] {
		if id != exceptID {
			p.send(f)
		}
	}
}

func (t *Temple) join() *Player {
	t.mu.Lock()
	defer t.mu.Unlock()

	room := 0
	for i, r := range t.rooms {
		if len(r) < t.roomCap {
			room = i + 1
			break
		}
	}
	if room == 0 {
		t.rooms = append(t.rooms, map[string]*Player{})
		room = len(t.rooms)
	}

	p := &Player{
		PubPlayer: PubPlayer{
			ID:   randHex(6),
			Name: pick(adj) + pick(noun),
			Robe: pick(robes),
			X:    400 + mrand.Float64()*200,
			Y:    520 + mrand.Float64()*80,
		},
		token: randHex(16),
		room:  room,
		out:   make(chan []byte, 64),
	}

	others := make([]PubPlayer, 0, len(t.rooms[room-1]))
	for _, o := range t.rooms[room-1] {
		others = append(others, o.PubPlayer)
	}
	t.rooms[room-1][p.ID] = p
	t.players[p.ID] = p

	st := t.stats
	st.Online = len(t.players)
	p.send(frame("welcome", map[string]any{
		"me": struct {
			PubPlayer
			Token string `json:"token"`
		}{p.PubPlayer, p.token},
		"room":    room,
		"players": others,
		"stats":   st,
	}))
	t.broadcast(room, frame("join", p.PubPlayer), p.ID)
	return p
}

func (t *Temple) leave(p *Player) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.rooms[p.room-1], p.ID)
	delete(t.players, p.ID)
	t.broadcast(p.room, frame("leave", map[string]string{"id": p.ID}), p.ID)
}

func (t *Temple) handleEvents(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")

	p := t.join()
	defer t.leave(p)

	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case f := <-p.out:
			if _, err := w.Write(f); err != nil {
				return
			}
			fl.Flush()
		case <-ping.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

func (t *Temple) handleAction(w http.ResponseWriter, r *http.Request) {
	var msg struct {
		ID    string  `json:"id"`
		Token string  `json:"token"`
		Type  string  `json:"type"`
		X     float64 `json:"x"`
		Y     float64 `json:"y"`
		Act   string  `json:"act"`
		N     int     `json:"n"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&msg); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	p := t.players[msg.ID]
	if p == nil || p.token != msg.Token {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	now := time.Now()
	switch msg.Type {
	case "move":
		if now.Sub(p.lastMove) > 80*time.Millisecond {
			p.lastMove = now
			p.X = clamp(msg.X, 40, worldW-40)
			p.Y = clamp(msg.Y, floorY, worldH-30)
			t.broadcast(p.room, frame("move", map[string]any{"id": p.ID, "x": p.X, "y": p.Y}), p.ID)
		}
	case "act":
		if now.Sub(p.lastAct) > 400*time.Millisecond {
			counted := true
			switch msg.Act {
			case "bow":
				t.stats.Bows++
			case "palm":
				t.stats.Palms++
			case "beads":
				if msg.N < 1 || msg.N > 108 {
					counted = false
				} else {
					t.stats.Beads++
				}
			case "prostrate":
				t.stats.Bows++
				t.stats.Prostrations++
			case "incense":
				if msg.N < 0 || msg.N >= numIncense {
					counted = false
				} else {
					t.stats.Incense++
				}
			case "wheel":
				if msg.N < 0 || msg.N >= numWheels {
					counted = false
				} else {
					t.stats.Wheels++
				}
			default:
				counted = false
			}
			if counted {
				p.lastAct = now
				t.dirty = true
				t.broadcast(p.room, frame("act", map[string]any{"id": p.ID, "act": msg.Act, "n": msg.N}), p.ID)
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (t *Temple) handleStats(w http.ResponseWriter, _ *http.Request) {
	t.mu.Lock()
	st := t.stats
	st.Online = len(t.players)
	t.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(st)
}

// background: push live stats every 3s, persist the counter every 5s.
func (t *Temple) loop() {
	statsTick := time.NewTicker(3 * time.Second)
	saveTick := time.NewTicker(5 * time.Second)
	for {
		select {
		case <-statsTick.C:
			t.mu.Lock()
			for i, r := range t.rooms {
				st := t.stats
				st.Online = len(t.players)
				st.Here = len(r)
				t.broadcast(i+1, frame("stats", st), "")
			}
			t.mu.Unlock()
		case <-saveTick.C:
			t.mu.Lock()
			if !t.dirty {
				t.mu.Unlock()
				continue
			}
			t.dirty = false
			b, _ := json.Marshal(t.stats)
			t.mu.Unlock()
			if err := os.WriteFile(dataFile, b, 0o644); err != nil {
				log.Println("save:", err)
			}
		}
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	roomCap, _ := strconv.Atoi(os.Getenv("ROOM_CAP"))
	if roomCap <= 0 {
		roomCap = 100
	}

	t := newTemple(roomCap)
	go t.loop()

	static, _ := fs.Sub(publicFS, "public")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /events", t.handleEvents)
	mux.HandleFunc("POST /action", t.handleAction)
	mux.HandleFunc("GET /stats", t.handleStats)
	mux.Handle("GET /", http.FileServerFS(static))

	log.Printf("云寺 running at http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
