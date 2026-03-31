-module(asobi_arena_game).
-behaviour(asobi_match).

-export([init/1, join/2, leave/2, handle_input/3, tick/1, get_state/2]).

-define(ARENA_W, 800).
-define(ARENA_H, 600).
-define(SPEED, 4).
-define(PROJECTILE_SPEED, 8).
-define(PROJECTILE_RADIUS, 4).
-define(PLAYER_RADIUS, 16).
-define(MAX_HP, 100).
-define(DAMAGE, 25).
-define(SHOOT_COOLDOWN, 15).
-define(GAME_DURATION, 90000).

-spec init(map()) -> {ok, map()}.
init(_Config) ->
    {ok, #{
        players => #{},
        projectiles => [],
        next_proj_id => 1,
        started_at => undefined
    }}.

-spec join(binary(), map()) -> {ok, map()}.
join(PlayerId, #{players := Players} = State) ->
    Player = #{
        x => rand:uniform(?ARENA_W - 100) + 50,
        y => rand:uniform(?ARENA_H - 100) + 50,
        hp => ?MAX_HP,
        kills => 0,
        deaths => 0,
        shoot_cd => 0
    },
    Started =
        case maps:get(started_at, State) of
            undefined -> erlang:system_time(millisecond);
            V -> V
        end,
    {ok, State#{players => Players#{PlayerId => Player}, started_at => Started}}.

-spec leave(binary(), map()) -> {ok, map()}.
leave(PlayerId, #{players := Players} = State) ->
    {ok, State#{players => maps:remove(PlayerId, Players)}}.

-spec handle_input(binary(), map(), map()) -> {ok, map()}.
handle_input(PlayerId, Input, #{players := Players} = State) ->
    case maps:find(PlayerId, Players) of
        {ok, Player} ->
            Player1 = apply_movement(Input, Player),
            {State1, Player2} = maybe_shoot(PlayerId, Input, Player1, State),
            {ok, State1#{players => maps:put(PlayerId, Player2, maps:get(players, State1))}};
        error ->
            {ok, State}
    end.

-spec tick(map()) -> {ok, map()} | {finished, map(), map()}.
tick(#{players := Players, projectiles := Projs, started_at := Started} = State) ->
    Projs1 = move_projectiles(Projs),
    {Projs2, Players1} = check_collisions(Projs1, Players),
    Projs3 = remove_oob(Projs2),
    Players2 = tick_cooldowns(Players1),
    State1 = State#{players => Players2, projectiles => Projs3},
    Now = erlang:system_time(millisecond),
    Elapsed = Now - Started,
    Alive = maps:filter(fun(_, #{hp := Hp}) -> Hp > 0 end, Players2),
    case should_finish(Elapsed, Alive, Players2) of
        true ->
            Result = build_result(Players2),
            {finished, Result, State1};
        false ->
            {ok, State1}
    end.

-spec get_state(binary(), map()) -> map().
get_state(_PlayerId, #{players := Players, projectiles := Projs, started_at := Started}) ->
    Now = erlang:system_time(millisecond),
    Remaining = max(0, ?GAME_DURATION - (Now - Started)),
    #{
        players => maps:map(fun(_Id, P) -> maps:without([shoot_cd], P) end, Players),
        projectiles => [maps:with([id, x, y, owner], P) || P <- Projs],
        time_remaining => Remaining
    }.

%% --- Internal ---

apply_movement(Input, #{x := X, y := Y} = Player) ->
    Dx0 =
        case Input of
            #{~"right" := true} -> ?SPEED;
            _ -> 0
        end,
    Dx =
        case Input of
            #{~"left" := true} -> Dx0 - ?SPEED;
            _ -> Dx0
        end,
    Dy0 =
        case Input of
            #{~"down" := true} -> ?SPEED;
            _ -> 0
        end,
    Dy =
        case Input of
            #{~"up" := true} -> Dy0 - ?SPEED;
            _ -> Dy0
        end,
    NewX = clamp(X + Dx, ?PLAYER_RADIUS, ?ARENA_W - ?PLAYER_RADIUS),
    NewY = clamp(Y + Dy, ?PLAYER_RADIUS, ?ARENA_H - ?PLAYER_RADIUS),
    Player#{x => NewX, y => NewY}.

maybe_shoot(
    PlayerId,
    #{~"shoot" := true, ~"aim_x" := AimX, ~"aim_y" := AimY},
    #{x := X, y := Y, shoot_cd := Cd} = Player,
    #{projectiles := Projs, next_proj_id := NextId} = State
) when Cd =< 0 ->
    Dx = AimX - X,
    Dy = AimY - Y,
    Len = math:sqrt(Dx * Dx + Dy * Dy),
    case Len > 0 of
        true ->
            Proj = #{
                id => NextId,
                x => X,
                y => Y,
                vx => (Dx / Len) * ?PROJECTILE_SPEED,
                vy => (Dy / Len) * ?PROJECTILE_SPEED,
                owner => PlayerId
            },
            {State#{projectiles => [Proj | Projs], next_proj_id => NextId + 1}, Player#{
                shoot_cd => ?SHOOT_COOLDOWN
            }};
        false ->
            {State, Player}
    end;
maybe_shoot(_PlayerId, _Input, Player, State) ->
    {State, Player}.

move_projectiles(Projs) ->
    [
        P#{
            x => maps:get(x, P) + maps:get(vx, P),
            y => maps:get(y, P) + maps:get(vy, P)
        }
     || P <- Projs
    ].

check_collisions([], Players) ->
    {[], Players};
check_collisions(Projs, Players) ->
    check_collisions(Projs, Players, []).

check_collisions([], Players, AccProjs) ->
    {AccProjs, Players};
check_collisions([Proj | Rest], Players, AccProjs) ->
    case hit_player(Proj, Players) of
        {hit, HitId, Players1} ->
            Owner = maps:get(owner, Proj),
            Players2 =
                case maps:find(Owner, Players1) of
                    {ok, #{hp := Hp}} when Hp > 0 ->
                        case maps:get(hp, maps:get(HitId, Players1)) of
                            0 ->
                                maps:update_with(
                                    Owner,
                                    fun(P) -> P#{kills => maps:get(kills, P) + 1} end,
                                    Players1
                                );
                            _ ->
                                Players1
                        end;
                    _ ->
                        Players1
                end,
            check_collisions(Rest, Players2, AccProjs);
        miss ->
            check_collisions(Rest, Players, [Proj | AccProjs])
    end.

hit_player(#{x := Px, y := Py, owner := Owner}, Players) ->
    HitRadius = ?PLAYER_RADIUS + ?PROJECTILE_RADIUS,
    maps:fold(
        fun
            (_Id, _P, {hit, _, _} = Acc) ->
                Acc;
            (Id, _P, miss) when Id =:= Owner ->
                miss;
            (_Id, #{hp := Hp}, miss) when Hp =< 0 ->
                miss;
            (Id, #{x := Ex, y := Ey}, miss) ->
                Dist = math:sqrt((Px - Ex) * (Px - Ex) + (Py - Ey) * (Py - Ey)),
                case Dist =< HitRadius of
                    true ->
                        NewHp = max(0, maps:get(hp, maps:get(Id, Players)) - ?DAMAGE),
                        Players1 = maps:update_with(
                            Id,
                            fun(P) ->
                                P1 = P#{hp => NewHp},
                                case NewHp of
                                    0 -> P1#{deaths => maps:get(deaths, P1) + 1};
                                    _ -> P1
                                end
                            end,
                            Players
                        ),
                        {hit, Id, Players1};
                    false ->
                        miss
                end
        end,
        miss,
        Players
    ).

remove_oob(Projs) ->
    [
        P
     || #{x := X, y := Y} = P <- Projs,
        X >= 0,
        X =< ?ARENA_W,
        Y >= 0,
        Y =< ?ARENA_H
    ].

tick_cooldowns(Players) ->
    maps:map(
        fun(_, #{shoot_cd := Cd} = P) ->
            P#{shoot_cd => max(0, Cd - 1)}
        end,
        Players
    ).

should_finish(Elapsed, _Alive, _Players) when Elapsed >= ?GAME_DURATION ->
    true;
should_finish(_Elapsed, Alive, Players) when map_size(Players) >= 2, map_size(Alive) =< 1 ->
    true;
should_finish(_, _, _) ->
    false.

build_result(Players) ->
    PlayerList = maps:to_list(Players),
    Sorted = sort_by_kills(PlayerList),
    Standings = build_standings(Sorted, 1, []),
    #{
        status => ~"completed",
        standings => Standings,
        winner =>
            case Sorted of
                [{Id, _} | _] -> Id;
                [] -> undefined
            end
    }.

sort_by_kills(PlayerList) ->
    lists:sort(
        fun({_, #{kills := KillsA}}, {_, #{kills := KillsB}}) ->
            KillsA > KillsB
        end,
        PlayerList
    ).

build_standings([], _Rank, Acc) ->
    lists:reverse(Acc);
build_standings([{Id, #{kills := Kills, deaths := Deaths}} | Rest], Rank, Acc) ->
    Standing = #{
        player_id => Id,
        kills => Kills,
        deaths => Deaths,
        rank => Rank
    },
    build_standings(Rest, Rank + 1, [Standing | Acc]).

clamp(V, Min, _Max) when V < Min -> Min;
clamp(V, _Min, Max) when V > Max -> Max;
clamp(V, _, _) -> V.
