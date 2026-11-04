# 云寺 Cloud Temple

一座不说话的在线小寺。随机分配一个小沙弥和诗意法号，在大殿里走动、合十、礼拜、转念珠、敲木鱼。能看到别人，但不能聊天。

## Run

```bash
cd cloud-temple
npm start            # http://localhost:3000   (PORT / ROOM_CAP env vars optional)
```

No dependencies. Node >= 18.

## Structure

| File | What |
|---|---|
| `server.js` | HTTP server: static files, `GET /events` (SSE presence stream), `POST /action` (move/act), `GET /stats`. Rooms capped at `ROOM_CAP` (default 100). Global merit counter saved to `data.json`. |
| `public/index.html` | Gate screen + temple HUD |
| `public/style.css` | Styling, mobile layout |
| `public/app.js` | Canvas scene, chibi monks, animations, WebAudio (木鱼/钟/环境音, all synthesized), networking, localStorage for personal counts |

If the server isn't reachable (e.g. hosted as static files only), the client falls back to solo mode.

## Controls

- Click / tap floor to walk, or WASD / arrow keys
- `1` 合十 · `2` / Space 礼拜 · `3` 念珠 · `4` 木鱼
