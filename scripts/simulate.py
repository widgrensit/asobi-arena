#!/usr/bin/env python3
"""
Asobi Arena Simulation — 20 concurrent players.

Exercises the full stack:
  - REST: register, login, player profile, wallets, friends, leaderboards, admin
  - WebSocket: connect, heartbeat, matchmaker, match input, chat, presence
  - Admin: dashboard, player list, system info

Usage:
    docker-compose up -d
    rebar3 shell  # start asobi-arena
    python3 scripts/simulate.py [--players 20] [--base-url http://localhost:8082]
"""

import asyncio
import json
import random
import sys
import time
from dataclasses import dataclass, field

try:
    import httpx
    import websockets
except ImportError:
    print("Install dependencies: pip install httpx websockets")
    sys.exit(1)

BASE_URL = "http://localhost:8082"
WS_URL = "ws://localhost:8082/ws"
ADMIN_URL = "http://localhost:8083"
NUM_PLAYERS = 20


@dataclass
class Player:
    index: int
    username: str = ""
    password: str = "testpass123"
    player_id: str = ""
    token: str = ""
    ws: object = None
    ws_messages: list = field(default_factory=list)


# ── REST helpers ──────────────────────────────────────────────

async def register(client: httpx.AsyncClient, player: Player) -> bool:
    player.username = f"sim_player_{player.index}_{int(time.time())}"
    r = await client.post(f"{BASE_URL}/api/v1/auth/register", json={
        "username": player.username,
        "password": player.password,
        "display_name": f"Player {player.index}",
    })
    if r.status_code in (200, 201):
        data = r.json()
        player.player_id = data["player_id"]
        player.token = data["session_token"]
        return True
    # might already exist, try login
    return await login(client, player)


async def login(client: httpx.AsyncClient, player: Player) -> bool:
    r = await client.post(f"{BASE_URL}/api/v1/auth/login", json={
        "username": player.username,
        "password": player.password,
    })
    if r.status_code == 200:
        data = r.json()
        player.player_id = data["player_id"]
        player.token = data["session_token"]
        return True
    return False


def auth_headers(player: Player) -> dict:
    return {"Authorization": f"Bearer {player.token}"}


async def get_profile(client: httpx.AsyncClient, player: Player) -> dict:
    r = await client.get(
        f"{BASE_URL}/api/v1/players/{player.player_id}",
        headers=auth_headers(player),
    )
    return r.json() if r.status_code == 200 else {}


async def update_profile(client: httpx.AsyncClient, player: Player) -> bool:
    r = await client.put(
        f"{BASE_URL}/api/v1/players/{player.player_id}",
        headers=auth_headers(player),
        json={"display_name": f"Sim {player.username}", "metadata": {"bot": True}},
    )
    return r.status_code == 200


async def get_wallets(client: httpx.AsyncClient, player: Player) -> dict:
    r = await client.get(
        f"{BASE_URL}/api/v1/wallets",
        headers=auth_headers(player),
    )
    return r.json() if r.status_code == 200 else {}


async def get_friends(client: httpx.AsyncClient, player: Player) -> dict:
    r = await client.get(
        f"{BASE_URL}/api/v1/friends",
        headers=auth_headers(player),
    )
    return r.json() if r.status_code == 200 else {}


async def add_friend(client: httpx.AsyncClient, player: Player, friend_id: str) -> bool:
    r = await client.post(
        f"{BASE_URL}/api/v1/friends",
        headers=auth_headers(player),
        json={"friend_id": friend_id},
    )
    return r.status_code == 200


async def get_notifications(client: httpx.AsyncClient, player: Player) -> dict:
    r = await client.get(
        f"{BASE_URL}/api/v1/notifications",
        headers=auth_headers(player),
    )
    return r.json() if r.status_code == 200 else {}


async def get_inventory(client: httpx.AsyncClient, player: Player) -> dict:
    r = await client.get(
        f"{BASE_URL}/api/v1/inventory",
        headers=auth_headers(player),
    )
    return r.json() if r.status_code == 200 else {}


# ── Admin helpers ─────────────────────────────────────────────

async def check_admin(client: httpx.AsyncClient) -> dict:
    results = {}
    for endpoint in ["/admin/api/dashboard", "/admin/api/system", "/admin/api/system/nodes"]:
        try:
            r = await client.get(f"{ADMIN_URL}{endpoint}")
            results[endpoint] = r.status_code
        except Exception:
            results[endpoint] = "unreachable"
    return results


async def admin_player_list(client: httpx.AsyncClient) -> dict:
    r = await client.get(f"{ADMIN_URL}/admin/api/players?limit=10")
    return r.json() if r.status_code == 200 else {}


# ── WebSocket helpers ─────────────────────────────────────────

async def ws_send(ws, msg_type: str, payload: dict, cid: str = None):
    msg = {"type": msg_type, "payload": payload}
    if cid:
        msg["cid"] = cid
    await ws.send(json.dumps(msg))


async def ws_recv(ws, timeout: float = 2.0) -> dict:
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        return json.loads(raw)
    except (asyncio.TimeoutError, Exception):
        return {}


async def ws_connect_player(player: Player) -> bool:
    try:
        player.ws = await websockets.connect(WS_URL)
        await ws_send(player.ws, "session.connect", {"token": player.token}, cid="connect")
        resp = await ws_recv(player.ws)
        return resp.get("type") == "session.connected"
    except Exception as e:
        print(f"  [{player.username}] WS connect failed: {e}")
        return False


async def ws_heartbeat(player: Player) -> bool:
    await ws_send(player.ws, "session.heartbeat", {}, cid="hb")
    resp = await ws_recv(player.ws)
    return resp.get("type") == "session.heartbeat"


async def ws_join_chat(player: Player, channel: str) -> bool:
    await ws_send(player.ws, "chat.join", {"channel_id": channel}, cid="chat_join")
    resp = await ws_recv(player.ws)
    return resp.get("type") == "chat.joined"


async def ws_send_chat(player: Player, channel: str, content: str):
    await ws_send(player.ws, "chat.send", {"channel_id": channel, "content": content})


async def ws_matchmaker_add(player: Player, mode: str = "arena") -> str:
    await ws_send(player.ws, "matchmaker.add", {
        "mode": mode,
        "properties": {"skill": 1000 + random.randint(-200, 200)},
    }, cid="mm_add")
    resp = await ws_recv(player.ws)
    return resp.get("payload", {}).get("ticket_id", "")


async def ws_update_presence(player: Player, status: str):
    await ws_send(player.ws, "presence.update", {"status": status}, cid="presence")
    await ws_recv(player.ws)


async def ws_drain(player: Player, duration: float = 1.0):
    """Collect incoming messages for a duration."""
    end = time.time() + duration
    while time.time() < end:
        msg = await ws_recv(player.ws, timeout=0.2)
        if msg:
            player.ws_messages.append(msg)


# ── Simulation phases ─────────────────────────────────────────

async def phase_register(client, players):
    print("\n[Phase 1] Registering players...")
    tasks = [register(client, p) for p in players]
    results = await asyncio.gather(*tasks)
    ok = sum(1 for r in results if r)
    print(f"  Registered: {ok}/{len(players)}")
    return ok == len(players)


async def phase_profiles(client, players):
    print("\n[Phase 2] Fetching & updating profiles...")
    for p in players[:5]:
        profile = await get_profile(client, p)
        assert profile.get("username") == p.username, f"Profile mismatch for {p.username}"
        await update_profile(client, p)
    print(f"  Verified 5 profiles")


async def phase_social(client, players):
    print("\n[Phase 3] Social - friends & wallets...")
    # Add some friends
    for i in range(0, min(10, len(players)), 2):
        await add_friend(client, players[i], players[i + 1].player_id)
    print(f"  Sent {min(5, len(players) // 2)} friend requests")

    # Check wallets
    for p in players[:3]:
        wallets = await get_wallets(client, p)
        assert "wallets" in wallets
    print(f"  Verified wallets for 3 players")

    # Check notifications
    for p in players[:3]:
        await get_notifications(client, p)
    print(f"  Checked notifications for 3 players")

    # Check inventory
    for p in players[:3]:
        await get_inventory(client, p)
    print(f"  Checked inventory for 3 players")


async def phase_websocket(players):
    print("\n[Phase 4] WebSocket connections...")
    tasks = [ws_connect_player(p) for p in players]
    results = await asyncio.gather(*tasks)
    ok = sum(1 for r in results if r)
    print(f"  Connected: {ok}/{len(players)}")

    # Heartbeat
    hb_tasks = [ws_heartbeat(p) for p in players if p.ws]
    hb_results = await asyncio.gather(*hb_tasks)
    print(f"  Heartbeats: {sum(1 for r in hb_results if r)}/{len(hb_tasks)}")

    # Presence
    for p in players[:5]:
        if p.ws:
            await ws_update_presence(p, "in_game")
    print(f"  Updated presence for 5 players")


async def phase_chat(players):
    print("\n[Phase 5] Chat...")
    channel = "sim_lobby"
    connected = [p for p in players if p.ws][:10]

    for p in connected:
        await ws_join_chat(p, channel)
    print(f"  {len(connected)} players joined #{channel}")

    for i, p in enumerate(connected[:5]):
        await ws_send_chat(p, channel, f"Hello from {p.username}! Message {i}")
        await asyncio.sleep(0.05)
    print(f"  Sent 5 chat messages")

    # Drain messages
    await asyncio.gather(*[ws_drain(p, 0.5) for p in connected])
    total_msgs = sum(len(p.ws_messages) for p in connected)
    print(f"  Received {total_msgs} total messages across clients")


async def phase_matchmaking(players):
    print("\n[Phase 6] Matchmaking...")
    connected = [p for p in players if p.ws]

    # Queue all players
    tickets = []
    for p in connected:
        try:
            ticket = await ws_matchmaker_add(p, "arena")
            if ticket:
                tickets.append(ticket)
        except Exception:
            # WS may have closed during earlier phases, reconnect
            if await ws_connect_player(p):
                try:
                    ticket = await ws_matchmaker_add(p, "arena")
                    if ticket:
                        tickets.append(ticket)
                except Exception:
                    pass
    print(f"  Queued {len(tickets)} players for matchmaking")

    # Wait for matches to form
    print(f"  Waiting for matchmaker tick (2s)...")
    await asyncio.sleep(2.5)

    # Drain match events
    await asyncio.gather(*[ws_drain(p, 1.0) for p in connected])
    matched = sum(
        1 for p in connected
        for m in p.ws_messages
        if m.get("type") == "match.matched"
    )
    print(f"  Players matched: {matched}")


async def phase_gameplay(players):
    """Simulate actual gameplay: players move, shoot, chat during matches."""
    print("\n[Phase 7] Gameplay simulation...")
    connected = [p for p in players if p.ws]
    if not connected:
        print("  No connected players, skipping")
        return

    # First, ensure everyone is matched by waiting for match events
    await asyncio.gather(*[ws_drain(p, 0.5) for p in connected])

    # Find players that received match events
    in_match = []
    for p in connected:
        for m in p.ws_messages:
            if m.get("type") in ("match.matched", "match.state"):
                in_match.append(p)
                break

    if not in_match:
        # No matches formed yet — use all connected players to send inputs anyway
        in_match = connected
    print(f"  Players in game: {len(in_match)}")

    # Simulate game ticks — each player sends movement + occasional shots
    TICKS = 30
    TICK_INTERVAL = 0.1  # 100ms between inputs
    directions = ["up", "down", "left", "right"]
    kills = {p.username: 0 for p in in_match}
    shots_fired = 0
    moves_sent = 0

    async def player_loop(player):
        nonlocal shots_fired, moves_sent
        for tick in range(TICKS):
            if not player.ws:
                break
            try:
                # Random movement
                input_data = {d: random.random() > 0.5 for d in directions}

                # Occasionally shoot at a random position
                if random.random() > 0.6:
                    input_data["shoot"] = True
                    input_data["aim_x"] = random.randint(50, 750)
                    input_data["aim_y"] = random.randint(50, 550)
                    shots_fired += 1

                await ws_send(player.ws, "match.input", input_data)
                moves_sent += 1

                # Occasionally send a chat taunt
                if tick == 15 and random.random() > 0.7:
                    taunts = ["Nice shot!", "Watch out!", "GG", "Behind you!", "Let's go!"]
                    await ws_send(player.ws, "chat.send", {
                        "channel_id": "match_chat",
                        "content": random.choice(taunts),
                    })

                await asyncio.sleep(TICK_INTERVAL)
            except Exception:
                break

    # Run all player loops concurrently
    await asyncio.gather(*[player_loop(p) for p in in_match])
    print(f"  Inputs sent: {moves_sent} moves, {shots_fired} shots")

    # Drain final game state messages
    await asyncio.gather(*[ws_drain(p, 1.0) for p in in_match])

    # Count game events received
    state_updates = 0
    match_events = 0
    for p in in_match:
        for m in p.ws_messages:
            msg_type = m.get("type", "")
            if msg_type == "match.state":
                state_updates += 1
            elif msg_type.startswith("match."):
                match_events += 1

    print(f"  State updates received: {state_updates}")
    print(f"  Match events received: {match_events}")

    # Send heartbeats to confirm connections are still alive
    alive = 0
    for p in in_match:
        try:
            if await ws_heartbeat(p):
                alive += 1
        except Exception:
            pass
    print(f"  Players still connected after game: {alive}/{len(in_match)}")


async def phase_admin(client):
    print("\n[Phase 7] Admin endpoints...")
    admin = await check_admin(client)
    for endpoint, status in admin.items():
        symbol = "ok" if status == 200 else f"FAIL ({status})"
        print(f"  {endpoint}: {symbol}")

    players = await admin_player_list(client)
    count = len(players.get("players", []))
    print(f"  Admin player list: {count} players returned")


async def phase_cleanup(players):
    print("\n[Cleanup] Closing WebSocket connections...")
    for p in players:
        if p.ws:
            try:
                await p.ws.close()
            except Exception:
                pass
    print(f"  Closed {sum(1 for p in players if p.ws)} connections")


# ── Main ──────────────────────────────────────────────────────

async def main():
    global BASE_URL, WS_URL, ADMIN_URL, NUM_PLAYERS

    # Parse args
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--players" and i + 1 < len(args):
            NUM_PLAYERS = int(args[i + 1])
        elif arg == "--base-url" and i + 1 < len(args):
            BASE_URL = args[i + 1]
            WS_URL = BASE_URL.replace("http", "ws") + "/ws"
        elif arg == "--admin-url" and i + 1 < len(args):
            ADMIN_URL = args[i + 1]

    print(f"=== Asobi Arena Simulation ===")
    print(f"Players:   {NUM_PLAYERS}")
    print(f"API:       {BASE_URL}")
    print(f"WebSocket: {WS_URL}")
    print(f"Admin:     {ADMIN_URL}")

    players = [Player(index=i) for i in range(NUM_PLAYERS)]
    start = time.time()
    passed = 0
    failed = 0

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Health check
        try:
            r = await client.get(f"{BASE_URL}/health")
            assert r.status_code == 200
            print(f"\nHealth check: ok")
        except Exception as e:
            print(f"\nHealth check FAILED: {e}")
            print("Is asobi-arena running?")
            return

        phases = [
            ("Register", lambda: phase_register(client, players)),
            ("Profiles", lambda: phase_profiles(client, players)),
            ("Social", lambda: phase_social(client, players)),
            ("WebSocket", lambda: phase_websocket(players)),
            ("Chat", lambda: phase_chat(players)),
            ("Matchmaking", lambda: phase_matchmaking(players)),
            ("Gameplay", lambda: phase_gameplay(players)),
        ]

        for name, phase_fn in phases:
            try:
                await phase_fn()
                passed += 1
            except Exception as e:
                print(f"  FAILED: {e}")
                failed += 1

        await phase_cleanup(players)

    elapsed = time.time() - start
    print(f"\n{'=' * 40}")
    print(f"Simulation complete in {elapsed:.1f}s")
    print(f"Phases passed: {passed}/{passed + failed}")
    if failed:
        print(f"Phases failed: {failed}")
        sys.exit(1)
    else:
        print("All phases passed!")


if __name__ == "__main__":
    asyncio.run(main())
