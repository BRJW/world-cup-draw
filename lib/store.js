// Storage layer with two interchangeable backends behind one async interface:
//   - Postgres  (when DATABASE_URL is set — production / Railway)
//   - In-memory (fallback — local dev & tests; no external dependency)
//
// Pool lifecycle status: 'setup' -> 'drafting' -> 'done'

import { id, joinCode } from './ids.js';

// ----------------------------------------------------------------------------
// In-memory backend
// ----------------------------------------------------------------------------
class MemoryStore {
  constructor() {
    this.pools = new Map();    // poolId -> pool
    this.players = new Map();  // playerId -> player
    this.picks = [];           // {poolId, playerId, teamCode, pot, pickNumber, createdAt}
    this.matches = [];         // {id, teamA, teamB, scoreA, scoreB, stage, createdAt}
    this.logins = [];          // {token, phone, code, expiresAt, used}
  }

  async init() {}

  async createPool({ name, commissionerName }) {
    let code;
    do { code = joinCode(); } while ([...this.pools.values()].some((p) => p.joinCode === code));
    const pool = {
      id: id(),
      name,
      joinCode: code,
      commissionerToken: id(),
      status: 'setup',
      potIndex: 0,
      pickIndex: 0,
      draftOrder: [],
      createdAt: new Date().toISOString(),
    };
    this.pools.set(pool.id, pool);
    const player = await this.addPlayer(pool.id, commissionerName, true);
    pool.commissionerPlayerId = player.id;
    return { pool, player };
  }

  async getPool(poolId) {
    return this.pools.get(poolId) || null;
  }

  async getPoolByCode(code) {
    return [...this.pools.values()].find((p) => p.joinCode === code.toUpperCase()) || null;
  }

  async addPlayer(poolId, name, isCommissioner = false, placeholder = false) {
    const player = {
      id: id(),
      poolId,
      name,
      token: id(),
      isCommissioner,
      placeholder,
      teamName: null,
      image: null,
      phone: null,
      email: null,
      createdAt: new Date().toISOString(),
    };
    this.players.set(player.id, player);
    return player;
  }

  async updatePlayer(playerId, fields) {
    const p = this.players.get(playerId);
    if (!p) return null;
    for (const k of ['teamName', 'image', 'phone', 'email', 'placeholder']) if (k in fields) p[k] = fields[k];
    return p;
  }

  async getPlayersByPhone(phone) {
    return [...this.players.values()].filter((p) => p.phone === phone);
  }

  async getPlayersByEmail(email) {
    return [...this.players.values()].filter((p) => p.email === email);
  }

  async createLoginRequest({ phone, email, code, token, ttlMs }) {
    this.logins = this.logins.filter((r) => !(email && r.email === email) && !(phone && r.phone === phone));
    const row = { token, phone: phone || null, email: email || null, code, expiresAt: Date.now() + ttlMs, used: false };
    this.logins.push(row);
    return row;
  }

  async findLoginRequest({ token, phone, email, code }) {
    const now = Date.now();
    return this.logins.find((r) => !r.used && r.expiresAt > now && (
      (token && r.token === token) ||
      (code && phone && r.phone === phone && r.code === code) ||
      (code && email && r.email === email && r.code === code)
    )) || null;
  }

  async useLoginRequest(token) {
    const r = this.logins.find((x) => x.token === token);
    if (r) r.used = true;
  }

  async getPlayers(poolId) {
    return [...this.players.values()]
      .filter((p) => p.poolId === poolId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getPlayerByToken(token) {
    return [...this.players.values()].find((p) => p.token === token) || null;
  }

  async updatePool(poolId, fields) {
    const pool = this.pools.get(poolId);
    if (!pool) return null;
    Object.assign(pool, fields);
    return pool;
  }

  async recordPick(pick) {
    const row = { ...pick, createdAt: new Date().toISOString() };
    this.picks.push(row);
    return row;
  }

  async getPicks(poolId) {
    return this.picks
      .filter((p) => p.poolId === poolId)
      .sort((a, b) => a.pickNumber - b.pickNumber);
  }

  async clearPicks(poolId) {
    this.picks = this.picks.filter((p) => p.poolId !== poolId);
  }

  async listMatches() {
    const key = (m) => m.kickoff || m.createdAt || '';
    return [...this.matches].sort((a, b) => String(key(a)).localeCompare(String(key(b))));
  }

  async addMatch(m) {
    const row = { id: id(8), createdAt: new Date().toISOString(), manual: true, ...m };
    this.matches.push(row);
    return row;
  }

  async getMatchByExtId(extId) {
    return this.matches.find((x) => x.extId === extId) || null;
  }

  // Insert-or-update a fixture from the live feed. Never clobbers scores that a
  // commissioner has manually overridden (manual === true).
  async upsertMatchByExtId(m) {
    const existing = this.matches.find((x) => x.extId === m.extId);
    if (!existing) {
      const row = { id: id(8), createdAt: new Date().toISOString(), manual: false, ...m };
      this.matches.push(row);
      return row;
    }
    const meta = { teamA: m.teamA, teamB: m.teamB, teamAName: m.teamAName, teamBName: m.teamBName,
      stage: m.stage, kickoff: m.kickoff, status: m.status, statusDetail: m.statusDetail, completed: m.completed };
    Object.assign(existing, meta);
    if (!existing.manual) { existing.scoreA = m.scoreA; existing.scoreB = m.scoreB; }
    return existing;
  }

  async updateMatch(matchId, fields) {
    const m = this.matches.find((x) => x.id === matchId);
    if (!m) return null;
    Object.assign(m, fields);
    return m;
  }

  async deleteMatch(matchId) {
    const i = this.matches.findIndex((x) => x.id === matchId);
    if (i >= 0) this.matches.splice(i, 1);
    return i >= 0;
  }
}

// ----------------------------------------------------------------------------
// Postgres backend
// ----------------------------------------------------------------------------
class PgStore {
  constructor(connectionString) {
    this.connectionString = connectionString;
  }

  async init() {
    const { default: pg } = await import('pg');
    const ssl = /sslmode=require/.test(this.connectionString) || process.env.PGSSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined;
    this.pool = new pg.Pool({ connectionString: this.connectionString, ssl });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        join_code TEXT UNIQUE NOT NULL,
        commissioner_token TEXT NOT NULL,
        commissioner_player_id TEXT,
        status TEXT NOT NULL DEFAULT 'setup',
        pot_index INT NOT NULL DEFAULT 0,
        pick_index INT NOT NULL DEFAULT 0,
        draft_order JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        is_commissioner BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS picks (
        id BIGSERIAL PRIMARY KEY,
        pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        team_code TEXT NOT NULL,
        pot INT NOT NULL,
        pick_number INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (pool_id, team_code)
      );
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        team_a TEXT NOT NULL,
        team_b TEXT NOT NULL,
        score_a INT,
        score_b INT,
        stage TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS ext_id TEXT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS team_a_name TEXT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS team_b_name TEXT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS kickoff TIMESTAMPTZ;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS status TEXT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS status_detail TEXT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT false;
      CREATE UNIQUE INDEX IF NOT EXISTS matches_ext_id_idx ON matches (ext_id) WHERE ext_id IS NOT NULL;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS team_name TEXT;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS image TEXT;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS placeholder BOOLEAN NOT NULL DEFAULT false;
      CREATE INDEX IF NOT EXISTS players_phone_idx ON players (phone);
      CREATE INDEX IF NOT EXISTS players_email_idx ON players (email);
      CREATE TABLE IF NOT EXISTS login_requests (
        token TEXT PRIMARY KEY,
        phone TEXT,
        code TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE login_requests ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE login_requests ALTER COLUMN phone DROP NOT NULL;
    `);
  }

  _poolRow(r) {
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      joinCode: r.join_code,
      commissionerToken: r.commissioner_token,
      commissionerPlayerId: r.commissioner_player_id,
      status: r.status,
      potIndex: r.pot_index,
      pickIndex: r.pick_index,
      draftOrder: r.draft_order || [],
      createdAt: r.created_at,
    };
  }

  _playerRow(r) {
    if (!r) return null;
    return {
      id: r.id,
      poolId: r.pool_id,
      name: r.name,
      token: r.token,
      isCommissioner: r.is_commissioner,
      placeholder: r.placeholder,
      teamName: r.team_name,
      image: r.image,
      phone: r.phone,
      email: r.email,
      createdAt: r.created_at,
    };
  }

  async createPool({ name, commissionerName }) {
    let code;
    for (let attempt = 0; ; attempt++) {
      code = joinCode();
      const exists = await this.pool.query('SELECT 1 FROM pools WHERE join_code=$1', [code]);
      if (exists.rowCount === 0) break;
      if (attempt > 10) throw new Error('could not allocate join code');
    }
    const poolId = id();
    const token = id();
    await this.pool.query(
      `INSERT INTO pools (id, name, join_code, commissioner_token) VALUES ($1,$2,$3,$4)`,
      [poolId, name, code, token]
    );
    const player = await this.addPlayer(poolId, commissionerName, true);
    await this.pool.query('UPDATE pools SET commissioner_player_id=$1 WHERE id=$2', [player.id, poolId]);
    const pool = await this.getPool(poolId);
    return { pool, player };
  }

  async getPool(poolId) {
    const r = await this.pool.query('SELECT * FROM pools WHERE id=$1', [poolId]);
    return this._poolRow(r.rows[0]);
  }

  async getPoolByCode(code) {
    const r = await this.pool.query('SELECT * FROM pools WHERE join_code=$1', [code.toUpperCase()]);
    return this._poolRow(r.rows[0]);
  }

  async addPlayer(poolId, name, isCommissioner = false, placeholder = false) {
    const playerId = id();
    const token = id();
    const r = await this.pool.query(
      `INSERT INTO players (id, pool_id, name, token, is_commissioner, placeholder)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [playerId, poolId, name, token, isCommissioner, placeholder]
    );
    return this._playerRow(r.rows[0]);
  }

  async getPlayers(poolId) {
    const r = await this.pool.query(
      'SELECT * FROM players WHERE pool_id=$1 ORDER BY created_at ASC', [poolId]
    );
    return r.rows.map((x) => this._playerRow(x));
  }

  async getPlayerByToken(token) {
    const r = await this.pool.query('SELECT * FROM players WHERE token=$1', [token]);
    return this._playerRow(r.rows[0]);
  }

  async updatePlayer(playerId, fields) {
    const map = { teamName: 'team_name', image: 'image', phone: 'phone', email: 'email', placeholder: 'placeholder' };
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(fields)) {
      if (!map[k]) continue;
      sets.push(`${map[k]}=$${i++}`);
      vals.push(v);
    }
    if (!sets.length) return null;
    vals.push(playerId);
    const r = await this.pool.query(
      `UPDATE players SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`, vals
    );
    return this._playerRow(r.rows[0]);
  }

  async getPlayersByPhone(phone) {
    const r = await this.pool.query('SELECT * FROM players WHERE phone=$1', [phone]);
    return r.rows.map((x) => this._playerRow(x));
  }

  async getPlayersByEmail(email) {
    const r = await this.pool.query('SELECT * FROM players WHERE email=$1', [email]);
    return r.rows.map((x) => this._playerRow(x));
  }

  async createLoginRequest({ phone, email, code, token, ttlMs }) {
    if (email) await this.pool.query('DELETE FROM login_requests WHERE email=$1', [email]);
    if (phone) await this.pool.query('DELETE FROM login_requests WHERE phone=$1', [phone]);
    const expires = new Date(Date.now() + ttlMs).toISOString();
    await this.pool.query(
      'INSERT INTO login_requests (token, phone, email, code, expires_at) VALUES ($1,$2,$3,$4,$5)',
      [token, phone || null, email || null, code, expires]
    );
    return { token, phone, email, code };
  }

  async findLoginRequest({ token, phone, email, code }) {
    let r;
    if (token) {
      r = await this.pool.query('SELECT * FROM login_requests WHERE token=$1 AND used=false AND expires_at>now()', [token]);
    } else if (email) {
      r = await this.pool.query('SELECT * FROM login_requests WHERE email=$1 AND code=$2 AND used=false AND expires_at>now()', [email, code]);
    } else {
      r = await this.pool.query('SELECT * FROM login_requests WHERE phone=$1 AND code=$2 AND used=false AND expires_at>now()', [phone, code]);
    }
    const x = r.rows[0];
    return x ? { token: x.token, phone: x.phone, email: x.email, code: x.code } : null;
  }

  async useLoginRequest(token) {
    await this.pool.query('UPDATE login_requests SET used=true WHERE token=$1', [token]);
  }

  async updatePool(poolId, fields) {
    const map = {
      status: 'status', potIndex: 'pot_index', pickIndex: 'pick_index',
      draftOrder: 'draft_order', commissionerPlayerId: 'commissioner_player_id',
    };
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(fields)) {
      if (!map[k]) continue;
      sets.push(`${map[k]}=$${i++}`);
      vals.push(k === 'draftOrder' ? JSON.stringify(v) : v);
    }
    if (!sets.length) return this.getPool(poolId);
    vals.push(poolId);
    await this.pool.query(`UPDATE pools SET ${sets.join(', ')} WHERE id=$${i}`, vals);
    return this.getPool(poolId);
  }

  async recordPick(pick) {
    const r = await this.pool.query(
      `INSERT INTO picks (pool_id, player_id, team_code, pot, pick_number)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pick.poolId, pick.playerId, pick.teamCode, pick.pot, pick.pickNumber]
    );
    const x = r.rows[0];
    return {
      poolId: x.pool_id, playerId: x.player_id, teamCode: x.team_code,
      pot: x.pot, pickNumber: x.pick_number, createdAt: x.created_at,
    };
  }

  async getPicks(poolId) {
    const r = await this.pool.query(
      'SELECT * FROM picks WHERE pool_id=$1 ORDER BY pick_number ASC', [poolId]
    );
    return r.rows.map((x) => ({
      poolId: x.pool_id, playerId: x.player_id, teamCode: x.team_code,
      pot: x.pot, pickNumber: x.pick_number, createdAt: x.created_at,
    }));
  }

  async clearPicks(poolId) {
    await this.pool.query('DELETE FROM picks WHERE pool_id=$1', [poolId]);
  }

  _matchRow(x) {
    return x ? {
      id: x.id, extId: x.ext_id, teamA: x.team_a, teamB: x.team_b,
      teamAName: x.team_a_name, teamBName: x.team_b_name,
      scoreA: x.score_a, scoreB: x.score_b, stage: x.stage,
      kickoff: x.kickoff, status: x.status, statusDetail: x.status_detail,
      completed: x.completed, manual: x.manual, createdAt: x.created_at,
    } : null;
  }

  async listMatches() {
    const r = await this.pool.query(
      'SELECT * FROM matches ORDER BY kickoff ASC NULLS LAST, created_at ASC'
    );
    return r.rows.map((x) => this._matchRow(x));
  }

  async getMatchByExtId(extId) {
    const r = await this.pool.query('SELECT * FROM matches WHERE ext_id=$1', [extId]);
    return this._matchRow(r.rows[0]);
  }

  async addMatch(m) {
    const mid = id(8);
    const r = await this.pool.query(
      `INSERT INTO matches (id, team_a, team_b, score_a, score_b, stage, manual)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`,
      [mid, m.teamA, m.teamB, m.scoreA ?? null, m.scoreB ?? null, m.stage ?? null]
    );
    return this._matchRow(r.rows[0]);
  }

  // Insert-or-update a fixture from the live feed; preserve manually overridden
  // scores (manual = true).
  async upsertMatchByExtId(m) {
    const existing = await this.getMatchByExtId(m.extId);
    if (!existing) {
      const mid = id(8);
      const r = await this.pool.query(
        `INSERT INTO matches
           (id, ext_id, team_a, team_b, team_a_name, team_b_name, score_a, score_b,
            stage, kickoff, status, status_detail, completed, manual)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false) RETURNING *`,
        [mid, m.extId, m.teamA, m.teamB, m.teamAName, m.teamBName,
         m.scoreA ?? null, m.scoreB ?? null, m.stage ?? null, m.kickoff ?? null,
         m.status ?? null, m.statusDetail ?? null, !!m.completed]
      );
      return this._matchRow(r.rows[0]);
    }
    // Update metadata always; only update scores when not manually overridden.
    const setScores = existing.manual ? '' : ', score_a=$8, score_b=$9';
    const params = [
      m.teamA, m.teamB, m.teamAName, m.teamBName, m.stage ?? null, m.kickoff ?? null,
      m.status ?? null, m.scoreA ?? null, m.scoreB ?? null, m.statusDetail ?? null,
      !!m.completed, m.extId,
    ];
    await this.pool.query(
      `UPDATE matches SET
         team_a=$1, team_b=$2, team_a_name=$3, team_b_name=$4, stage=$5, kickoff=$6,
         status=$7, status_detail=$10, completed=$11 ${setScores}
       WHERE ext_id=$12`,
      params
    );
    return this.getMatchByExtId(m.extId);
  }

  async updateMatch(matchId, fields) {
    const map = {
      teamA: 'team_a', teamB: 'team_b', scoreA: 'score_a', scoreB: 'score_b',
      stage: 'stage', manual: 'manual',
    };
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(fields)) {
      if (!map[k]) continue;
      sets.push(`${map[k]}=$${i++}`);
      vals.push(v);
    }
    if (!sets.length) return null;
    vals.push(matchId);
    await this.pool.query(`UPDATE matches SET ${sets.join(', ')} WHERE id=$${i}`, vals);
    const r = await this.pool.query('SELECT * FROM matches WHERE id=$1', [matchId]);
    return this._matchRow(r.rows[0]);
  }

  async deleteMatch(matchId) {
    const r = await this.pool.query('DELETE FROM matches WHERE id=$1', [matchId]);
    return r.rowCount > 0;
  }
}

// ----------------------------------------------------------------------------

export async function createStore() {
  const url = process.env.DATABASE_URL;
  const store = url ? new PgStore(url) : new MemoryStore();
  await store.init();
  store.backend = url ? 'postgres' : 'memory';
  return store;
}
