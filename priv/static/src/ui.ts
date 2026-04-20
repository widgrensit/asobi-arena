import type { AsobiClient } from './client';
import type {
  GameState,
  Standing,
  BoonOffer,
  VoteStartPayload,
  VoteTallyPayload,
  VoteResultPayload,
} from './types';

type ScreenId = 'login-screen' | 'queue-screen' | 'game-canvas' | 'boon-screen' | 'vote-screen' | 'results-screen' | 'countdown-screen' | 'outcome-screen';

export class UI {
  private client: AsobiClient;
  private currentVoteId: string | null = null;
  private votedOptionId: string | null = null;
  private voteTimerInterval: ReturnType<typeof setInterval> | null = null;
  private boonTimerInterval: ReturnType<typeof setInterval> | null = null;
  private searchTimer: ReturnType<typeof setInterval> | null = null;

  onBoonPick: ((boonId: string) => void) | null = null;
  onVoteCast: ((voteId: string, optionId: string) => void) | null = null;

  constructor(client: AsobiClient) {
    this.client = client;
  }

  showScreen(id: ScreenId) {
    this.clearSearchTimer();
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    canvas.style.display = 'none';

    if (id === 'game-canvas') {
      canvas.style.display = 'block';
    } else {
      const el = document.getElementById(id);
      el?.classList.add('active');
    }
  }

  // --- Login ---

  setupLogin(onAuth: (username: string) => void) {
    const loginBtn = document.getElementById('login-btn')!;
    const registerBtn = document.getElementById('register-btn')!;
    const errorEl = document.getElementById('auth-error')!;

    const getCredentials = () => ({
      username: (document.getElementById('username') as HTMLInputElement).value.trim(),
      password: (document.getElementById('password') as HTMLInputElement).value.trim(),
    });

    loginBtn.onclick = async () => {
      const { username, password } = getCredentials();
      if (!username || !password) { errorEl.textContent = 'Fill in both fields'; return; }
      try {
        errorEl.textContent = '';
        await this.client.login(username, password);
        onAuth(username);
      } catch (e: any) {
        errorEl.textContent = e.message || 'Login failed';
      }
    };

    registerBtn.onclick = async () => {
      const { username, password } = getCredentials();
      if (!username || !password) { errorEl.textContent = 'Fill in both fields'; return; }
      try {
        errorEl.textContent = '';
        await this.client.register(username, password);
        onAuth(username);
      } catch (e: any) {
        errorEl.textContent = e.message || 'Registration failed';
      }
    };
  }

  // --- Queue ---

  showQueue(username: string) {
    this.showScreen('queue-screen');
    document.getElementById('display-name')!.textContent = username;
    document.getElementById('queue-btn')!.removeAttribute('disabled');
    document.getElementById('cancel-queue-btn')!.style.display = 'none';
    document.getElementById('queue-status')!.textContent = '';
    const queueBtn = document.getElementById('queue-btn')!;
    const cancelBtn = document.getElementById('cancel-queue-btn')!;
    const statusEl = document.getElementById('queue-status')!;

    let ticketId: string | null = null;
    let searchStart = 0;

    queueBtn.onclick = async () => {
      queueBtn.setAttribute('disabled', '');
      cancelBtn.style.display = 'inline-block';
      statusEl.textContent = 'Searching...';
      searchStart = Date.now();
      this.clearSearchTimer();
      this.searchTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - searchStart) / 1000);
        statusEl.textContent = `Searching... ${elapsed}s`;
      }, 1000);
      try {
        ticketId = await this.client.addToMatchmaker('arena');
      } catch (e: any) {
        statusEl.textContent = `Error: ${e.message}`;
        queueBtn.removeAttribute('disabled');
        cancelBtn.style.display = 'none';
        this.clearSearchTimer();
      }
    };

    cancelBtn.onclick = async () => {
      if (ticketId) {
        await this.client.removeFromMatchmaker(ticketId);
        ticketId = null;
      }
      queueBtn.removeAttribute('disabled');
      cancelBtn.style.display = 'none';
      statusEl.textContent = '';
      this.clearSearchTimer();
    };
  }

  // --- Countdown ---

  showCountdown(seconds: number, onDone: () => void) {
    this.showScreen('countdown-screen');
    const el = document.getElementById('countdown-number')!;
    let remaining = seconds;
    el.textContent = String(remaining);
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'pulse 1s ease-in-out';

    const interval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(interval);
        el.textContent = 'GO!';
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = 'pulse 1s ease-in-out';
        setTimeout(onDone, 500);
      } else {
        el.textContent = String(remaining);
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = 'pulse 1s ease-in-out';
      }
    }, 1000);
  }

  // --- Outcome ---

  showOutcome(isWinner: boolean, onDone: () => void) {
    this.showScreen('outcome-screen');
    const el = document.getElementById('outcome-text')!;
    el.textContent = isWinner ? 'Victory!' : 'Defeat!';
    el.className = `outcome-text ${isWinner ? 'outcome-victory' : 'outcome-defeat'}`;
    setTimeout(onDone, 2000);
  }

  // --- Boon Pick ---

  showBoonPick(state: GameState) {
    this.showScreen('boon-screen');
    const cardsEl = document.getElementById('boon-cards')!;
    const waitingEl = document.getElementById('boon-waiting')!;
    const timerEl = document.getElementById('boon-timer')!;

    const offers = state.boon_offers || [];
    const picksDone = state.picks_done || [];
    const timeRemaining = state.time_remaining || 0;

    if (offers.length === 0) {
      cardsEl.replaceChildren();
      waitingEl.textContent = 'Waiting for top players to pick...';
    } else {
      waitingEl.textContent = '';
      cardsEl.replaceChildren();
      for (const boon of offers) {
        const card = document.createElement('div');
        card.className = 'boon-card';
        const title = document.createElement('h3');
        title.textContent = boon.name;
        const desc = document.createElement('p');
        desc.textContent = boon.description;
        card.append(title, desc);
        card.onclick = () => {
          document.querySelectorAll('.boon-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          this.onBoonPick?.(boon.id);
          // Disable further clicks
          document.querySelectorAll('.boon-card').forEach(c => {
            (c as HTMLElement).style.pointerEvents = 'none';
          });
          waitingEl.textContent = `Picked ${boon.name}! Waiting for others...`;
        };
        cardsEl.appendChild(card);
      }
    }

    // Timer
    this.clearBoonTimer();
    let remaining = timeRemaining;
    const updateTimer = () => {
      const secs = Math.ceil(remaining / 1000);
      timerEl.textContent = `${secs}s`;
    };
    updateTimer();
    this.boonTimerInterval = setInterval(() => {
      remaining -= 1000;
      if (remaining <= 0) {
        this.clearBoonTimer();
        timerEl.textContent = '0s';
      } else {
        updateTimer();
      }
    }, 1000);
  }

  updateBoonPick(state: GameState) {
    const waitingEl = document.getElementById('boon-waiting')!;
    const picksDone = state.picks_done || [];
    if (picksDone.includes(this.client.playerId || '')) {
      waitingEl.textContent = `Picked! Waiting for others... (${picksDone.length} done)`;
    }
  }

  // --- Vote ---

  showVote(payload: VoteStartPayload) {
    this.showScreen('vote-screen');
    this.currentVoteId = payload.vote_id;
    this.votedOptionId = null;
    const optionsEl = document.getElementById('vote-options')!;
    const timerEl = document.getElementById('vote-timer')!;

    optionsEl.replaceChildren();
    for (const opt of payload.options) {
      const el = document.createElement('div');
      el.className = 'vote-option';
      el.dataset.optionId = opt.id;
      const labelEl = document.createElement('div');
      labelEl.textContent = opt.label;
      const bar = document.createElement('div');
      bar.className = 'vote-bar';
      bar.style.width = '0%';
      el.append(labelEl, bar);
      el.onclick = () => {
        document.querySelectorAll('.vote-option').forEach(o => o.classList.remove('voted'));
        el.classList.add('voted');
        this.votedOptionId = opt.id;
        this.onVoteCast?.(payload.vote_id, opt.id);
      };
      optionsEl.appendChild(el);
    }

    // Timer
    this.clearVoteTimer();
    let remaining = payload.window_ms;
    const updateTimer = () => {
      timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;
    };
    updateTimer();
    this.voteTimerInterval = setInterval(() => {
      remaining -= 1000;
      if (remaining <= 0) {
        this.clearVoteTimer();
        timerEl.textContent = '0s';
      } else {
        updateTimer();
      }
    }, 1000);
  }

  updateVoteTally(payload: VoteTallyPayload) {
    const total = Math.max(1, payload.total_votes);
    for (const [optId, count] of Object.entries(payload.tallies)) {
      const el = document.querySelector(`.vote-option[data-option-id="${optId}"]`);
      if (el) {
        const bar = el.querySelector('.vote-bar') as HTMLElement;
        bar.style.width = `${(count / total) * 100}%`;
      }
    }
    const timerEl = document.getElementById('vote-timer')!;
    timerEl.textContent = `${Math.ceil(payload.time_remaining_ms / 1000)}s`;
  }

  showVoteResult(payload: VoteResultPayload) {
    this.clearVoteTimer();
    const winnerEl = document.querySelector(`.vote-option[data-option-id="${payload.winner}"]`);
    if (winnerEl) {
      winnerEl.classList.add('voted');
      (winnerEl as HTMLElement).style.borderColor = '#53d769';
    }
  }

  // --- Results ---

  showResults(standings: Standing[], myId: string | null) {
    this.showScreen('results-screen');
    const standingsEl = document.getElementById('results-standings')!;
    const nextEl = document.getElementById('results-next')!;

    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const label of ['#', 'Player', 'Kills', 'Deaths']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    }
    table.appendChild(head);
    for (const s of standings) {
      const isMe = s.player_id === myId;
      const tr = document.createElement('tr');
      if (isMe) tr.className = 'me';
      const name = isMe ? 'YOU' : s.player_id.slice(0, 12);
      for (const val of [String(s.rank), name, String(s.kills), String(s.deaths)]) {
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    standingsEl.replaceChildren(table);
    nextEl.textContent = 'Next phase starting...';
  }

  // --- Cleanup ---

  private clearSearchTimer() {
    if (this.searchTimer) {
      clearInterval(this.searchTimer);
      this.searchTimer = null;
    }
  }

  private clearVoteTimer() {
    if (this.voteTimerInterval) {
      clearInterval(this.voteTimerInterval);
      this.voteTimerInterval = null;
    }
  }

  private clearBoonTimer() {
    if (this.boonTimerInterval) {
      clearInterval(this.boonTimerInterval);
      this.boonTimerInterval = null;
    }
  }
}
