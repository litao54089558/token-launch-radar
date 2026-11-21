// Harbor Radar's model ("harbor-1"): one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) and adds pre-token protocols below the floor, chosen by implied
// value, not by raw TVL: the early rows the radar exists to find. A protocol
// is pre-token when its record carries no token (no market cap, no CoinGecko
// id, no symbol); live-token protocols are kept apart and shown with the
// market's own value, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, in four
// factors the dashboard shows for every row:
//
//   category multiple  how much of a dollar of TVL this kind of business
//                       can turn into token value (lending spreads and
//                       chain fees monetise TVL harder than bridge tolls)
//   growth factor      the 7-day TVL change, clamped, with falls punished
//                       a little harder than rises are rewarded
//   age factor         how long the protocol has run with no token:
//                       a saturating curve, so a 5-year record beats a
//                       6-month one but a 10-year one barely beats 5
//   breadth factor     a small premium for running on several chains
//
//   implied = tvl_usd x categoryMultiple x growthFactor x ageFactor
//             x breadthFactor, rounded to whole dollars.
//
// No protocol name is ever special-cased: the same function scores every
// row, and the dashboard prints the four factors beside the result.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  growth_up_weight: number;
  growth_down_weight: number;
  growth_min: number;
  growth_max: number;
  age_half_life_days: number;
  age_floor: number;
  age_unknown: number;
  breadth_per_chain: number;
  breadth_max: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -50,
  growth_cap: 150,
  growth_up_weight: 0.9,
  growth_down_weight: 1.1,
  growth_min: 0.45,
  growth_max: 2.2,
  age_half_life_days: 540,
  age_floor: 0.55,
  age_unknown: 0.72,
  breadth_per_chain: 0.04,
  breadth_max: 1.16,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'harbor-1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by implied value. */
export const EARLY_ROWS = 200;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_factor: number;
    age_factor: number;
    breadth_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm steps included so the page shows board.json's own plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_factor: number;
  age_factor: number;
  breadth_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * What one dollar of this category's TVL is worth as token value. Ordered
 * rules, most specific first: a bridge's tolls and a staked receipt are
 * worth less per TVL dollar than a lender's spread or a chain's fees.
 */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c === 'chain') return 0.34;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 0.3;
  if (c.includes('risk curator') || c.includes('capital allocator')) return 0.28;
  if (c.includes('rwa') || c.includes('real world')) return 0.26;
  if (c.includes('yield') || c.includes('leveraged farm') || c === 'farm') return 0.24;
  if (c.includes('dex')) return 0.22;
  if (c.includes('derivative') || c.includes('basis trad') || c.includes('perpetual')) return 0.2;
  if (c.includes('payment')) return 0.2;
  if (c.includes('insurance')) return 0.18;
  if (c.includes('stablecoin')) return 0.18;
  if (c.includes('governance') || c.includes('cedefi')) return 0.16;
  if (c.includes('bridge')) return 0.12;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool')) return 0.1;
  if (c.includes('staking')) return 0.14;
  return 0.2;
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; catMult: number; growthPct: number; growthF: number; ageF: number; breadthF: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const catMult = categoryMultiple(protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_up_weight : model.growth_down_weight;
  const growthF = Math.min(model.growth_max, Math.max(model.growth_min, 1 + (growthPct / 100) * weight));
  const ageF = age === null ? model.age_unknown : model.age_floor + (1 - model.age_floor) * (1 - Math.exp(-age / model.age_half_life_days));
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), 4);
  const breadthF = Math.min(model.breadth_max, 1 + extraChains * model.breadth_per_chain);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * catMult * growthF * ageF * breadthF));
  return { implied, catMult, growthPct, growthF, ageF, breadthF, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug in it is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rank every rankable pre-token protocol below the floor
  // by implied value (not by raw TVL) and take the strongest.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, model).implied }))
    .sort((a, b) => b.score - a.score || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: s.v.catMult,
      growth_pct: s.v.growthPct,
      growth_factor: round4(s.v.growthF),
      age_factor: round4(s.v.ageF),
      breadth_factor: round4(s.v.breadthF),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
  // The gate refuses a board whose implied values do not fall strictly with
  // rank, so force strict descent: a row that ties the one above loses $1.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd >= rows[i - 1]!.implied_value_usd) {
      rows[i]!.implied_value_usd = Math.max(1, rows[i - 1]!.implied_value_usd - 1);
    }
  }
  return rows;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** What one transaction costs on the protocol's first chain, in the step's own words. */
function gasFor(p: SnapshotProtocol): string {
  const chain = (p.chains[0] ?? '').toLowerCase();
  if (chain.includes('ethereum')) return 'about $12 of gas';
  if (chain.includes('solana')) return 'about $0.10 of gas';
  if (chain.includes('base') || chain.includes('arbitrum') || chain.includes('optimism')) return 'about $2 of gas';
  if (chain.includes('bnb') || chain.includes('binance') || chain.includes('polygon')) return 'about $0.50 of gas';
  if (chain.includes('avalanche')) return 'about $1 of gas';
  return 'about $3 of gas';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's entry action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c === 'chain') return `Bridge $${capital} of USDC to ${name} and use its flagship app once so the address is active on the chain.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a small amount against it, and keep both legs open.`;
  if (c.includes('risk curator') || c.includes('capital allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares so the vault's points accrue to this wallet.`;
  if (c.includes('rwa') || c.includes('real world')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it in the farming wallet.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c === 'farm') return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and leave the yield compounding.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range.`;
  if (c.includes('derivative') || c.includes('basis trad') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge, then leave it open.`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and place one market position on ${name} that settles after a week.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and spend the bridged funds inside its app.`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the wallet.`;
  if (c.includes('stablecoin')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the balance.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full term.`;
  if (c.includes('payment')) return `Route $${capital} of real payments through ${name} on ${chain} across at least two separate weeks.`;
  if (c.includes('governance') || c.includes('cedefi')) return `Deposit $${capital} into ${name} on ${chain} and vote once on its live proposal.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly action: the repeatable habit that keeps the wallet counted. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c === 'chain') return `Use the chain's flagship app once a week from the same wallet.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Repay a small slice of the borrow and re-borrow it, so the position shows fresh activity.`;
  if (c.includes('risk curator') || c.includes('capital allocator')) return `Add a small top-up to the vault and check the points balance on the protocol's own page.`;
  if (c.includes('rwa') || c.includes('real world')) return `Check the yield accrual and add a small amount to the position if the rate still holds.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c === 'farm') return `Claim the vault's yield and re-deposit it instead of withdrawing.`;
  if (c.includes('dex')) return `Swap a small amount through the pool and check the position is still in range.`;
  if (c.includes('derivative') || c.includes('basis trad') || c.includes('perpetual')) return `Close the hedge and reopen it at the new price, keeping the margin untouched.`;
  if (c.includes('prediction')) return `Place one more small market position that settles the following week.`;
  if (c.includes('bridge')) return `Bridge a small amount onward to another chain the protocol supports.`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking')) return `Check the staking rewards and restake them through the same protocol.`;
  if (c.includes('stablecoin')) return `Mint or redeem a small amount of the stable asset to keep the balance moving.`;
  if (c.includes('insurance')) return `Review the cover terms and extend the policy if the term is ending.`;
  if (c.includes('payment')) return `Make one more payment through the protocol from the same wallet.`;
  if (c.includes('governance') || c.includes('cedefi')) return `Vote on the newest proposal or join the protocol's governance discussion.`;
  return `Make one qualifying action, such as a deposit, a swap or a vote.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * Steps 2 and 3 follow the protocol's own category; the gas figure follows
 * its first chain; capital follows its TVL; the hold follows its age.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: gas.replace('of gas', 'of gas a week'),
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan included so the page shows board.json's own steps. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_factor: row.model.growth_factor,
    age_factor: row.model.age_factor,
    breadth_factor: row.model.breadth_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
