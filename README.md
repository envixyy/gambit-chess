# ♞ Gambit — chess for you and your friends

A self-hosted multiplayer chess site. No accounts, no database, no build step — just Node.

## Run it

```bash
npm install
npm start
```

Open <http://localhost:3000>. The console also prints a `http://192.168.x.x:3000` address that
friends on the same Wi-Fi can use.

## Playing with friends over the internet

Pick one:

| Option | How |
| --- | --- |
| **Quick tunnel** (runs from your PC while it's on) | `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, then share the `https://…` link it prints |
| **Host it for free/cheap** (always on) | Deploy this folder to Render, Railway, Fly.io, etc. Build command `npm install`, start command `npm start`. It reads the `PORT` env var. WebSockets work out of the box |
| **Port-forward** | Forward TCP 3000 on your router to this PC and share `http://<your-public-ip>:3000` |

Ratings and game history are saved in `data/` (set `DATA_DIR` to move it). On hosts with an
ephemeral disk they reset on redeploy; attach a volume if you want them to persist.

## How to play

1. Pick a name, choose a time control and colour, press **Create game**.
2. Send the invite link to a friend. Whoever opens it takes the free seat; anyone after that spectates.
3. Tick **List in open games** to show the game on everyone's home page instead.

## Features

**Chess rules** — full FIDE rules: castling, en passant, promotion (incl. under-promotion), check,
checkmate, stalemate, threefold repetition, fifty-move rule, insufficient material. The server validates every move.

**Online play** — shareable invite links, spectators, live chat, server-side clocks with increment,
draw offers, takeback requests, rematch (colours swap), abort, resign, "claim win" if your opponent leaves,
and automatic reconnect (refresh the page and you're back in your seat).

**Quick play queue** — pick a time control and get paired automatically with someone near your rating (the search window starts at ±100 and widens by 25 per second, so nobody waits long even with few players online). Rated or casual pools.

**Ratings** — Elo (starts at 1200) for *rated* games, leaderboard, recent-games list with replay.

**Board** — click or drag, legal-move dots, premoves, right-click arrows and square highlights,
animated moves, move list with history navigation (← → Home End), opening names, captured pieces and
material count, flip board, 7 board themes, synthesized sound effects (no audio files), phone-friendly layout.

**Game review** — after any game (online, vs computer, or an imported PGN) press **Review**. The engine checks every move and labels it **Brilliant** (a good move that sacrifices material), **Great** (the only move that holds the position), Best, Excellent, Good, Book, Inaccuracy, Mistake or Blunder. You get an accuracy score per player, an eval graph (click to jump), badges on the board and move list, a green arrow showing the better move, and key-move buttons. Depth is Quick / Standard / Deep in Settings.

**Practice** — play the built-in computer (5 levels, with hints and undo), or open the
**analysis board**: engine evaluation bar, best-move arrow, import/export PGN and FEN, branch off any position.

## Keyboard

`←` `→` browse moves · `Home` / `End` first / latest · `F` flip · `Esc` cancel selection / premove

## Tests

```bash
npm test          # engine perft + rules, server end-to-end (incl. queue), AI, and review classification
```

## Layout

```
server.js          HTTP + WebSocket server (rooms, clocks, ratings, persistence)
public/chess.js    rules engine, shared by browser, worker and server
public/ai.js       search engine in a Web Worker (computer opponent, analysis, review)
public/review.js   move classification + accuracy (shared with the tests)
public/app.js      client: board, lobby, game UI
public/style.css   styling and board themes
public/openings.js opening-name table
```
