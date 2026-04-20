import { AsobiClient } from './client';
import { GameRenderer } from './game';
import { UI } from './ui';
import type { GameState, VoteStartPayload, VoteTallyPayload, VoteResultPayload } from './types';

const defaultPort = window.location.protocol === 'https:' ? 443 : 8084;
const client = new AsobiClient(window.location.hostname, parseInt(window.location.port) || defaultPort);
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const game = new GameRenderer(canvas, client);
const ui = new UI(client);

let currentMatchId: string | null = null;
let currentPhase: string | null = null;
let matchStarted = false;

ui.setupLogin(async (username) => {
  await client.connect();
  await client.authenticate();
  ui.showQueue(username);
});

client.onMatchMatched(async (payload) => {
  currentMatchId = payload.match_id;
  currentPhase = 'countdown';
  matchStarted = false;
  await client.joinMatch(payload.match_id);
  ui.showCountdown(3, () => {
    matchStarted = true;
    currentPhase = null;
    ui.showScreen('game-canvas');
    game.start();
  });
});

client.onMatchState((state: GameState) => {
  if (!matchStarted) return;
  const phase = state.phase;
  if (phase === 'playing') {
    game.updateState(state);
  } else if (phase === 'boon_pick' && currentPhase !== 'boon_pick') {
    currentPhase = 'boon_pick';
    game.stop();
    ui.showBoonPick(state);
  } else if (phase === 'boon_pick') {
    ui.updateBoonPick(state);
  }
});

ui.onBoonPick = (boonId: string) => {
  client.sendInput({ type: 'boon_pick', boon_id: boonId });
};

client.onVoteStart((payload: VoteStartPayload) => {
  currentPhase = 'voting';
  game.stop();
  ui.showVote(payload);
});

ui.onVoteCast = (voteId: string, optionId: string) => {
  client.castVote(voteId, optionId);
};

client.onVoteTally((payload: VoteTallyPayload) => {
  ui.updateVoteTally(payload);
});

client.onVoteResult((payload: VoteResultPayload) => {
  ui.showVoteResult(payload);
});

client.onMatchFinished((payload) => {
  currentPhase = 'finished';
  matchStarted = false;
  game.stop();
  const standings = payload.result?.standings || [];
  ui.showResults(standings, client.playerId);
  setTimeout(() => {
    currentPhase = null;
    ui.showQueue(client.username || '');
  }, 3000);
});

client.onMatchStarted(() => {
  currentPhase = null;
  matchStarted = true;
  ui.showScreen('game-canvas');
  game.start();
});

client.onMatchJoined(() => {
  currentPhase = null;
  matchStarted = true;
  ui.showScreen('game-canvas');
  game.start();
});
