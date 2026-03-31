-module(asobi_bench).
%% Connection benchmark for Asobi game backend.
%% Usage:   asobi_bench:run(100).
%%          asobi_bench:run(1000, #{host => "10.0.0.5", port => 8084}).

-export([run/1, run/2]).
-eqwalizer(fixme).

-define(DEFAULT_HOST, "localhost").
-define(DEFAULT_PORT, 8084).
-define(TICK_INTERVAL, 100).
-define(GAME_TICKS, 50).
-define(BATCH_SIZE, 25).
-define(BATCH_DELAY, 100).

%%----------------------------------------------------------------------
%% Public API
%%----------------------------------------------------------------------

run(NumPlayers) ->
    run(NumPlayers, #{}).

run(NumPlayers, Opts) ->
    {ok, _} = application:ensure_all_started(gun),
    Host = maps:get(host, Opts, ?DEFAULT_HOST),
    Port = maps:get(port, Opts, ?DEFAULT_PORT),
    GameTicks = maps:get(game_ticks, Opts, ?GAME_TICKS),

    io:format(~"~n=== Asobi Connection Benchmark ===~n"),
    io:format(~"Target: ~s:~p~n", [Host, Port]),
    io:format(~"Players: ~p~n", [NumPlayers]),
    io:format(~"Game ticks per match: ~p~n~n", [GameTicks]),

    %% Baseline
    MemBefore = erlang:memory(),
    ProcsBefore = erlang:system_info(process_count),
    io:format(
        ~"[baseline] memory: ~s, processes: ~p~n",
        [fmt_bytes(mem(MemBefore)), ProcsBefore]
    ),

    %% Phase 1: Register
    io:format(~"~n--- Phase 1: Registering ~p players ---~n", [NumPlayers]),
    T0 = ts(),
    Players = register_players(NumPlayers, Host, Port),
    io:format(~"Registered ~p players in ~pms~n", [length(Players), ts() - T0]),

    %% Phase 2: Spawn player processes (each owns its gun connection)
    io:format(~"~n--- Phase 2: Spawning ~p player processes ---~n", [length(Players)]),
    T2 = ts(),
    Ref = make_ref(),
    Self = self(),
    PlayerPids = lists:map(
        fun(Player) ->
            spawn_link(fun() -> player_process(Self, Ref, Player, Host, Port, GameTicks) end)
        end,
        Players
    ),

    %% Wait for all to connect
    ConnectedCount = wait_phase(Ref, length(PlayerPids), connected, 30000),
    io:format(~"Connected ~p players in ~pms~n", [ConnectedCount, ts() - T2]),

    MemAfterConnect = erlang:memory(),
    ProcsAfterConnect = erlang:system_info(process_count),
    MemPerConn = (mem(MemAfterConnect) - mem(MemBefore)) / max(1, ConnectedCount),
    io:format(
        ~"[after connect] memory: ~s, processes: ~p, ~s/conn~n",
        [fmt_bytes(mem(MemAfterConnect)), ProcsAfterConnect, fmt_bytes(round(MemPerConn))]
    ),

    %% Phase 3: Matchmaking — tell all to queue, wait for matched
    io:format(~"~n--- Phase 3: Matchmaking ---~n"),
    T4 = ts(),
    lists:foreach(fun(Pid) -> Pid ! {Ref, matchmake} end, PlayerPids),
    MatchedCount = wait_phase(Ref, ConnectedCount, matched, 30000),
    io:format(~"~p players matched in ~pms~n", [MatchedCount, ts() - T4]),

    MemAfterMatch = erlang:memory(),
    ProcsAfterMatch = erlang:system_info(process_count),
    io:format(
        ~"[after matchmaking] memory: ~s, processes: ~p~n",
        [fmt_bytes(mem(MemAfterMatch)), ProcsAfterMatch]
    ),

    %% Phase 4: Gameplay — tell all to play, collect latencies
    io:format(~"~n--- Phase 4: Gameplay (~p ticks) ---~n", [GameTicks]),
    T6 = ts(),
    lists:foreach(fun(Pid) -> Pid ! {Ref, play} end, PlayerPids),
    AllLatencies = collect_latencies(Ref, MatchedCount, []),
    io:format(~"Gameplay completed in ~pms~n", [ts() - T6]),

    %% Final memory
    MemAfterGame = erlang:memory(),
    ProcsAfterGame = erlang:system_info(process_count),
    TotalMemUsed = mem(MemAfterGame) - mem(MemBefore),
    MemPerPlayer = TotalMemUsed / max(1, ConnectedCount),

    %% Phase 5: Disconnect
    io:format(~"~n--- Phase 5: Disconnecting ---~n"),
    lists:foreach(fun(Pid) -> Pid ! {Ref, stop} end, PlayerPids),
    timer:sleep(500),

    %% Report
    LatencyStats = compute_latency_stats(AllLatencies),
    io:format(~"~n========================================~n"),
    io:format(~"           BENCHMARK RESULTS~n"),
    io:format(~"========================================~n~n"),
    io:format(~"Players connected:     ~p~n", [ConnectedCount]),
    io:format(~"Players matched:       ~p~n", [MatchedCount]),
    io:format(~"~n"),
    io:format(~"Memory baseline:       ~s~n", [fmt_bytes(mem(MemBefore))]),
    io:format(~"Memory peak (game):    ~s~n", [fmt_bytes(mem(MemAfterGame))]),
    io:format(~"Memory used:           ~s~n", [fmt_bytes(TotalMemUsed)]),
    io:format(~"Memory per player:     ~s~n", [fmt_bytes(round(MemPerPlayer))]),
    io:format(~"Processes baseline:    ~p~n", [ProcsBefore]),
    io:format(~"Processes peak:        ~p~n", [ProcsAfterGame]),
    io:format(
        ~"Procs per player:      ~.1f~n",
        [(ProcsAfterGame - ProcsBefore) / max(1, ConnectedCount)]
    ),
    io:format(~"~n"),
    case LatencyStats of
        #{count := Count, p50 := P50, p95 := P95, p99 := P99, max := Max} ->
            io:format(~"Tick samples:          ~p~n", [Count]),
            io:format(~"Tick latency p50:      ~pms~n", [P50]),
            io:format(~"Tick latency p95:      ~pms~n", [P95]),
            io:format(~"Tick latency p99:      ~pms~n", [P99]),
            io:format(~"Tick latency max:      ~pms~n", [Max]);
        _ ->
            io:format(~"Tick latency:          no data~n")
    end,
    io:format(~"~n--- Extrapolation ---~n"),
    lists:foreach(
        fun(GB) ->
            Usable = round(GB * 1024 * 1024 * 1024 * 0.7),
            io:format(
                ~"~pGB RAM -> ~p estimated players~n",
                [GB, round(Usable / max(1, MemPerPlayer))]
            )
        end,
        [8, 16, 32, 64]
    ),
    io:format(~"~n========================================~n"),
    ok.

%%----------------------------------------------------------------------
%% Player process — each one owns its own gun connection
%%----------------------------------------------------------------------

player_process(Parent, Ref, #{token := Token}, Host, Port, GameTicks) ->
    %% Connect
    case gun:open(Host, Port, #{protocols => [http], retry => 0}) of
        {ok, Conn} ->
            case gun:await_up(Conn, 5000) of
                {ok, _} ->
                    Stream = gun:ws_upgrade(Conn, ~"/ws"),
                    case gun:await(Conn, Stream, 5000) of
                        {upgrade, [~"websocket"], _} ->
                            ws_send(Conn, Stream, ~"session.connect", #{~"token" => Token}),
                            case ws_wait(Conn, Stream, ~"session.connected", 5000) of
                                {ok, _} ->
                                    Parent ! {Ref, connected},
                                    player_loop(Parent, Ref, Conn, Stream, GameTicks);
                                _ ->
                                    gun:close(Conn),
                                    Parent ! {Ref, connect_failed}
                            end;
                        _ ->
                            gun:close(Conn),
                            Parent ! {Ref, connect_failed}
                    end;
                _ ->
                    gun:close(Conn),
                    Parent ! {Ref, connect_failed}
            end;
        _ ->
            Parent ! {Ref, connect_failed}
    end.

player_loop(Parent, Ref, Conn, Stream, GameTicks) ->
    receive
        {Ref, matchmake} ->
            ws_send(Conn, Stream, ~"matchmaker.add", #{
                ~"mode" => ~"arena",
                ~"properties" => #{~"skill" => 1000}
            }),
            %% Drain matchmaker.queued then wait for match.matched
            _ = ws_wait(Conn, Stream, ~"matchmaker.queued", 5000),
            case ws_wait(Conn, Stream, ~"match.matched", 15000) of
                {ok, _} ->
                    Parent ! {Ref, matched},
                    player_loop(Parent, Ref, Conn, Stream, GameTicks);
                {error, _} ->
                    Parent ! {Ref, match_failed},
                    player_loop(Parent, Ref, Conn, Stream, GameTicks)
            end;
        {Ref, play} ->
            %% Drain any pending messages (match.started etc.)
            drain(Conn, Stream),
            Latencies = play_ticks(Conn, Stream, GameTicks, []),
            Parent ! {Ref, latencies, Latencies},
            player_loop(Parent, Ref, Conn, Stream, GameTicks);
        {Ref, stop} ->
            gun:close(Conn)
    end.

play_ticks(_Conn, _Stream, 0, Acc) ->
    Acc;
play_ticks(Conn, Stream, N, Acc) ->
    ws_send(Conn, Stream, ~"match.input", random_input()),
    T0 = erlang:monotonic_time(microsecond),
    Latency =
        case ws_wait_any(Conn, Stream, ~"match.state", 500) of
            {ok, _} ->
                (erlang:monotonic_time(microsecond) - T0) div 1000;
            _ ->
                -1
        end,
    timer:sleep(?TICK_INTERVAL),
    play_ticks(Conn, Stream, N - 1, [Latency | Acc]).

%%----------------------------------------------------------------------
%% Coordination helpers
%%----------------------------------------------------------------------

wait_phase(_Ref, 0, _Phase, _Timeout) ->
    0;
wait_phase(Ref, Expected, Phase, Timeout) ->
    wait_phase_loop(Ref, Expected, Phase, Timeout, 0).

wait_phase_loop(_Ref, 0, _Phase, _Timeout, Count) ->
    Count;
wait_phase_loop(Ref, Remaining, Phase, Timeout, Count) ->
    receive
        {Ref, Phase} ->
            wait_phase_loop(Ref, Remaining - 1, Phase, Timeout, Count + 1);
        {Ref, connect_failed} ->
            wait_phase_loop(Ref, Remaining - 1, Phase, Timeout, Count);
        {Ref, match_failed} ->
            wait_phase_loop(Ref, Remaining - 1, Phase, Timeout, Count)
    after Timeout ->
        io:format(
            ~"  WARNING: ~p players timed out in ~s phase~n",
            [Remaining, Phase]
        ),
        Count
    end.

collect_latencies(_Ref, 0, Acc) ->
    lists:flatten(Acc);
collect_latencies(Ref, N, Acc) ->
    receive
        {Ref, latencies, Lats} ->
            collect_latencies(Ref, N - 1, [Lats | Acc])
    after 120_000 ->
        io:format(~"  WARNING: timed out waiting for ~p gameplay results~n", [N]),
        lists:flatten(Acc)
    end.

%%----------------------------------------------------------------------
%% Phase 1: Register (HTTP, can use pmap)
%%----------------------------------------------------------------------

register_players(N, Host, Port) ->
    register_batch(N, Host, Port, 1, []).

register_batch(0, _Host, _Port, _I, Acc) ->
    lists:reverse(Acc);
register_batch(N, Host, Port, I, Acc) ->
    Batch = min(N, ?BATCH_SIZE),
    Results = pmap(
        fun(Idx) -> register_one(Host, Port, Idx) end,
        lists:seq(I, I + Batch - 1)
    ),
    Good = [R || {ok, R} <- Results],
    Bad = [R || R <- Results, element(1, R) =/= ok],
    case Bad of
        [First | _] ->
            io:format(
                ~"  batch ~p-~p: ~p ok, ~p failed, first: ~p~n",
                [I, I + Batch - 1, length(Good), length(Bad), First]
            );
        [] ->
            ok
    end,
    timer:sleep(?BATCH_DELAY),
    register_batch(N - Batch, Host, Port, I + Batch, Good ++ Acc).

register_one(Host, Port, Idx) ->
    Username = iolist_to_binary([
        ~"bench_",
        integer_to_binary(Idx),
        ~"_",
        integer_to_binary(erlang:unique_integer([positive]))
    ]),
    Body = json:encode(#{
        ~"username" => Username,
        ~"password" => ~"benchpass123",
        ~"display_name" => Username
    }),
    case http_post(Host, Port, ~"/api/v1/auth/register", Body) of
        {ok, Status, RespBody} when Status =:= 200; Status =:= 201 ->
            parse_auth_response(RespBody, Username);
        Other ->
            {error, {register_failed, Other}}
    end.

parse_auth_response(RespBody, Username) ->
    D = json:decode(RespBody),
    {ok, #{
        username => Username,
        player_id => maps:get(~"player_id", D),
        token => maps:get(~"session_token", D)
    }}.

%%----------------------------------------------------------------------
%% WebSocket helpers
%%----------------------------------------------------------------------

ws_send(Conn, Stream, Type, Payload) ->
    Msg = json:encode(#{~"type" => Type, ~"payload" => Payload}),
    gun:ws_send(Conn, Stream, {text, Msg}).

ws_wait(Conn, Stream, ExpectedType, Timeout) ->
    Deadline = ts() + Timeout,
    ws_wait_loop(Conn, Stream, ExpectedType, Deadline).

ws_wait_loop(Conn, Stream, ExpectedType, Deadline) ->
    Remaining = Deadline - ts(),
    case Remaining =< 0 of
        true ->
            {error, timeout};
        false ->
            receive
                {gun_ws, Conn, Stream, {text, Frame}} ->
                    D = json:decode(Frame),
                    case maps:get(~"type", D, undefined) of
                        ExpectedType -> {ok, maps:get(~"payload", D, #{})};
                        _ -> ws_wait_loop(Conn, Stream, ExpectedType, Deadline)
                    end;
                {gun_ws, Conn, Stream, {close, _, _}} ->
                    {error, ws_closed};
                {gun_down, Conn, _, _, _} ->
                    {error, connection_down}
            after Remaining -> {error, timeout}
            end
    end.

ws_wait_any(Conn, Stream, PreferType, Timeout) ->
    receive
        {gun_ws, Conn, Stream, {text, Frame}} ->
            D = json:decode(Frame),
            Type = maps:get(~"type", D, undefined),
            case Type of
                PreferType -> {ok, maps:get(~"payload", D, #{})};
                _ -> ws_wait_any(Conn, Stream, PreferType, Timeout)
            end;
        {gun_ws, Conn, Stream, {close, _, _}} ->
            {error, ws_closed};
        {gun_down, Conn, _, _, _} ->
            {error, connection_down}
    after Timeout -> {error, timeout}
    end.

drain(Conn, Stream) ->
    receive
        {gun_ws, Conn, Stream, {text, _}} -> drain(Conn, Stream)
    after 100 -> ok
    end.

%%----------------------------------------------------------------------
%% HTTP helpers
%%----------------------------------------------------------------------

http_post(Host, Port, Path, Body) ->
    case gun:open(Host, Port, #{protocols => [http], retry => 0}) of
        {ok, Conn} ->
            case gun:await_up(Conn, 5000) of
                {ok, _} ->
                    Headers = [
                        {~"content-type", ~"application/json"}, {~"accept", ~"application/json"}
                    ],
                    Ref = gun:post(Conn, Path, Headers, Body),
                    Result =
                        case gun:await(Conn, Ref, 10000) of
                            {response, fin, Status, _} ->
                                {ok, Status, <<>>};
                            {response, nofin, Status, _} ->
                                case gun:await_body(Conn, Ref, 10000) of
                                    {ok, RBody} -> {ok, Status, RBody};
                                    {error, R} -> {error, {body, R}}
                                end;
                            {error, R} ->
                                {error, {req, R}}
                        end,
                    gun:close(Conn),
                    Result;
                {error, R} ->
                    gun:close(Conn),
                    {error, {up, R}}
            end;
        {error, R} ->
            {error, {open, R}}
    end.

%%----------------------------------------------------------------------
%% Utility
%%----------------------------------------------------------------------

random_input() ->
    #{
        ~"up" => rand:uniform() > 0.5,
        ~"down" => rand:uniform() > 0.5,
        ~"left" => rand:uniform() > 0.5,
        ~"right" => rand:uniform() > 0.5,
        ~"shoot" => rand:uniform() > 0.6,
        ~"aim_x" => 50 + rand:uniform(700),
        ~"aim_y" => 50 + rand:uniform(500)
    }.

compute_latency_stats([]) ->
    no_data;
compute_latency_stats(Raw) ->
    Latencies = lists:sort([L || L <- Raw, L >= 0]),
    case Latencies of
        [] ->
            no_data;
        _ ->
            Len = length(Latencies),
            #{
                count => Len,
                min => hd(Latencies),
                max => lists:last(Latencies),
                p50 => lists:nth(max(1, round(Len * 0.50)), Latencies),
                p95 => lists:nth(max(1, round(Len * 0.95)), Latencies),
                p99 => lists:nth(max(1, round(Len * 0.99)), Latencies),
                avg => round(lists:sum(Latencies) / Len)
            }
    end.

pmap(Fun, List) ->
    Parent = self(),
    Ref = make_ref(),
    Pids = [
        spawn_link(fun() ->
            Result =
                try
                    Fun(Item)
                catch
                    C:R -> {error, {C, R}}
                end,
            Parent ! {Ref, self(), Result}
        end)
     || Item <- List
    ],
    [
        receive
            {Ref, Pid, Result} -> Result
        end
     || Pid <- Pids
    ].

ts() -> erlang:monotonic_time(millisecond).
mem(M) -> proplists:get_value(total, M).

fmt_bytes(Bytes) when Bytes < 1024 -> io_lib:format(~"~pB", [Bytes]);
fmt_bytes(Bytes) when Bytes < 1024 * 1024 -> io_lib:format(~"~.1fKB", [Bytes / 1024]);
fmt_bytes(Bytes) when Bytes < 1024 * 1024 * 1024 ->
    io_lib:format(~"~.1fMB", [Bytes / (1024 * 1024)]);
fmt_bytes(Bytes) ->
    io_lib:format(~"~.2fGB", [Bytes / (1024 * 1024 * 1024)]).
