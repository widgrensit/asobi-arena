-module(asobi_arena_router).
-behaviour(nova_router).

-export([routes/1]).

routes(_Environment) ->
    [
        #{
            prefix => ~"",
            security => false,
            routes => [
                {~"/health", fun(_) -> {json, #{status => ~"ok"}} end, #{methods => [get]}}
            ]
        }
    ].
