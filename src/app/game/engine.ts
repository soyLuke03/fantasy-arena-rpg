/**
 * MOTOR DE FANTASY ARENA (TypeScript puro, sin Angular ni Supabase).
 *
 * Este archivo contiene las reglas, no la interfaz. Lee primero
 * docs/GUIA_DEL_CODIGO.md antes de cambiarlo.
 *
 * Flujo principal: newGame → draftSeason → mercado/plantilla →
 * playNextBout (cinco veces) → finalizeMatch → nextDay o beginNextSeason.
 *
 * REGLA ESENCIAL: no modificar atributos permanentes después de cada batalla.
 * REGLA ESENCIAL: cada equipo recibe SOLO sus reemplazos, nunca las bajas rivales.
 * REGLA ESENCIAL: un Mítico conserva sus estadísticas base en todas las temporadas.
 */
import { CATALOG, MYTHICS, NORMAL_CHAMPIONS } from './catalog';
import { BLESSINGS, BlessingKey, Bout, CLASSES, GameState, Hero, HeroChange, HeroClass, HeroTemplate, MatchResult, Mode, SeasonDuration, Side, StatMode, Stats, Team, TradeOffer, MythicAuction, QUALITY, TacticalOrder, BattleLine, FighterFrame, BattleTurn } from './models';

export const START_GOLD = 250;
export const MAX_HEROES = 5; // Número de combatientes simultáneos
export const MAX_OWNED_HEROES = 25; // Los demás se quedan en el almacén
export const DEATH_LIMIT = 3;
export const PERSONAL_SHOP_SLOTS = 6;
export const STORAGE_KEY = 'fantasy-arena-local-v1';
export const MARKET_REFRESH_BASE = 2; // 1 + (1 + n), n = renovaciones previas en esta jornada.
export const WIN_GOLD = 28;
export const LOSS_GOLD = 3;
export const KILL_GOLD = 4;
export const SAVE_GOLD = 7;
export const DAILY_GOLD_REWARD = 0; // Compatibilidad: recompensas solo por acciones y resultado.
export const SEASON_LENGTHS: readonly SeasonDuration[] = [3, 7, 15, 30];
export const DAY_MS = 24 * 60 * 60 * 1000;
export const STAT_VARIATION = { health: 0.10, attack: 0.10, defense: 0.10, speed: 0.10 } as const;
export const globalMarketCapacity = (players: number): number => PERSONAL_SHOP_SLOTS * Math.max(0, Math.floor(players));
export const LOCAL_PLAYERS = 2; // Modo de prueba A vs B. La arquitectura online admitirá más.
export const marketRefreshCost = (state: GameState, side: Side = 'a'): number => MARKET_REFRESH_BASE + teamFor(state, side).marketRolls;

/** Generador pseudoaleatorio con semilla, para repetir combates idénticos. No usar Math.random para sorteos del motor. */
export class Random {
  private state: number;
  constructor(state: number) { this.state = (state >>> 0) || 0x6d2b79f5; }
  static fromSeed(seed: string): Random {
    let n = 2166136261;
    for (let i = 0; i < seed.length; i++) { n ^= seed.charCodeAt(i); n = Math.imul(n, 16777619); }
    return new Random(n >>> 0);
  }
  next(): number {
    let x = this.state;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }
  int(max: number): number { return Math.floor(this.next() * max); }
  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error('No hay elementos disponibles.');
    return items[this.int(items.length)];
  }
  take<T>(items: readonly T[], howMany: number): T[] {
    const pool = [...items]; const result: T[] = [];
    while (pool.length && result.length < howMany) result.push(pool.splice(this.int(pool.length), 1)[0]);
    return result;
  }
  getState(): number { return this.state; }
}

// +1 indica ventaja; -1 desventaja; 0 equilibrio. Cruces excepto Mago: valores provisionales.
const WINS: Record<HeroClass, HeroClass[]> = {
  Mago: ['Bestia', 'Apoyo', 'Guerrero'],
  Guerrero: ['Asesino', 'Tanque'],
  Asesino: ['Mago', 'Apoyo'],
  Apoyo: ['Guerrero', 'Tanque'],
  Tanque: ['Asesino', 'Bestia'],
  Bestia: ['Guerrero', 'Asesino', 'Apoyo']
};
/** Modificador triangular de clases: 1 ventaja, 0 neutral, -1 desventaja. */
export function classAdvantage(attacker: HeroClass, defender: HeroClass): -1 | 0 | 1 {
  if (attacker === defender || (attacker === 'Mago' && defender === 'Tanque') || (attacker === 'Tanque' && defender === 'Mago')) return 0;
  if (WINS[attacker].includes(defender)) return 1;
  return WINS[defender].includes(attacker) ? -1 : 0;
}
export function makeHero(template: HeroTemplate): Hero {
  return { ...template, stats: { ...template.stats }, level: 0, purchasePrice: template.price };
}
function teamFor(state: GameState, side: Side): Team { return side === 'a' ? state.teamA : state.teamB; }
function other(side: Side): Side { return side === 'a' ? 'b' : 'a'; }
function excludeOwned(state: GameState): Set<string> {
  return new Set([...state.teamA.heroes, ...state.teamB.heroes].map(hero => hero.id));
}
/** Pool único de temporada: un héroe fichado o sorteado nunca vuelve al mercado, aunque se venda. */
function unavailable(state: GameState): Set<string> {
  return new Set([...state.seasonUnavailableIds, ...excludeOwned(state)]);
}
export function marketFor(state: GameState, side: Side): Hero[] {
  return state.markets[side];
}
export function visibleMarketCount(state: GameState): number {
  return state.markets.a.length + state.markets.b.length;
}
/** Mismo número de ofertas en TODAS las tiendas, cada una con su mazo exclusivo. */
export function personalMarketSlots(_side: Side, _players = LOCAL_PLAYERS): number {
  return PERSONAL_SHOP_SLOTS;
}
/** El reparto es permanente durante la temporada; no se intercambian cartas entre jugadores. */
export function personalDeck(state: GameState, side: Side): Hero[] {
  return state.playerDecks[side].map(id => state.seasonHeroes[id]);
}
export function personalDeckRemaining(state: GameState, side: Side): number {
  const blocked = unavailable(state);
  return state.playerDecks[side].filter(id => !blocked.has(id)).length;
}
/** Reparto equilibrado por clase y rareza, reproducible con la semilla de temporada. */
function dealDecks(rng: Random, reserved?: Record<Side, string[]>): Record<Side, string[]> {
  const decks: Record<Side, string[]> = { a: [...new Set(reserved?.a ?? [])], b: [...new Set(reserved?.b ?? [])] };
  const assigned = new Set([...decks.a, ...decks.b]);
  const allTiers = ['Común', 'Raro', 'Épico', 'Legendario'] as const;
  for (const role of CLASSES) for (const tier of allTiers) {
    const group = rng.take(NORMAL_CHAMPIONS.filter(h => h.className === role && h.tier === tier && !assigned.has(h.id)), CATALOG.length);
    let countA = decks.a.filter(id => CATALOG.some(h => h.id === id && h.className === role && h.tier === tier)).length;
    let countB = decks.b.filter(id => CATALOG.some(h => h.id === id && h.className === role && h.tier === tier)).length;
    for (const h of group) {
      const side: Side = countA === countB ? (rng.int(2) === 0 ? 'a' : 'b') : countA < countB ? 'a' : 'b';
      decks[side].push(h.id); assigned.add(h.id);
      if (side === 'a') countA++; else countB++;
    }
  }
  return decks;
}
function shopCandidates(state: GameState, side: Side, includeOwn = false): HeroTemplate[] {
  const excluded = new Set<string>(includeOwn ? [] : state.markets[side].map(h => h.id));
  const banned = unavailable(state);
  return NORMAL_CHAMPIONS.filter(h => state.playerDecks[side].includes(h.id) && !excluded.has(h.id) && !banned.has(h.id));
}
/** Primero cartas aún no vistas; al agotarse, reciclamos las no compradas del mazo propio. */
function newOfferCards(state: GameState, side: Side, rng: Random, count: number, includeOwn = false): HeroTemplate[] {
  const candidates = shopCandidates(state, side, includeOwn);
  const seen = new Set(state.seenMarketIds[side]);
  const unseen = rng.take(candidates.filter(h => !seen.has(h.id)), count);
  const extra = rng.take(candidates.filter(h => seen.has(h.id)), count - unseen.length);
  const cards = [...unseen, ...extra];
  for (const h of cards) if (!seen.has(h.id)) { state.seenMarketIds[side].push(h.id); seen.add(h.id); }
  return cards;
}
function fillShop(state: GameState, side: Side, rng: Random): void {
  const missing = Math.max(0, personalMarketSlots(side) - state.markets[side].length);
  for (const template of newOfferCards(state, side, rng, missing))
    state.markets[side].push(cloneHero(state.seasonHeroes[template.id]));
}
function fillMarkets(state: GameState, rng: Random): void {
  fillShop(state, 'a', rng);
  fillShop(state, 'b', rng);
}
function cloneHero(hero: Hero): Hero { return { ...hero, stats: { ...hero.stats } }; }
function botSetup(state: GameState, rng: Random): void {
  const team = state.teamB;
  team.dailyBlessing ??= rng.pick(state.dailyBlessingChoices.b);
  // La IA compra EXCLUSIVAMENTE desde su tienda privada, respetando la reserva del rival.
  if (state.mythicalAuction?.status === 'open' && team.gold >= state.mythicalAuction.minimum + 5 && team.heroes.length < 5) {
    // Rival: participa en la subasta en vez de gastar todo su oro en héroes comunes.
    state.mythicalAuction.bids.b = state.mythicalAuction.minimum + 5;
    team.blessing ??= rng.pick(state.blessingChoices);
    return;
  }
  const offers = rng.take(state.markets.b, state.markets.b.length)
    .sort((a, b) => (a.tier === 'Épico' ? 0 : a.tier === 'Raro' ? 1 : 2) - (b.tier === 'Épico' ? 0 : b.tier === 'Raro' ? 1 : 2));
  for (const offer of offers) {
    if (team.heroes.length >= MAX_HEROES) break;
    if (team.gold >= offer.price) {
      buyFromPrivateShop(state, 'b', offer.id, rng);
    }
  }
  if (!team.blessing) team.blessing = rng.pick(state.blessingChoices);
  const affordable = team.heroes.filter(h => h.tier !== 'Mítico' && team.gold >= heroUpgradeCost(h) && h.level < h.maxLevel);
  if (affordable.length) { const h = rng.pick(affordable); upgradeHeroDirect(team, h); syncHero(state, h); }
}
function syncHero(state: GameState, hero: Hero): void {
  state.seasonHeroes[hero.id] = cloneHero(hero);
}
function initialSeasonStats(template: HeroTemplate, rng: Random, mode: StatMode): Hero {
  const hero = makeHero(template);
  if (mode === 'random' && template.tier !== 'Mítico') {
    // Se sortea una vez por temporada. Nunca se vuelve a tirar al renovar el mercado.
    for (const key of ['health', 'attack', 'defense', 'speed'] as const) {
      const variation = STAT_VARIATION[key];
      hero.stats[key] = Math.max(1, Math.round(template.stats[key] * (1 + (rng.next() * 2 - 1) * variation)));
    }
  }
  return hero;
}
function draftSeason(state: GameState, rng: Random): void {
  state.seasonComplete = false;
  state.seasonHeroes = Object.fromEntries(CATALOG.map(template => [template.id, initialSeasonStats(template, rng, state.statMode)]));
  state.seasonBaseStats = Object.fromEntries(Object.values(state.seasonHeroes).map(h => [h.id, { ...h.stats }]));
  state.emergencyResets = { a: 0, b: 0 };
  state.markets = { a: [], b: [] };
  state.tradeOffers = [];
  state.nextTradeId = 1;
  state.playerDecks = dealDecks(rng);
  state.seenMarketIds = { a: [], b: [] };
  const draftFor = (side: Side) => rng.take(NORMAL_CHAMPIONS.filter(h => state.playerDecks[side].includes(h.id) && h.minTier === 'Común'), 3);
  const startersA = draftFor('a'); const startersB = draftFor('b');
  if (startersA.length < 3 || startersB.length < 3) throw new Error('Cada jugador necesita tres campeones comunes en su mazo.');
  state.teamA = { tactics: {}, name: 'Tu equipo', gold: START_GOLD, heroes: startersA.map(h => cloneHero(state.seasonHeroes[h.id])), activeIds: startersA.map(h => h.id), blessing: null, dailyBlessing: null, marketRolls: 0 };
  state.teamB = { tactics: {}, name: state.mode === 'bot' ? 'Rival IA' : 'Equipo B', gold: START_GOLD, heroes: startersB.map(h => cloneHero(state.seasonHeroes[h.id])), activeIds: startersB.map(h => h.id), blessing: null, dailyBlessing: null, marketRolls: 0 };
  state.seasonUnavailableIds = [...startersA, ...startersB].map(h => h.id);
  state.blessingChoices = rng.take(Object.keys(BLESSINGS) as BlessingKey[], 3);
  state.dailyBlessingChoices = { a: [], b: [] };
  state.currentBouts = []; state.eliminatedThisDay = { a: [], b: [] }; state.fallenDraftIds = { a: [], b: [] };
  setupDailyBlessings(state, rng);
  state.mythicalAuction = null;
  state.mythicSeenSeason = false;
  // Aparición excepcional: una única oportunidad por temporada y reserva global separada.
  if (rng.next() < 0.08) openMythicAuction(state, rng);
  fillMarkets(state, rng);
  if (state.mode === 'bot') botSetup(state, rng);
  state.result = null;
  state.rngState = rng.getState();
}
/** Crea el estado completo de una nueva partida local, con dos mazos exclusivos. */
export function newGame(seed = 'ARENA-01', mode: Mode = 'bot', durationDays: SeasonDuration = 7, statMode: StatMode = 'fixed', now = Date.now()): GameState {
  const rng = Random.fromSeed(seed.trim() || 'ARENA-01');
  if (!SEASON_LENGTHS.includes(durationDays)) throw new Error('La duración debe ser 3, 7, 15 o 30 días.');
  const state: GameState = {
    version: 9, seasonComplete: false, seed: seed.trim() || 'ARENA-01', rngState: 0, season: 1, day: 1, durationDays, mode,
    seasonStartedAt: now, seasonEndsAt: now + durationDays * DAY_MS, statMode, seasonHeroes: {},
    scoreA: 0, scoreB: 0, winsA: 0, winsB: 0,
    teamA: { tactics: {}, name: 'Tu equipo', gold: START_GOLD, heroes: [], activeIds: [], blessing: null, dailyBlessing: null, marketRolls: 0 },
    teamB: { tactics: {}, name: 'Rival IA', gold: START_GOLD, heroes: [], activeIds: [], blessing: null, dailyBlessing: null, marketRolls: 0 },
    emergencyResets: { a: 0, b: 0 }, markets: { a: [], b: [] }, playerDecks: { a: [], b: [] }, seenMarketIds: { a: [], b: [] }, seasonUnavailableIds: [], tradeOffers: [], nextTradeId: 1, mythicalAuction: null, mythicSeenSeason: false, seasonBaseStats: {}, blessingChoices: [], dailyBlessingChoices: { a: [], b: [] }, currentBouts: [], eliminatedThisDay: { a: [], b: [] }, fallenDraftIds: { a: [], b: [] }, result: null, history: [], records: []
  };
  state.seasonComplete = false;
  draftSeason(state, rng); return state;
}
/** Impide ventas, mejoras y compras desde la primera batalla de una jornada. */
export function canModify(state: GameState, side: Side): boolean { return !state.result && state.currentBouts.length === 0 && (side === 'a' || state.mode === 'manual'); }
/** Permite reordenar titulares y cambiar órdenes únicamente mientras la jornada siga abierta. */
export function canRotate(state: GameState, side: Side): boolean { return !state.result && (side === 'a' || state.mode === 'manual'); }
export function isActive(state: GameState, side: Side, id: string): boolean { return teamFor(state, side).activeIds.includes(id); }
/** Suma muertes únicamente de este campeón y este equipo en la jornada abierta. */
export function deathCount(state: GameState, side: Side, id: string): number { return state.currentBouts.reduce((total, b) => total + (b.changes.find(c => c.side === side && c.id === id)?.deaths ?? 0), 0); }
/** Intercambia campeón titular y reserva sin borrar las muertes ya acumuladas. */
export function rotateHero(state: GameState, side: Side, outId: string, inId: string): string {
  if (!canRotate(state, side)) return 'No puedes sustituir campeones ahora.';
  const team = teamFor(state, side);
  if (!team.activeIds.includes(outId) || team.activeIds.includes(inId) || !team.heroes.some(h => h.id === inId)) return 'Elige un titular y un campeón del almacén.';
  if (deathCount(state, side, inId) >= DEATH_LIMIT) return 'Ese campeón ya está eliminado esta jornada.';
  team.activeIds = team.activeIds.map(id => id === outId ? inId : id);
  return 'Sustitución realizada. Las muertes acumuladas de ambos campeones se conservan.';
}
/**
 * Cambia un campeón entre delantera y retaguardia (o dentro de la misma línea).
 * Solo reordena las casillas: no modifica atributos, oro ni muertes.
 */
export function swapFormationSlots(state: GameState, side: Side, first: number, second: number): string {
  if (!canRotate(state, side)) return 'La formación está bloqueada al cerrar la jornada.';
  const ids = teamFor(state, side).activeIds;
  if (!Number.isInteger(first) || !Number.isInteger(second) || first < 0 || second < 0 || first >= ids.length || second >= ids.length)
    return 'Selecciona dos posiciones ocupadas.';
  [ids[first], ids[second]] = [ids[second], ids[first]];
  return 'Posiciones intercambiadas. La formación se aplicará en la siguiente batalla.';
}
/**
 * El jugador puede ajustar órdenes incluso después de una batalla.
 * No altera batallas ya celebradas. La IA del modo local utiliza Equilibrado.
 */
export function setTacticalOrder(state: GameState, side: Side, id: string, order: TacticalOrder): string {
  if (!canRotate(state, side)) return 'No puedes cambiar órdenes al cerrar la jornada.';
  const team = teamFor(state, side);
  if (!team.heroes.some(h => h.id === id)) return 'El campeón no está en tu plantilla.';
  if (!['aggressive', 'balanced', 'defensive'].includes(order)) return 'Orden táctica desconocida.';
  team.tactics ??= {};
  team.tactics[id] = order;
  return `Orden de ${team.heroes.find(h => h.id === id)!.name}: ${order === 'aggressive' ? 'Agresiva' : order === 'defensive' ? 'Defensiva' : 'Equilibrada'}.`;
}
/** La posición se deriva del orden de activeIds, no de un atributo de clase. */
export function positionOf(team: Team, id: string): BattleLine | null {
  const slot = team.activeIds.indexOf(id);
  return slot < 0 ? null : slot < 2 ? 'front' : 'back';
}

/** Equipa o desequipa un campeón: mínimo tres, máximo cinco. */
export function toggleActive(state: GameState, side: Side, id: string): string {
  if (!canRotate(state, side)) return 'La alineación no se puede editar ahora.';
  const team = teamFor(state, side);
  if (!team.heroes.some(h => h.id === id)) return 'Ese personaje no está en tu almacén.';
  if (team.activeIds.includes(id)) { if (team.activeIds.length <= 3) return 'Necesitas un mínimo de 3 titulares.'; team.activeIds = team.activeIds.filter(x => x !== id); return 'Campeón enviado al almacén.'; }
  if (team.activeIds.length >= MAX_HEROES) return 'Cinco titulares como máximo. Retira antes a otro.';
  team.activeIds.push(id); return 'Campeón añadido a la alineación.';
}
function setupDailyBlessings(state: GameState, rng: Random): void {
  const keys = Object.keys(BLESSINGS) as BlessingKey[];
  const choices = (side: Side): BlessingKey[] => {
    const myScore = side === 'a' ? state.scoreA : state.scoreB;
    const theirScore = side === 'a' ? state.scoreB : state.scoreA;
    const preferred: BlessingKey[] = myScore < theirScore ? ['iron', 'life', 'swift'] : myScore > theirScore ? ['arcane', 'hunt', 'fury'] : keys;
    const first = rng.pick(preferred);
    return [first, ...rng.take(keys.filter(k => k !== first), 2)];
  };
  state.dailyBlessingChoices = { a: choices('a'), b: choices('b') };
  state.teamA.dailyBlessing = null; state.teamB.dailyBlessing = null;
}
export function chooseDailyBlessing(state: GameState, side: Side, key: BlessingKey): string {
  if (!canModify(state, side)) return 'La bendición de jornada se bloquea al empezar la primera batalla.';
  if (!state.dailyBlessingChoices[side].includes(key)) return 'La bendición no está disponible para tu equipo.';
  teamFor(state, side).dailyBlessing = key; return 'Bendición temporal de esta jornada seleccionada.';
}
function buyFromPrivateShop(state: GameState, side: Side, id: string, existingRng?: Random): string {
  const team = teamFor(state, side);
  if (team.heroes.length >= MAX_OWNED_HEROES) return 'El almacén está completo.';
  const hero = state.markets[side].find(h => h.id === id);
  if (!hero) return 'El personaje no está en tu tienda privada.';
  if (team.gold < hero.price) return 'No tienes oro suficiente.';
  if (unavailable(state).has(hero.id)) return 'Ese personaje ya fue obtenido esta temporada.';
  team.gold -= hero.price;
  const purchased = cloneHero(state.seasonHeroes[hero.id]);
  purchased.purchasePrice = hero.price;
  team.heroes.push(purchased);
  if (team.activeIds.length < MAX_HEROES) team.activeIds.push(purchased.id);
  syncHero(state, purchased);
  state.markets[side] = state.markets[side].filter(h => h.id !== id);
  state.seasonUnavailableIds.push(hero.id);
  // La venta posterior no devuelve el personaje al mercado esta temporada.
  const rng = existingRng ?? new Random(state.rngState);
  fillShop(state, side, rng);
  if (!existingRng) state.rngState = rng.getState();
  return `${hero.name} se ha unido a ${team.name}.`;
}
export function buyHero(state: GameState, side: Side, id: string): string {
  if (!canModify(state, side)) return 'El mercado está cerrado para ese equipo.';
  return buyFromPrivateShop(state, side, id);
}
/** Precio de compra del propietario actual; draft inicial: precio base del catálogo. */
export function minimumOffer(hero: Hero): number {
  return Math.max(1, Number.isSafeInteger(hero.purchasePrice) && (hero.purchasePrice as number) > 0 ? hero.purchasePrice! : hero.price);
}
/** Solicitar comprar un héroe al rival, aun si procede del mazo privado del rival. */
export function requestPurchase(state: GameState, buyer: Side, heroId: string, amount: number): string {
  if (!canModify(state, buyer)) return 'Solo puedes negociar durante la preparación de la jornada.';
  const seller = other(buyer);
  const mine = teamFor(state, buyer), theirs = teamFor(state, seller);
  const hero = theirs.heroes.find(h => h.id === heroId);
  if (!hero) return 'El personaje no pertenece actualmente al equipo rival.';
  if (hero.tier === 'Mítico') return 'Los Míticos solo pueden obtenerse mediante subasta.';
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'Introduce una oferta de oro entera y positiva.';
  const minimum = minimumOffer(hero);
  if (amount < minimum) return `La oferta mínima por ${hero.name} es ${minimum} de oro.`;
  if (mine.gold < amount) return 'No tienes oro suficiente para realizar esa oferta.';
  if (mine.heroes.length >= MAX_OWNED_HEROES) return 'Tu almacén está completo.';
  if (theirs.heroes.length <= 3) return 'El vendedor debe conservar un mínimo de tres personajes.';
  if (state.tradeOffers.some(o => o.status === 'pending' && o.buyer === buyer && o.heroId === heroId))
    return 'Ya tienes una oferta pendiente por ese personaje.';
  const offer: TradeOffer = {    
id: `T${state.season}-${state.nextTradeId++}`, season: state.season, day: state.day,
    buyer, seller, heroId: hero.id, heroName: hero.name, amount, minPrice: minimum, status: 'pending'  
};
  state.tradeOffers.push(offer);
  // En modo bot, la IA valora la propuesta inmediatamente. Umbral provisional para pruebas.
  if (state.mode === 'bot' && seller === 'b') {
    if (amount >= Math.ceil(minimum * 1.4)) {
      // Para vender, también la IA debe sacar al campeón de la alineación.
      if (theirs.activeIds.includes(heroId)) {
        if (theirs.activeIds.length > 3) theirs.activeIds = theirs.activeIds.filter(id => id !== heroId);
        else {
          const replacement = theirs.heroes.find(h => !theirs.activeIds.includes(h.id));
          if (replacement) theirs.activeIds = theirs.activeIds.map(id => id === heroId ? replacement.id : id);
        }
      }
      if (theirs.activeIds.includes(heroId)) {
        offer.status = 'rejected';
        return 'La IA rechaza la oferta: no puede sacar al campeón de su alineación.';
      }
      return respondToPurchase(state, offer.id, 'b', true);
    }
    offer.status = 'rejected';
    return `La IA rechaza ${amount} de oro por ${hero.name} (busca al menos un 40 % por encima de su coste).`;
  }
  return `Oferta enviada: ${amount} de oro por ${hero.name}. El propietario podrá aceptarla o rechazarla.`;
}
/** Aceptar o rechazar solamente como el propietario del héroe solicitado. */
export function respondToPurchase(state: GameState, offerId: string, actingSide: Side, accept: boolean): string {
  const offer = state.tradeOffers.find(o => o.id === offerId);
  if (!offer || offer.status !== 'pending') return 'La oferta no está pendiente.';
  if (offer.seller !== actingSide) return 'Solo el propietario puede responder a esta oferta.';
  if (state.result || state.currentBouts.length > 0) return 'Los traspasos están bloqueados durante todas las batallas de esta jornada.';
  if (!accept) { offer.status = 'rejected'; return `Oferta rechazada por ${offer.heroName}.`; }
  const buyer = teamFor(state, offer.buyer), seller = teamFor(state, offer.seller);
  const hero = seller.heroes.find(h => h.id === offer.heroId);
  if (!hero) { offer.status = 'expired'; return 'El campeón ya no está en ese equipo. Oferta caducada.'; }
  if (hero.tier === 'Mítico') return 'Los Míticos no se pueden traspasar.';
  if (buyer.heroes.length >= MAX_OWNED_HEROES) return 'No se puede aceptar: el almacén del comprador está completo.';
  if (seller.heroes.length <= 3) return 'No se puede aceptar: el vendedor se quedaría con menos de tres personajes.';
  if (seller.activeIds.includes(hero.id)) return 'Antes de aceptar, el vendedor debe desequipar al campeón y dejarlo en el almacén.';
  if (buyer.gold < offer.amount) return 'No se puede aceptar: el comprador ya no tiene oro suficiente.';
  if (offer.amount < minimumOffer(hero)) return 'No se puede aceptar: el mínimo de compra ha cambiado.';
  // Operación atómica en memoria local. En Supabase será una transacción en PostgreSQL.
  buyer.gold -= offer.amount;
  seller.gold += offer.amount;
  seller.heroes = seller.heroes.filter(h => h.id !== hero.id);
  seller.activeIds = seller.activeIds.filter(id => id !== hero.id);
  const transferred = cloneHero(hero);
  transferred.purchasePrice = offer.amount;
  buyer.heroes.push(transferred);
  if (buyer.activeIds.length < MAX_HEROES) buyer.activeIds.push(transferred.id);
  syncHero(state, transferred);
  offer.status = 'accepted';
  for (const p of state.tradeOffers) if (p.id !== offer.id && p.status === 'pending' && p.heroId === hero.id) p.status = 'expired';
  return `${hero.name} cambia de equipo por ${offer.amount} de oro. Conserva sus estadísticas y nivel.`;
}
export function cancelPurchase(state: GameState, offerId: string, actingSide: Side): string {
  const offer = state.tradeOffers.find(o => o.id === offerId);
  if (!offer || offer.status !== 'pending') return 'La oferta no está pendiente.';
  if (offer.buyer !== actingSide) return 'Solo quien envió la oferta puede cancelarla.';
  if (state.result || state.currentBouts.length > 0) return 'Los traspasos están bloqueados durante todas las batallas de esta jornada.';
  offer.status = 'cancelled';
  return 'Oferta cancelada.';
}
function expirePendingTrades(state: GameState): void {
  for (const offer of state.tradeOffers) if (offer.status === 'pending') offer.status = 'expired';
}
export function sellHero(state: GameState, side: Side, id: string): string {
  if (!canModify(state, side)) return 'No puedes vender después de combatir.';
  const team = teamFor(state, side);
  if (team.heroes.length <= 3) return 'Debes conservar al menos tres personajes.';
  const hero = team.heroes.find(h => h.id === id);
  if (!hero) return 'Personaje no encontrado.';
  if (hero.tier === 'Mítico') return 'Los Míticos no se venden: se consiguen solo por subastas.';
  if (team.activeIds.includes(id)) return 'Debes desequipar al campeón y mandarlo al almacén antes de venderlo.';
  const refund = Math.floor(hero.price * .7) + hero.level * 6;
  team.gold += refund;
  team.heroes = team.heroes.filter(h => h.id !== id);
  team.activeIds = team.activeIds.filter(x => x !== id);
  for (const offer of state.tradeOffers) if (offer.status === 'pending' && offer.heroId === hero.id) offer.status = 'expired';
  syncHero(state, hero);
  // No se repone en ninguna tienda: los personajes vendidos quedan retirados de esta temporada.
  return `${hero.name} vendido por ${refund} de oro.`;
}
export const LEVEL_BONUS: Stats = { health: 10, attack: 3, defense: 2, speed: 1 };
export const QUALITY_BONUS: Stats = { health: 14, attack: 4, defense: 3, speed: 1 };
export function heroUpgradeCost(hero: Hero): number { return hero.tier === 'Mítico' ? Infinity : 16 + hero.level * 12; }
export function qualityUpgradeCost(hero: Hero): number {
  if (hero.tier === 'Mítico' || QUALITY.indexOf(hero.tier) >= QUALITY.indexOf(hero.maxTier)) return Infinity;
  return [60, 110, 170][QUALITY.indexOf(hero.tier)] ?? Infinity;
}
export function upgradePreview(hero: Hero, kind: 'level' | 'quality'): Stats {
  return { ...(kind === 'level' ? LEVEL_BONUS : QUALITY_BONUS) };
}
function boost(hero: Hero, gain: Stats): void {
  for (const k of ['health', 'attack', 'defense', 'speed'] as const) hero.stats[k] += gain[k];
}
function upgradeHeroDirect(team: Team, hero: Hero): void {
  const price = heroUpgradeCost(hero);
  team.gold -= price; hero.level++; boost(hero, LEVEL_BONUS);
}
export function upgradeHero(state: GameState, side: Side, id: string): string {
  if (!canModify(state, side)) return 'La jornada ya está cerrada.';
  const team = teamFor(state, side), hero = team.heroes.find(h => h.id === id);
  if (!hero) return 'Personaje no encontrado.';
  if (hero.tier === 'Mítico') return 'Los Míticos no pueden recibir mejoras.';
  if (hero.level >= hero.maxLevel) return 'Ha alcanzado su tier máximo.';
  if (team.gold < heroUpgradeCost(hero)) return 'Oro insuficiente.';
  upgradeHeroDirect(team, hero); syncHero(state, hero);
  return `${hero.name}: nivel ${hero.level + 1}/${hero.maxLevel + 1}.`;
}
export function upgradeQuality(state: GameState, side: Side, id: string): string {
  if (!canModify(state, side)) return 'La jornada ya está cerrada.';
  const team = teamFor(state, side), hero = team.heroes.find(h => h.id === id);
  if (!hero) return 'Personaje no encontrado.';
  const cost = qualityUpgradeCost(hero);
  if (!Number.isFinite(cost)) return 'Este campeón no puede subir más de calidad.';
  if (team.gold < cost) return 'Oro insuficiente para ascender su calidad.';
  team.gold -= cost;
  hero.tier = QUALITY[QUALITY.indexOf(hero.tier) + 1];
  boost(hero, QUALITY_BONUS); syncHero(state, hero);
  return `${hero.name} asciende a calidad ${hero.tier}.`;
}
/** La subasta es el único origen de los míticos. No aparecen en mazos ni en tiendas. */
function openMythicAuction(state: GameState, rng: Random): void {
  if (state.mythicSeenSeason) return;
  const mythic = rng.pick(MYTHICS);
  state.mythicalAuction = { id: `M${state.season}`, heroId: mythic.id, minimum: mythic.price, bids: { a: 0, b: 0 }, status: 'open', winner: null };
  state.mythicSeenSeason = true;
}
/** Herramienta de laboratorio: abre una subasta mítica de prueba sin afectar a otras ligas. */
export function forceMythicAuction(state: GameState): string {
  if (state.result || state.currentBouts.length > 0) return 'Solo puedes invocar una subasta antes de la primera batalla.';
  if (state.mythicalAuction) return 'Ya existe una subasta mítica en esta temporada.';
  const rng = new Random(state.rngState);
  state.mythicSeenSeason = false;
  openMythicAuction(state, rng);
  state.rngState = rng.getState();
  return 'Subasta mítica experimental abierta en esta partida local.';
}
export function placeMythicBid(state: GameState, side: Side, amount: number): string {
  const a = state.mythicalAuction, team = teamFor(state, side);
  if (!a || a.status !== 'open' || state.result || state.currentBouts.length > 0) return 'No hay subasta mítica abierta.';
  if (!canModify(state, side)) return 'No tienes permisos para pujar por este equipo.';
  if (team.heroes.length >= MAX_OWNED_HEROES) return 'Tu almacén está completo.';
  if (!Number.isSafeInteger(amount) || amount < a.minimum) return `La puja mínima es ${a.minimum} oro.`;
  const otherBid = a.bids[other(side)];
  if (amount <= otherBid || amount <= a.bids[side]) return `Tu oferta debe superar todas las pujas vigentes.`;
  if (team.gold < amount) return 'Oro insuficiente para realizar esta puja.';
  a.bids[side] = amount;
  return `${team.name} puja ${amount} oro por ${state.seasonHeroes[a.heroId].name}.`;
}
export function resolveMythicAuction(state: GameState): string {
  const a = state.mythicalAuction;
  if (!a || a.status !== 'open') return 'No hay subasta mítica pendiente.';
  if (state.currentBouts.length > 0) return 'Las subastas se resuelven antes de la primera batalla.';
  const side: Side | null = a.bids.a === 0 && a.bids.b === 0 ? null : a.bids.a > a.bids.b ? 'a' : 'b';
  if (!side) { a.status = 'cancelled'; return 'Subasta cerrada sin ofertas.'; }
  const team = teamFor(state, side), price = a.bids[side];
  if (team.gold < price || team.heroes.length >= MAX_OWNED_HEROES) { a.status = 'cancelled'; return 'Subasta cancelada: el ganador no puede pagar o no tiene espacio.'; }
  team.gold -= price;
  const hero = cloneHero(state.seasonHeroes[a.heroId]); hero.purchasePrice = price;
  team.heroes.push(hero); if (team.activeIds.length < MAX_HEROES) team.activeIds.push(hero.id); syncHero(state, hero);
  state.seasonUnavailableIds.push(hero.id);
  a.status = 'awarded'; a.winner = side;
  return `${team.name} gana la subasta de ${hero.name} por ${price} oro.`;
}
export function chooseBlessing(state: GameState, side: Side, key: BlessingKey): string {
  if (!canModify(state, side)) return 'No puedes cambiar la bendición.';
  if (state.history.length > 0 && teamFor(state, side).blessing !== null) return 'La bendición queda fijada después del primer combate de la temporada (salvo reinicio de emergencia).';
  if (!state.blessingChoices.includes(key)) return 'Bendición no disponible en esta temporada.';
  teamFor(state, side).blessing = key;
  return 'Bendición preparada para el combate.';
}
/** Renueva seis ofertas solo del mazo asignado a este participante y cobra el coste acumulativo. */
export function refreshMarket(state: GameState, side: Side = 'a'): string {
  if (!canModify(state, side)) return 'El mercado está cerrado.';
  const team = teamFor(state, side);
  const cost = marketRefreshCost(state, side);
  if (team.gold < cost) return 'No tienes oro suficiente para renovar el mercado.';
  const previous = state.markets[side];
  const rng = new Random(state.rngState);
  const desired = personalMarketSlots(side);
  const oldSeen = [...state.seenMarketIds[side]];
  // Sin mezclar mazos. Evitamos incluso repetir cartas del escaparate actual
  // mientras existan alternativas sin comprar en el mazo del usuario.
  const fresh = newOfferCards(state, side, rng, desired);
  const remaining = Math.max(0, desired - fresh.length);
  const fallback = rng.take(previous.filter(h => !fresh.some(n => n.id === h.id)), remaining);
  const next = [...fresh, ...fallback];
  if (!next.length || (next.length === previous.length && next.every(h => previous.some(p => p.id === h.id)))) {
    state.seenMarketIds[side] = oldSeen;
    return 'No quedan cartas diferentes en tu mazo para renovar. No se ha cobrado oro.';
  }
  team.gold -= cost;
  team.marketRolls++;
  state.markets[side] = next.map(h => cloneHero(state.seasonHeroes[h.id]));
  state.rngState = rng.getState();
  return `Tienda renovada por ${cost} de oro. La siguiente renovación cuesta ${marketRefreshCost(state, side)}.`;
}

interface Fighter {
  id: string; name: string; className: HeroClass; side: Side; stats: Stats;
  line: BattleLine; tactic: TacticalOrder;
  hp: number; maxHp: number; shield: number; turns: number;
  damage: number; damageTaken: number; healed: number; kills: number; saves: number; shieldBy: string | null; mythicGuardUsed: boolean;
}
/** Construye combatientes temporales con sus modificadores de bendición, posición y táctica; no altera Hero.stats. */
function makeFighters(team: Team, side: Side): Fighter[] {
  // activeIds es la formación real: su orden define dos delanteros y tres traseros.
  return team.activeIds.map(id => team.heroes.find(h => h.id === id)).filter((h): h is Hero => !!h).map((h, slot) => {
    const s = { ...h.stats };
    for (const blessing of [team.blessing, team.dailyBlessing]) switch (blessing) {
      case 'iron': s.defense = Math.round(s.defense * 1.12); break;
      case 'life': s.health = Math.round(s.health * 1.12); break;
      case 'swift': s.speed = Math.round(s.speed * 1.15); break;
      case 'arcane': if (h.className === 'Mago') s.attack = Math.round(s.attack * 1.18); break;
      case 'hunt': if (['Bestia', 'Asesino'].includes(h.className)) s.attack = Math.round(s.attack * 1.15); break;
      case 'fury': if (['Guerrero', 'Tanque'].includes(h.className)) s.attack = Math.round(s.attack * 1.15); break;
    }
    return { id: h.id, name: h.name, className: h.className, side, stats: s, line: slot < 2 ? 'front' : 'back', tactic: team.tactics?.[h.id] ?? 'balanced', hp: s.health, maxHp: s.health, shield: 0, turns: 0, damage: 0, damageTaken: 0, healed: 0, kills: 0, saves: 0, shieldBy: null, mythicGuardUsed: false };
  });
}
function alive(units: Fighter[]): Fighter[] { return units.filter(u => u.hp > 0); }
/**
 * Orden de objetivos: normalmente se ataca a la primera línea (75 %).
 * Los Asesinos ignoran esa protección y buscan al rival con menos % de PV.
 * Agresivo intenta rematar; Defensivo prioriza reducir peligros del rival.
 */
function battleTarget(attacker: Fighter, enemies: Fighter[], rng: Random): Fighter {
  const living = alive(enemies);
  if (attacker.className === 'Asesino')
    return [...living].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  const front = living.filter(h => h.line === 'front');
  const candidates = front.length && rng.next() < .75 ? front : living;
  if (attacker.tactic === 'defensive') return [...candidates].sort((a, b) => b.stats.attack - a.stats.attack)[0];
  if (attacker.tactic === 'aggressive') return [...candidates].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (attacker.className === 'Mago') {
    const weaknesses = candidates.filter(h => classAdvantage(attacker.className, h.className) === 1);
    if (weaknesses.length) return rng.pick(weaknesses);
  }
  return rng.pick(candidates);
}
/** Calcula un golpe y sus protecciones: ventajas de clase, crítico, front/back y órdenes individuales. */
function strike(attacker: Fighter, defender: Fighter, allies: Fighter[], rng: Random, log: string[], strength = 1): void {
  let target = defender;
  const guard = alive(allies).filter(f => f.className === 'Tanque' && f.id !== defender.id);
  const guardRoll = rng.next();
  const defenderPotential = Math.max(4, Math.round((attacker.stats.attack * (.58 + .12) - defender.stats.defense * .22) * strength));
  const mythicalGuardian = guard.find(g => g.id === 'myth-tank' && !g.mythicGuardUsed && defenderPotential >= defender.hp + defender.shield);
  if (guard.length && (mythicalGuardian || guardRoll < .22)) {
    target = mythicalGuardian ?? rng.pick(guard);
    if (mythicalGuardian) mythicalGuardian.mythicGuardUsed = true;
    if (defenderPotential >= defender.hp + defender.shield) { target.saves++; log.push(`★ ¡${target.name} salva a ${defender.name} de un golpe mortal!`); }
    else log.push(`🛡 ${target.name} intercepta un ataque dirigido a ${defender.name}.`);
  }
  const adv = classAdvantage(attacker.className, target.className);
  let multiplier = adv === 1 ? 1.16 : adv === -1 ? .88 : 1;
  if (attacker.className === 'Guerrero' && rng.next() < .23) { multiplier *= 1.35; log.push(`⚔ ${attacker.name} prepara un golpe contundente.`); }
  if (attacker.className === 'Asesino' && rng.next() < .26) { multiplier *= 1.65; log.push(`◈ ¡Golpe crítico de ${attacker.name}!`); }
  if (attacker.id === 'myth-assassin' && target.hp / target.maxHp < .35) { multiplier *= 1.6; log.push(`★ ${attacker.name} desata Sentencia de Sombra.`); }
  if (attacker.id === 'myth-war' && attacker.hp / attacker.maxHp < .4) { multiplier *= 1.45; log.push(`★ ${attacker.name} activa su Último Bastión.`); }
  // La retaguardia recibe cobertura mientras haya un delantero aliado vivo.
  // La orden ofensiva aumenta tanto el daño infligido como el recibido;
  // la defensiva reduce ambos. No modifica las estadísticas permanentes.
  const stanceAttack = attacker.tactic === 'aggressive' ? 1.12 : attacker.tactic === 'defensive' ? .85 : 1;
  const stanceDefense = target.tactic === 'aggressive' ? 1.12 : target.tactic === 'defensive' ? .85 : 1;
  const covered = target.line === 'back' && alive(allies).some(h => h.line === 'front') && attacker.className !== 'Asesino';
  const lineDefense = covered ? .88 : 1;
  const raw = (attacker.stats.attack * (.58 + rng.next() * .25) - target.stats.defense * .22) * multiplier * strength * stanceAttack * stanceDefense * lineDefense;
  const hit = Math.max(4, Math.round(raw));
  if (target === defender && hit >= target.hp + target.shield && target.shield > 0 && target.shieldBy) {
    const guardian = allies.find(h => h.id === target.shieldBy);
    if (guardian) { guardian.saves++; log.push(`★ ¡El escudo de ${guardian.name} evita la muerte de ${target.name}!`); }
  }
  const blocked = Math.min(target.shield, hit); target.shield -= blocked;
  const damage = Math.min(target.hp, hit - blocked);
  target.hp = Math.max(0, target.hp - damage);
  attacker.damage += damage; target.damageTaken += damage;
  if (attacker.id === 'myth-beast' && damage > 0) { const heal = Math.min(attacker.maxHp - attacker.hp, Math.round(damage * .3)); attacker.hp += heal; attacker.healed += heal; }
  const icon = adv === 1 ? '↑' : adv === -1 ? '↓' : '·';
  log.push(`${icon} ${attacker.name} → ${target.name}: ${damage} de daño${blocked ? ` (${blocked} bloqueado)` : ''}.${target.hp === 0 ? ' ☠ DERROTADO' : ''}`);
  if (target.hp === 0) attacker.kills++;
}
/** IA elemental de una acción: proteger, curar o elegir objetivo de ataque según clase y orden. */
function takeAction(actor: Fighter, friends: Fighter[], enemies: Fighter[], rng: Random, log: string[]): void {
  if (!alive(enemies).length) return;
  actor.turns++;
  const wounded = alive(friends).filter(h => h.hp <= h.maxHp * .78);
  if (actor.id === 'myth-support' && wounded.length) {
    let healed = 0; for (const friend of wounded) { const n = Math.min(friend.maxHp - friend.hp, Math.round(8 + actor.stats.attack * .38)); friend.hp += n; healed += n; }
    actor.healed += healed; log.push(`★ ${actor.name} invoca Santuario y cura ${healed} PV al equipo.`); return;
  }
  if (actor.className === 'Apoyo' && wounded.length && (actor.tactic === 'defensive' || (actor.tactic !== 'aggressive' && actor.turns % 3 !== 0))) {
    const target = [...wounded].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    const amount = Math.min(target.maxHp - target.hp, Math.round(11 + actor.stats.attack * .56));
    target.hp += amount; actor.healed += amount;
    log.push(`✚ ${actor.name} cura ${amount} PV a ${target.name}.`);
    return;
  }
  if (actor.className === 'Tanque' && (actor.tactic === 'defensive' ? actor.turns % 2 === 1 : actor.tactic === 'aggressive' ? actor.turns % 4 === 1 : actor.turns % 3 === 1)) {
    const target = [...alive(friends)].sort((a, b) => a.shield - b.shield)[0];
    const shield = Math.round(12 + actor.stats.defense * .6);
    target.shield += shield; target.shieldBy = actor.id;
    log.push(`⬡ ${actor.name} protege a ${target.name} con ${shield} puntos de escudo.`);
    return;
  }
  const primary = battleTarget(actor, enemies, rng);
  if (actor.className === 'Mago' && actor.turns % 3 === 0) {
    const others = alive(enemies).filter(h => h.id !== primary.id);
    log.push(`✦ ${actor.name} desencadena una explosión arcana.`);
    strike(actor, primary, enemies, rng, log, .85);
    if (actor.id === 'myth-mage') { for (const target of others) if (target.hp > 0) strike(actor, target, enemies, rng, log, .6); }
    else if (others.length) strike(actor, rng.pick(others), enemies, rng, log, .7);
    return;
  }
  strike(actor, primary, enemies, rng, log);
  if (actor.className === 'Bestia' && alive(enemies).length && (actor.id === 'myth-beast' || rng.next() < .28)) {
    log.push(`◆ ¡${actor.name} ataca una segunda vez!`);
    strike(actor, battleTarget(actor, enemies, rng), enemies, rng, log, .55);
  }
}
/** Cada batalla SOLO registra actuaciones. Las stats NO cambian hasta acabar las cinco. */
function recordBout(team: Team, side: Side, fighters: Fighter[]): HeroChange[] {
  return team.heroes.filter(hero => team.activeIds.includes(hero.id)).map(hero => {
    const f = fighters.find(f => f.id === hero.id)!;
    return {      
id: hero.id, name: hero.name, side, className: hero.className, tier: hero.tier,
      before: { ...hero.stats }, after: { ...hero.stats }, health: 0, attack: 0, defense: 0, speed: 0,
      damage: f.damage, damageTaken: f.damageTaken, healed: f.healed, kills: f.kills,
      deaths: f.hp === 0 ? 1 : 0, saves: f.saves, remainingHp: f.hp    
};
  });
}
/** Suma actuaciones de las cinco batallas, aplica límites de progresión y detecta eliminación. */
function applyDayProgress(state: GameState, team: Team, side: Side, bouts: Bout[]): HeroChange[] {
  const participants = [...new Set(bouts.flatMap(b => b.changes.filter(c => c.side === side).map(c => c.id)))];
  return participants.map(id => {
    const hero = team.heroes.find(h => h.id === id)!;
    const metrics = bouts.flatMap(b => b.changes).filter(c => c.id === id && c.side === side);
    const sum = (field: 'kills' | 'deaths' | 'damage' | 'damageTaken' | 'healed' | 'saves') => metrics.reduce((acc, c) => acc + c[field], 0);
    const kills = sum('kills'), deaths = sum('deaths'), damage = sum('damage'), taken = sum('damageTaken'), healed = sum('healed'), saves = sum('saves');
    const before = { ...hero.stats };
    if (hero.tier !== 'Mítico') {
      const proposed: Stats = {
        health: Math.floor(healed / 70) + saves * 2 - deaths * 2,
        attack: Math.floor(kills / 2) + Math.floor(damage / 300) - deaths,
        defense: Math.floor(taken / 130) + saves - deaths,
        speed: Math.floor(kills / 4) - Math.floor(deaths / 2)
      };
      for (const k of ['health', 'attack', 'defense', 'speed'] as const) {
        const caps = hero.caps[k]; const delta = Math.max(caps.min, Math.min(caps.max, proposed[k]));
        hero.stats[k] = Math.max(1, hero.stats[k] + delta);
      }
    }
    const eliminated = deaths >= DEATH_LIMIT;
    return {      
id: hero.id, name: hero.name, side, className: hero.className, tier: hero.tier,
      before, after: { ...hero.stats }, health: hero.stats.health - before.health,
      attack: hero.stats.attack - before.attack, defense: hero.stats.defense - before.defense,
      speed: hero.stats.speed - before.speed, damage, damageTaken: taken, healed, kills, deaths, saves,
      participations: metrics.length, eliminated, remainingHp: metrics.at(-1)?.remainingHp ?? 0    
};
  });
}
/** Los campeones eliminados vuelven al sorteo normal de su mazo, sin conservar mejoras; el Mítico no. */
function replaceFallen(state: GameState, side: Side, changes: HeroChange[], rng: Random): void {
  const team = teamFor(state, side);
  /** Solo se procesan las bajas DEL EQUIPO que estamos revisando.
   * Si filtramos únicamente por `eliminated`, las muertes rivales se cuentan también
   * como propias y la siguiente jornada concede reemplazos que no corresponden.
   */
  const lost = changes.filter(c => c.side === side && c.eliminated);
  state.eliminatedThisDay[side] = lost.map(c => c.id);
  for (const change of lost) {
    team.heroes = team.heroes.filter(h => h.id !== change.id);
    team.activeIds = team.activeIds.filter(id => id !== change.id);
    // Devuelve el campeón normal al draft de esta temporada. El mítico no puede salir en draft.
    if (change.tier !== 'Mítico') {
      // Solo vuelve al mazo de draft de su jugador; JAMÁS al mercado privado.
      if (!state.fallenDraftIds[side].includes(change.id)) state.fallenDraftIds[side].push(change.id);
      const template = CATALOG.find(h => h.id === change.id)!;
      state.seasonHeroes[change.id] = initialSeasonStats(template, rng, state.statMode);
      state.seasonBaseStats[change.id] = { ...state.seasonHeroes[change.id].stats };
    }
    for (const offer of state.tradeOffers) if (offer.status === 'pending' && offer.heroId === change.id) offer.status = 'expired';
  }
  // El draft de reemplazo se ejecuta al comenzar la SIGUIENTE jornada.
}
/** Resuelve UNA batalla completa, restaurando la vida al empezar la siguiente. */
/**
 * Convierte el estado VOLÁTIL del combate en datos reproducibles para la UI.
 * Se captura al comienzo y al acabar cada turno: no modifica la simulación ni
 * altera el generador de números aleatorios. La reproducción en Angular puede
 * detenerse o acelerarse sin modificar el resultado de la jornada.
 */
function fighterFrames(left: Fighter[], right: Fighter[]): FighterFrame[] {
  return [...left, ...right].map(f => ({
    id: f.id, name: f.name, side: f.side,
    hp: f.hp, maxHp: f.maxHp, shield: f.shield
  }));
}

/** Resuelve UNA batalla completa; genera además la secuencia visual de turnos. */
function simulateBout(teamA: Team, teamB: Team, number: number, rng: Random): Bout {
  const left = makeFighters(teamA, 'a');
  const right = makeFighters(teamB, 'b');
  const initialFighters = fighterFrames(left, right);
  const timeline: BattleTurn[] = [];
  const log: string[] = [`⚑ Formación: A (${left.filter(h => h.line === 'front').map(h => h.name).join(' y ')}) frente a B (${right.filter(h => h.line === 'front').map(h => h.name).join(' y ')}).`];
  let turns = 0;
  for (let round = 0; round < 25; round++) {
    if (!alive(left).length || !alive(right).length) break;
    const logStart = log.length;
    turns++;
    const order = [...alive(left), ...alive(right)].map(h => ({ h, initiative: h.stats.speed + rng.next() * 13 }))
      .sort((a, b) => b.initiative - a.initiative).map(i => i.h);
    for (const fighter of order) {
      if (fighter.hp <= 0 || !alive(left).length || !alive(right).length) continue;
      const friends = fighter.side === 'a' ? left : right;
      const enemies = fighter.side === 'a' ? right : left;
      takeAction(fighter, friends, enemies, rng, log);
    }
    // Todos los efectos del turno se muestran juntos. Las barras representan
    // la vida REAL al terminar este turno, no cifras reconstruidas desde el log.
    timeline.push({ number: turns, events: log.slice(logStart), fighters: fighterFrames(left, right) });
  }
  const remainingA = left.reduce((sum, h) => sum + h.hp / h.maxHp, 0);
  const remainingB = right.reduce((sum, h) => sum + h.hp / h.maxHp, 0);
  const winner: Side = remainingA === remainingB ? (rng.next() < .5 ? 'a' : 'b') : (remainingA > remainingB ? 'a' : 'b');
  log.push(`🏁 Ronda ${number}: gana ${winner === 'a' ? 'Equipo A' : 'Equipo B'} (vida media restante ${Math.round(remainingA / left.length * 100)} % vs ${Math.round(remainingB / right.length * 100)} %).`);
  const changes = [...recordBout(teamA, 'a', left), ...recordBout(teamB, 'b', right)];
  return { number, winner, turns, log, remainingA: Math.round(remainingA / left.length * 100), remainingB: Math.round(remainingB / right.length * 100), changes, timeline, initialFighters };
}
/** Avanza un paso: devuelve una nueva batalla y solo cierra la jornada al llegar a cinco. */
export function playNextBout(state: GameState): Bout {
  if (state.result) throw new Error('La jornada ya está cerrada.');
  if (state.currentBouts.length >= 5) throw new Error('Ya se han celebrado las cinco batallas.');
  if (state.teamA.activeIds.length < 3 || state.teamB.activeIds.length < 3) throw new Error('Se necesitan al menos tres titulares por equipo.');
  if (!state.teamA.blessing || !state.teamB.blessing) throw new Error('Falta seleccionar una bendición de temporada para cada equipo.');
  if (!state.teamA.dailyBlessing || !state.teamB.dailyBlessing) throw new Error('Falta seleccionar una bendición de jornada para cada equipo.');
  if (state.currentBouts.length === 0) {
    if (state.mythicalAuction?.status === 'open') resolveMythicAuction(state);
    expirePendingTrades(state);
  }
  const rng = new Random(state.rngState);
  const bout = simulateBout(state.teamA, state.teamB, state.currentBouts.length + 1, rng);
  state.currentBouts.push(bout);
  if (state.currentBouts.length === 5) finalizeMatch(state, rng);
  state.rngState = rng.getState();
  return bout;
}
/** Reinicio individual de emergencia: el único disparador es haber perdido el ÚLTIMO campeón
 * por muertes definitivas, no por compraventas, ventas o abandonar la partida.
 * No modifica la clasificación, el calendario ni los mazos de otros participantes.
 */
function emergencyResetIfWiped(state: GameState, side: Side, rng: Random): boolean {
  const team = teamFor(state, side);
  if (team.heroes.length !== 0 || state.eliminatedThisDay[side].length === 0) return false;
  const blocked = unavailable(state);
  // Solo campeones comunes del mazo privado o caídos previamente del propio equipo.
  // Nunca se extraen campeones del otro jugador ni Míticos de subasta.
  const candidates = NORMAL_CHAMPIONS.filter(h => h.minTier === 'Común' &&
    state.playerDecks[side].includes(h.id) &&
    (!blocked.has(h.id) || state.fallenDraftIds[side].includes(h.id)));
  if (candidates.length < 3) throw new Error('No hay tres campeones comunes disponibles para el reinicio de emergencia.');
  const starters = rng.take(candidates, 3);
  team.tactics = {};
  team.heroes = starters.map(template => {
    const reset = initialSeasonStats(template, rng, state.statMode);
    state.seasonHeroes[template.id] = cloneHero(reset);
    state.seasonBaseStats[template.id] = { ...reset.stats };
    return cloneHero(reset);
  });
  team.activeIds = team.heroes.map(h => h.id);
  team.gold = START_GOLD;
  team.blessing = null; // Nueva elección de bendición permanente para la nueva plantilla.
  team.dailyBlessing = null;
  team.marketRolls = 0;
  for (const starter of starters) {
    if (!state.seasonUnavailableIds.includes(starter.id)) state.seasonUnavailableIds.push(starter.id);
    state.fallenDraftIds[side] = state.fallenDraftIds[side].filter(id => id !== starter.id);
  }
  // La tienda se reconstruye desde el MISMO mazo privado. No redistribuimos cartas
  // porque hacerlo podría dar héroes que ya pertenecen al contrario.
  state.markets[side] = [];
  state.seenMarketIds[side] = [];
  fillShop(state, side, rng);
  state.eliminatedThisDay[side] = []; // Evita duplicar drafts al pasar de jornada.
  state.emergencyResets[side]++;
  return true;
}
/** Cierre único de jornada: estadísticas, puntos, oro, eliminación y posible reinicio de emergencia. */
function finalizeMatch(state: GameState, rng: Random): MatchResult {
  const bouts = state.currentBouts;
  const scoreA = bouts.filter(b => b.winner === 'a').length, scoreB = 5 - scoreA;
  const winner: Side = scoreA > scoreB ? 'a' : 'b';
  const changes = [...applyDayProgress(state, state.teamA, 'a', bouts), ...applyDayProgress(state, state.teamB, 'b', bouts)];
  const prize = (side: Side) => (winner === side ? WIN_GOLD : LOSS_GOLD) + changes.filter(c => c.side === side).reduce((sum, c) => sum + c.kills * KILL_GOLD + c.saves * SAVE_GOLD, 0);
  const goldA = prize('a'), goldB = prize('b');
  state.teamA.gold += goldA; state.teamB.gold += goldB;
  const summary = winner === 'a' ? '¡Victoria! Has ganado el enfrentamiento.' : 'Derrota: el rival gana esta jornada.';
  const result: MatchResult = { day: state.day, winner, scoreA, scoreB, bouts: [...bouts], summary, changes, goldA, goldB };
  state.result = result; state.history.push(result);
  if (state.day >= state.durationDays) state.seasonComplete = true;
  if (winner === 'a') { state.scoreA += 3; state.winsA++; } else { state.scoreB += 3; state.winsB++; }
  for (const hero of [...state.teamA.heroes, ...state.teamB.heroes]) syncHero(state, hero);
  replaceFallen(state, 'a', changes, rng); replaceFallen(state, 'b', changes, rng);
  const resetSides: (Side)[] = [];
  for (const side of ['a', 'b'] as const) if (emergencyResetIfWiped(state, side, rng)) resetSides.push(side);
  if (resetSides.length) {
    result.emergencyResetSides = resetSides;
    result.summary += ' Reinicio de emergencia: ' + resetSides.map(side => side === 'a' ? 'Equipo A' : 'Equipo B').join(' y ') + '. ¡Puntos y victorias conservados!';
  }
  return result;
}
/** Compatibilidad para pruebas automáticas: disputa las cinco batallas sin rotar. */
export function simulateMatch(state: GameState): MatchResult {
  while (!state.result) playNextBout(state);
  return state.result;
}
/** Guarda palmarés y crea la temporada siguiente tras confirmación explícita. */
function archiveAndRestartSeason(state: GameState, now: number): string {
  const changes = state.history.flatMap(h => h.changes);
  const leaderboard = new Map<string, { name: string; score: number }>();
  for (const c of changes) {
    const prev = leaderboard.get(c.id) ?? { name: c.name, score: 0 };
    prev.score += c.kills * 3 + c.saves * 4 + c.damage / 100;
    leaderboard.set(c.id, prev);
  }
  const top = [...leaderboard.values()].sort((a, b) => b.score - a.score)[0];
  state.records.push({    
season: state.season, mode: state.mode, daysPlayed: state.history.length, durationDays: state.durationDays,
    scoreA: state.scoreA, scoreB: state.scoreB, winsA: state.winsA, winsB: state.winsB,
    champion: state.scoreA === state.scoreB ? null : state.scoreA > state.scoreB ? 'a' : 'b', notableHero: top?.name,
    totalKillsA: changes.filter(c => c.side === 'a').reduce((sum, c) => sum + c.kills, 0),
    totalKillsB: changes.filter(c => c.side === 'b').reduce((sum, c) => sum + c.kills, 0)  
});
  state.seasonComplete = false;
  state.season++;
  state.day = 1;
  state.seasonStartedAt = now;
  state.seasonEndsAt = now + state.durationDays * DAY_MS;
  state.scoreA = state.scoreB = state.winsA = state.winsB = 0;
  state.history = [];
  draftSeason(state, new Random(state.rngState));
  return `Comienza la temporada ${state.season}: nueva plantilla, nuevas bendiciones y nuevas estadísticas iniciales.`;
}
/**
 * ÚNICA vía para comenzar otra temporada. En local se llama desde el botón
 * explícito de la pantalla de cierre; el motor nunca reinicia automáticamente.
 */
export function beginNextSeason(state: GameState, now = Date.now()): string {
  if (!state.seasonComplete || !state.result || state.currentBouts.length !== 5)
    return 'La temporada todavía no ha terminado.';
  return archiveAndRestartSeason(state, now);
}
/** Por cada campeón perdido se sortea uno nuevo de bajo rango o de los caídos.
 * El eliminado no regresa automáticamente: solo si vuelve a salir en el draft.
 */
function draftReplacements(state: GameState, side: Side, rng: Random): void {
  const team = teamFor(state, side);
  const count = state.eliminatedThisDay[side].length;
  for (let i = 0; i < count && team.heroes.length < MAX_OWNED_HEROES; i++) {
    const commons = NORMAL_CHAMPIONS.filter(h => state.playerDecks[side].includes(h.id) && h.minTier === 'Común' && !unavailable(state).has(h.id));
    const returnees = NORMAL_CHAMPIONS.filter(h => state.fallenDraftIds[side].includes(h.id) && !team.heroes.some(x => x.id === h.id));
    const pool = [...commons, ...returnees];
    if (!pool.length) break;
    const candidate = rng.pick(pool);
    const starter = cloneHero(state.seasonHeroes[candidate.id]);
    team.heroes.push(starter);
    if (team.activeIds.length < MAX_HEROES) team.activeIds.push(starter.id);
    if (!state.seasonUnavailableIds.includes(starter.id)) state.seasonUnavailableIds.push(starter.id);
    state.fallenDraftIds[side] = state.fallenDraftIds[side].filter(id => id !== starter.id);
    state.markets[side] = state.markets[side].filter(h => h.id !== starter.id);
  }
  state.eliminatedThisDay[side] = [];
}
/** En local, el calendario es por jornadas; el reloj real será exclusivo del PvP online. */
export function expireSeason(_state: GameState, _now = Date.now()): string | null { return null; }
/** Avanza jornada en local; si terminó la temporada, NO inicia otra automáticamente. */
export function nextDay(state: GameState, now = Date.now()): string {
  if (!state.result) return 'Debes completar las cinco batallas antes de avanzar.';
  if (state.day >= state.durationDays) return 'Temporada finalizada. Consulta el podio y pulsa Comenzar nueva temporada.';
  const rng = new Random(state.rngState);
  expirePendingTrades(state);
  state.day++; state.result = null; state.currentBouts = [];
  draftReplacements(state, 'a', rng); draftReplacements(state, 'b', rng);
  for (const side of ['a', 'b'] as const) {
    const team = teamFor(state, side);
    team.marketRolls = 0;
    // Los suplentes pueden tomar el sitio de los caídos entre jornadas.
    team.activeIds = team.activeIds.filter(id => team.heroes.some(h => h.id === id));
    for (const h of team.heroes) if (team.activeIds.length < 3 && !team.activeIds.includes(h.id)) team.activeIds.push(h.id);
  }
  setupDailyBlessings(state, rng);
  if (!state.mythicSeenSeason && rng.next() < 0.04) openMythicAuction(state, rng);
  if (state.mode === 'bot') botSetup(state, rng);
  fillMarkets(state, rng);
  state.rngState = rng.getState();
  return `Jornada ${state.day} de ${state.durationDays}. Renuevas bendición temporal y mercado; los campeones conservan la progresión.`;
}
/** Simula N enfrentamientos de prueba sin tocar el estado real, para equilibrar clases. */
export function batchTest(state: GameState, simulations = 100): { a: number; b: number; percentageA: number } {
  if (state.teamA.activeIds.length < 3 || state.teamB.activeIds.length < 3 || !state.teamA.blessing || !state.teamB.blessing || !state.teamA.dailyBlessing || !state.teamB.dailyBlessing) throw new Error('Ambos equipos necesitan sus bendiciones.');
  let a = 0, b = 0;
  const rng = new Random(state.rngState);
  for (let i = 0; i < simulations; i++) {
    const cloneA: Team = { ...state.teamA, heroes: state.teamA.heroes.map(h => ({ ...h, stats: { ...h.stats } })) };
    const cloneB: Team = { ...state.teamB, heroes: state.teamB.heroes.map(h => ({ ...h, stats: { ...h.stats } })) };
    let winsA = 0;
    for (let n = 1; n <= 5; n++)if (simulateBout(cloneA, cloneB, n, rng).winner === 'a') winsA++;
    if (winsA >= 3) a++; else b++;
  }
  return { a, b, percentageA: Math.round((a / simulations) * 100) };
}
/** Valida estructura y exclusividad de mazos antes de aceptar un guardado. */
export function isValidState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<GameState>;
  if (v.version !== 9 || typeof v.seasonComplete !== 'boolean' || !Array.isArray(v.tradeOffers) || !Number.isSafeInteger(v.nextTradeId) || typeof v.seed !== 'string' || typeof v.rngState !== 'number' ||
    typeof v.day !== 'number' || !SEASON_LENGTHS.includes(v.durationDays as SeasonDuration) ||
    (v.statMode !== 'fixed' && v.statMode !== 'random') ||
    !v.markets || !Array.isArray(v.markets.a) || !Array.isArray(v.markets.b) ||
    !v.playerDecks || !Array.isArray(v.playerDecks.a) || !Array.isArray(v.playerDecks.b) ||
    !v.seenMarketIds || !Array.isArray(v.seenMarketIds.a) || !Array.isArray(v.seenMarketIds.b) ||
    !Array.isArray(v.seasonUnavailableIds) || !v.seasonBaseStats || !v.seasonHeroes || !v.emergencyResets ||
    !Number.isSafeInteger(v.emergencyResets.a) || !Number.isSafeInteger(v.emergencyResets.b) ||
    typeof v.seasonStartedAt !== 'number' || typeof v.seasonEndsAt !== 'number' ||
    !v.teamA || !v.teamB || typeof v.teamA.marketRolls !== 'number' ||
    typeof v.teamB.marketRolls !== 'number' || !('mythicalAuction' in v) || typeof v.mythicSeenSeason !== 'boolean' || !Array.isArray(v.teamA.heroes) ||
    !Array.isArray(v.teamB.heroes) || !Array.isArray(v.history) || !Array.isArray(v.teamA.activeIds) || !Array.isArray(v.teamB.activeIds) || !Array.isArray(v.currentBouts) || !v.dailyBlessingChoices || !v.eliminatedThisDay || !v.fallenDraftIds) return false;
  const a = new Set(v.playerDecks.a); const b = new Set(v.playerDecks.b);
  if ([...a].some(id => b.has(id))) return false;
  for (const team of [v.teamA, v.teamB]) {
    if (!team.tactics || typeof team.tactics !== 'object') return false;
    if (team.activeIds.length > MAX_HEROES || team.heroes.length > MAX_OWNED_HEROES) return false;
    if (new Set(team.activeIds).size !== team.activeIds.length) return false;
    if (team.activeIds.some(id => !team.heroes.some(h => h.id === id))) return false;
  }
  return v.markets.a.every(h => a.has(h.id)) && v.markets.b.every(h => b.has(h.id));
}
/** Migration preserving rosters, season stats and visible offers.
 * Old rolled-off offers cannot be reconstructed retrospectively: decks are assigned now.
 */
/** Transforma guardados anteriores manteniendo el progreso. No sobrescribir sin copia de seguridad. */
export function migrateSavedState(value: unknown, now = Date.now()): GameState | null {
  if (isValidState(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, any>;
  if (v.version === 8) {
    // Conserva los cinco combates si la persona cerró el navegador a mitad.
    v.version = 9;
    v.seasonComplete = !!(v.result && v.day >= v.durationDays);
    for (const team of [v.teamA, v.teamB]) if (team) team.tactics ??= {};
    return isValidState(v) ? v : null;
  }
  if (v.version === 7) {
    // Migración sin modificar plantillas, puntos, oro, cinco batallas ni mercado.
    v.emergencyResets = { a: 0, b: 0 };
    v.version = 8;
    return migrateSavedState(v, now);
  }
  if (v.version === 1 && typeof v.seed === 'string' && v.teamA && v.teamB &&
    Array.isArray(v.teamA.heroes) && Array.isArray(v.teamB.heroes) && Array.isArray(v.market)) {
    const oldDays = Number(v.maxDays) || 14;
    const durationDays = SEASON_LENGTHS.reduce((a, b) => Math.abs(a - oldDays) <= Math.abs(b - oldDays) ? a : b);
    const seasonHeroes: Record<string, Hero> = Object.fromEntries(CATALOG.map(h => [h.id, makeHero(h)]));
    for (const hero of [...v.market, ...v.teamA.heroes, ...v.teamB.heroes])
      if (hero && seasonHeroes[hero.id]) seasonHeroes[hero.id] = cloneHero(hero);
    v.version = 2; v.durationDays = durationDays; v.seasonStartedAt = now;
    v.seasonEndsAt = now + durationDays * DAY_MS; v.statMode = 'fixed'; v.seasonHeroes = seasonHeroes;
    v.teamA.marketRolls = 0; v.teamB.marketRolls = 0;
  }
  const rng = new Random(typeof v.rngState === 'number' ? v.rngState : Random.fromSeed(v.seed ?? 'ARENA-01').getState());
  if (v.version === 2) {
    if (!v.teamA || !v.teamB || !Array.isArray(v.teamA.heroes) || !Array.isArray(v.teamB.heroes) ||
      !Array.isArray(v.market) || !v.seasonHeroes) return null;
    const sourceOffers = v.market.filter((h: Hero) => !!v.seasonHeroes[h?.id]);
    v.markets = { a: sourceOffers.slice(0, personalMarketSlots('a')).map(cloneHero), b: [] };
    v.seasonUnavailableIds = [...new Set([...v.teamA.heroes, ...v.teamB.heroes].map((h: Hero) => h.id))];
    v.seasonBaseStats = Object.fromEntries(CATALOG.map(h => [h.id, { ...h.stats }]));
    v.version = 3;
  }
  if (v.version === 4 && v.teamA && v.teamB && v.playerDecks && v.markets) {
    v.tradeOffers = [];
    v.nextTradeId = 1;
    for (const hero of [...v.teamA.heroes, ...v.teamB.heroes]) {
      if (hero.purchasePrice === undefined) hero.purchasePrice = hero.price;
    }
    v.version = 5;
    // Proseguir a la migración v6.
  }
  if (v.version === 6) {
    for (const team of [v.teamA, v.teamB]) {
      if (!team || !Array.isArray(team.heroes)) return null;
      team.activeIds = team.heroes.slice(0, MAX_HEROES).map((h: Hero) => h.id);
      team.dailyBlessing = null;
    }
    v.currentBouts = []; v.eliminatedThisDay = { a: [], b: [] }; v.fallenDraftIds = { a: [], b: [] };
    const dailyRng = new Random(v.rngState);
    setupDailyBlessings(v as GameState, dailyRng);
    // Mantener el RNG original para no alterar su orden de sorteo histórico.
    v.version = 8;
    v.emergencyResets = { a: 0, b: 0 };
    // La nueva duración se mide en jornadas, no en reloj real.
    const state = v as GameState;
    if (state.result && state.day > state.durationDays) state.day = state.durationDays;
    return migrateSavedState(state, now);
  }
  if (v.version === 5) {
    if (!v.teamA || !v.teamB || !v.playerDecks || !v.markets) return null;
    for (const hero of [...v.teamA.heroes, ...v.teamB.heroes]) {
      const fresh = CATALOG.find(h => h.id === hero.id); if (!fresh) continue;
      hero.minTier = fresh.minTier; hero.maxTier = fresh.maxTier; hero.maxLevel = fresh.maxLevel;
      hero.caps = fresh.caps; hero.ability = fresh.ability;
    }
    v.seasonHeroes = Object.fromEntries(CATALOG.map(template => {
      const existing = v.seasonHeroes?.[template.id];
      return [template.id, existing ? { ...makeHero(template), ...existing, minTier: template.minTier, maxTier: template.maxTier, maxLevel: template.maxLevel, caps: template.caps, ability: template.ability } : makeHero(template)];
    }));
    for (const side of ['a', 'b'] as const) {
      v.markets[side] = (v.markets[side] ?? []).map((old: Hero) => ({
        ...v.seasonHeroes[old.id], stats: { ...old.stats }
      }));
    }
    v.seasonBaseStats = Object.fromEntries(CATALOG.map(template => [template.id, v.seasonBaseStats?.[template.id] ?? { ...template.stats }]));
    v.mythicalAuction = null; v.mythicSeenSeason = false;
    v.version = 6;
    for (const record of v.history ?? []) if (!record.changes) { record.changes = []; record.goldA = 0; record.goldB = 0; }
    if (v.result && !v.result.changes) { v.result.changes = []; v.result.goldA = 0; v.result.goldB = 0; }
    return migrateSavedState(v, now);
  }
  if (v.version !== 3 || !v.teamA || !v.teamB || !v.markets ||
    !Array.isArray(v.markets.a) || !Array.isArray(v.markets.b) || !v.seasonHeroes) return null;
  // Respeta campeones ya obtenidos y ofertas actuales de ambas tiendas.
  const reservedA = [...v.teamA.heroes, ...v.markets.a].map((h: Hero) => h.id);
  const reservedB = [...v.teamB.heroes, ...v.markets.b].map((h: Hero) => h.id);
  const decks = dealDecks(rng, { a: reservedA, b: reservedB.filter((id: string) => !reservedA.includes(id)) });
  const previousHeroes = v.seasonHeroes as Record<string, Hero>;
  v.seasonHeroes = Object.fromEntries(CATALOG.map(h => [h.id, previousHeroes[h.id] ? cloneHero(previousHeroes[h.id]) : initialSeasonStats(h, rng, v.statMode === 'random' ? 'random' : 'fixed')]));
  v.seasonBaseStats = Object.fromEntries(CATALOG.map(h => [h.id, v.seasonBaseStats?.[h.id] ?? { ...v.seasonHeroes[h.id].stats }]));
  v.playerDecks = decks;
  v.seenMarketIds = { a: v.markets.a.map((h: Hero) => h.id), b: v.markets.b.map((h: Hero) => h.id) };
  v.version = 5;
  v.tradeOffers = [];
  v.nextTradeId = 1;
  for (const hero of [...v.teamA.heroes, ...v.teamB.heroes]) {
    if (hero.purchasePrice === undefined) hero.purchasePrice = hero.price;
  }
  const result = v as GameState;
  fillMarkets(result, rng);
  result.rngState = rng.getState();
  return migrateSavedState(result, now);
}
export function classDescription(heroClass: HeroClass): string {
  const wins = CLASSES.filter(c => classAdvantage(heroClass, c) === 1);
  return `Fuerte contra ${wins.length ? wins.join(', ') : 'ninguna clase'}.`;
}
