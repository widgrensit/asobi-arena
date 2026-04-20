export interface AuthResponse {
  player_id: string;
  session_token: string;
  username: string;
}

export interface PlayerState {
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  kills: number;
  deaths: number;
  boons: string[];
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  owner: string;
}

export interface GameState {
  phase: 'playing' | 'boon_pick' | 'voting';
  players?: Record<string, PlayerState>;
  projectiles?: Projectile[];
  time_remaining?: number;
  arena_w?: number;
  arena_h?: number;
  modifier?: string | null;
  round?: number;
  my_boons?: string[];
  // boon_pick phase
  standings?: Standing[];
  boon_offers?: BoonOffer[];
  picks_done?: string[];
  // voting phase
  current_modifier?: string | null;
}

export interface Standing {
  player_id: string;
  kills: number;
  deaths: number;
  rank: number;
}

export interface BoonOffer {
  id: string;
  name: string;
  description: string;
}

export interface VoteOption {
  id: string;
  label: string;
}

export interface VoteStartPayload {
  vote_id: string;
  options: VoteOption[];
  window_ms: number;
  method: string;
}

export interface VoteTallyPayload {
  vote_id: string;
  tallies: Record<string, number>;
  time_remaining_ms: number;
  total_votes: number;
}

export interface VoteResultPayload {
  vote_id: string;
  winner: string;
  distribution: Record<string, number>;
  counts: Record<string, number>;
  total_votes: number;
  turnout: number;
}

export interface MatchFinishedPayload {
  match_id: string;
  result: {
    status: string;
    standings: Standing[];
    winner?: string;
    round?: number;
    session_stats?: Record<string, unknown>;
  };
}

export interface MatchJoinedPayload {
  match_id: string;
  status: string;
  player_count: number;
  players: string[];
}

export type MessageHandler = (payload: unknown) => void;
