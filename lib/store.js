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

  async addPlayer(poolId, name, isCommissioner = false) {
    const player = {
      id: id(),
      poolId,
      name,
      token: id(),
      isCommissioner,
      createdAt: new Date().toISOString(),
    };
    this.players.set(player.id, player);
    return player;
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

  async listMatches() {
    return [...this.matches].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addMatch(m) {
    const row = { id: id(8), createdAt: new Date().toISOString(), ...m };
    this.matches.push(row);
    return row;
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

  async addPlayer(poolId, name, isCommissioner = false) {
    const playerId = id();
    const token = id();
    const r = await this.pool.query(
      `INSERT INTO players (id, pool_id, name, token, is_commissioner)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [playerId, poolId, name, token, isCommissioner]
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

  async listMatches() {
    const r = await this.pool.query('SELECT * FROM matches ORDER BY created_at ASC');
    return r.rows.map((x) => ({
      id: x.id, teamA: x.team_a, teamB: x.team_b,
      scoreA: x.score_a, scoreB: x.score_b, stage: x.stage, createdAt: x.created_at,
    }));
  }

  async addMatch(m) {
    const mid = id(8);
    const r = await this.pool.query(
      `INSERT INTO matches (id, team_a, team_b, score_a, score_b, stage)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [mid, m.teamA, m.teamB, m.scoreA ?? null, m.scoreB ?? null, m.stage ?? null]
    );
    const x = r.rows[0];
    return { id: x.id, teamA: x.team_a, teamB: x.team_b, scoreA: x.score_a, scoreB: x.score_b, stage: x.stage, createdAt: x.created_at };
  }

  async updateMatch(matchId, fields) {
    const map = { teamA: 'team_a', teamB: 'team_b', scoreA: 'score_a', scoreB: 'score_b', stage: 'stage' };
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
    const x = r.rows[0];
    return x ? { id: x.id, teamA: x.team_a, teamB: x.team_b, scoreA: x.score_a, scoreB: x.score_b, stage: x.stage, createdAt: x.created_at } : null;
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
