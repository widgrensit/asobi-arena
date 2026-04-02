# Asobi Arena

A multiplayer top-down arena shooter built on [Asobi](https://github.com/widgrensit/asobi) game backend.

This project demonstrates how to build a game on Asobi: implement the `asobi_match` behaviour with your game logic, configure it as a game mode, and you have a fully featured multiplayer backend with auth, matchmaking, leaderboards, and more.

## Try it

```sh
git clone https://github.com/widgrensit/asobi_arena.git
cd asobi_arena
make start
```

That's it. `make start` checks your environment, starts PostgreSQL, compiles, and launches the server on `http://localhost:8084`.

### What if I'm missing something?

`make start` will tell you exactly what's missing and how to install it:

```
  ✗ Erlang/OTP not found
  ✓ Docker
  ✗ rebar3 not found

Missing dependencies. Install them with:

  # Option 1: mise (recommended)
  curl https://mise.run | sh
  mise install
```

### Available commands

```sh
make start       # Check deps + start db + compile + run
make setup       # First-time setup (fetch deps, start db, compile)
make check-deps  # Just verify your environment
make db          # Start PostgreSQL only
make shell       # Interactive Erlang shell
make stop        # Stop PostgreSQL
make clean       # Remove build artifacts
```

## Requirements

- Erlang/OTP 28+ and rebar3 (use [mise](https://mise.run) or see `.tool-versions`)
- Docker and Docker Compose (for PostgreSQL)

## Game Logic

The entire game is one module — `asobi_arena_game.erl` — implementing `asobi_match`:

| Callback | Purpose |
|----------|---------|
| `init/1` | Set up arena state (empty players, no projectiles) |
| `join/2` | Spawn player at random position with 100 HP |
| `leave/2` | Remove player from state |
| `handle_input/3` | Process WASD movement + mouse aim/shoot |
| `tick/1` | Move projectiles, check collisions, apply damage |
| `get_state/2` | Return visible state for each player |

The match server runs at 10 ticks/second and broadcasts state to all connected players via WebSocket.

## Game Rules

- 800x600 arena, 90-second rounds
- WASD movement, point-and-click shooting
- 25 damage per hit, 100 HP per player
- Match ends when time runs out or one player remains
- Winner = most kills

## Client SDKs

Connect with any of the [Asobi SDKs](https://asobi.dev):

- [Unity demo](https://github.com/widgrensit/asobi-unity-demo) — ready-to-play Unity client
- [Godot](https://github.com/widgrensit/asobi-godot)
- [Defold](https://github.com/widgrensit/asobi-defold)
- [Dart / Flutter](https://github.com/widgrensit/asobi-dart)
- [JavaScript](https://github.com/widgrensit/asobi-js)
- [Unreal](https://github.com/widgrensit/asobi-unreal)

## Configuration

Game mode registration in `config/dev_sys.config.src`:

```erlang
{asobi, [
    {game_modes, #{
        <<"arena">> => asobi_arena_game
    }}
]}
```
