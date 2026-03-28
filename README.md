# Asobi Arena

A multiplayer top-down arena shooter built on [Asobi](https://github.com/widgrensit/asobi) game backend.

This project demonstrates how to build a game on Asobi: implement the `asobi_match` behaviour with your game logic, configure it as a game mode, and you have a fully featured multiplayer backend with auth, matchmaking, leaderboards, and more.

## Quick Start

```sh
# Start PostgreSQL
docker compose up -d

# Fetch dependencies and run
rebar3 shell
```

The server starts on `http://localhost:8080`. Asobi provides all the REST and WebSocket endpoints automatically.

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

## Unity Client

See [asobi-unity-demo](https://github.com/widgrensit/asobi-unity-demo) for the Unity client.

## Configuration

Game mode registration in `config/dev_sys.config.src`:

```erlang
{asobi, [
    {game_modes, #{
        <<"arena">> => asobi_arena_game
    }}
]}
```
