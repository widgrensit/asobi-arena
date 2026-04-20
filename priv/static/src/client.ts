import type {
  AuthResponse,
  GameState,
  MatchJoinedPayload,
  MatchFinishedPayload,
  VoteStartPayload,
  VoteTallyPayload,
  VoteResultPayload,
  MessageHandler,
} from './types';

export class AsobiClient {
  private baseUrl: string;
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private cid = 0;
  private handlers = new Map<string, MessageHandler[]>();
  private pendingReplies = new Map<string, (payload: unknown) => void>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  sessionToken: string | null = null;
  playerId: string | null = null;
  username: string | null = null;

  constructor(host: string, port: number) {
    const ssl = window.location.protocol === 'https:';
    const portSuffix = port === 80 || port === 443 ? '' : `:${port}`;
    this.baseUrl = `${ssl ? 'https' : 'http'}://${host}${portSuffix}`;
    this.wsUrl = `${ssl ? 'wss' : 'ws'}://${host}${portSuffix}/ws`;
  }

  // --- REST ---

  async register(username: string, password: string): Promise<AuthResponse> {
    const res = await this.post('/api/v1/auth/register', { username, password });
    this.sessionToken = res.session_token;
    this.playerId = res.player_id;
    this.username = res.username;
    return res;
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const res = await this.post('/api/v1/auth/login', { username, password });
    this.sessionToken = res.session_token;
    this.playerId = res.player_id;
    this.username = res.username;
    return res;
  }

  private async post(path: string, body: unknown): Promise<any> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || data.errors || 'Request failed');
    return data;
  }

  // --- WebSocket ---

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        this.startHeartbeat();
        resolve();
      };
      this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.emit('disconnected', {});
      };
      this.ws.onmessage = (ev) => this.handleMessage(ev.data);
    });
  }

  disconnect() {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  async authenticate(): Promise<void> {
    await this.send('session.connect', { token: this.sessionToken });
  }

  async addToMatchmaker(mode: string): Promise<string> {
    const reply = await this.send('matchmaker.add', { mode }) as any;
    return reply.ticket_id;
  }

  async removeFromMatchmaker(ticketId: string): Promise<void> {
    await this.send('matchmaker.remove', { ticket_id: ticketId });
  }

  async joinMatch(matchId: string): Promise<MatchJoinedPayload> {
    return await this.send('match.join', { match_id: matchId }) as MatchJoinedPayload;
  }

  sendInput(data: Record<string, unknown>) {
    this.sendFire('match.input', { data });
  }

  castVote(voteId: string, optionId: string) {
    this.sendFire('vote.cast', { vote_id: voteId, option_id: optionId });
  }

  leaveMatch() {
    this.sendFire('match.leave', {});
  }

  // --- Events ---

  on(type: string, handler: MessageHandler) {
    const list = this.handlers.get(type) || [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  onMatchState(handler: (state: GameState) => void) {
    this.on('match.state', handler as MessageHandler);
  }

  onMatchJoined(handler: (payload: MatchJoinedPayload) => void) {
    this.on('match.joined', handler as MessageHandler);
  }

  onMatchStarted(handler: (payload: unknown) => void) {
    this.on('match.started', handler as MessageHandler);
  }

  onMatchFinished(handler: (payload: MatchFinishedPayload) => void) {
    this.on('match.finished', handler as MessageHandler);
  }

  onMatchMatched(handler: (payload: { match_id: string; players: string[] }) => void) {
    this.on('match.matched', handler as MessageHandler);
  }

  onVoteStart(handler: (payload: VoteStartPayload) => void) {
    this.on('match.vote_start', handler as MessageHandler);
  }

  onVoteTally(handler: (payload: VoteTallyPayload) => void) {
    this.on('match.vote_tally', handler as MessageHandler);
  }

  onVoteResult(handler: (payload: VoteResultPayload) => void) {
    this.on('match.vote_result', handler as MessageHandler);
  }

  // --- Internal ---

  private nextCid(): string {
    return String(++this.cid);
  }

  private send(type: string, payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const cid = this.nextCid();
      const timeout = setTimeout(() => {
        this.pendingReplies.delete(cid);
        reject(new Error(`Timeout waiting for ${type} reply`));
      }, 10000);

      this.pendingReplies.set(cid, (reply) => {
        clearTimeout(timeout);
        resolve(reply);
      });

      this.ws?.send(JSON.stringify({ type, payload, cid }));
    });
  }

  private sendFire(type: string, payload: unknown) {
    this.ws?.send(JSON.stringify({ type, payload }));
  }

  private handleMessage(raw: string) {
    const msg = JSON.parse(raw);
    const { type, payload, cid } = msg;

    // Check pending replies first
    if (cid && this.pendingReplies.has(cid)) {
      const resolve = this.pendingReplies.get(cid)!;
      this.pendingReplies.delete(cid);
      if (type === 'error') {
        // Still resolve so caller can handle
        resolve(payload);
      } else {
        resolve(payload);
      }
      return;
    }

    this.emit(type, payload);
  }

  private emit(type: string, payload: unknown) {
    const list = this.handlers.get(type);
    if (list) {
      for (const handler of list) {
        handler(payload);
      }
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.sendFire('session.heartbeat', {});
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
