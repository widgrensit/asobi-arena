-module(asobi_arena_app).

-behaviour(application).

-export([start/2, stop/1]).

start(_StartType, _StartArgs) ->
    asobi_arena_sup:start_link().

stop(_State) ->
    ok.
