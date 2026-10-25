export const CLASSES = ['Mago', 'Guerrero', 'Asesino', 'Apoyo', 'Tanque', 'Bestia'] as const;
export type HeroClass = typeof CLASSES[number];
export type Tier = 'Común' | 'Raro' | 'Épico' | 'Legendario' | 'Mítico';
export const QUALITY: readonly Tier[] = ['Común', 'Raro', 'Épico', 'Legendario', 'Mítico'];
export type StatKey = keyof Stats;
export interface StatRange { min: number; max: number; }
export type GrowthCaps = Record<StatKey, StatRange>;
export type Side = 'a' | 'b';
/** Orden que el jugador asigna a cada campeón entre batallas. */
export type TacticalOrder = 'aggressive' | 'balanced' | 'defensive';
/** Delantera: posiciones 0 y 1; retaguardia: 2, 3 y 4. */
export type BattleLine = 'front' | 'back';
export type Mode = 'bot' | 'manual';
export type StatMode = 'fixed' | 'random';
export type SeasonDuration = 3 | 7 | 15 | 30;
export type BlessingKey = 'arcane' | 'iron' | 'hunt' | 'life' | 'swift' | 'fury';
export interface Stats { health: number; attack: number; defense: number; speed: number; }
export interface HeroTemplate { id: string; name: string; className: HeroClass; tier: Tier; minTier: Tier; maxTier: Tier; maxLevel: number; price: number; stats: Stats; caps: GrowthCaps; ability?: string; abilityDescription?: string; }
export interface Hero extends HeroTemplate { level: number; stats: Stats; /** Importe pagado por el propietario actual. En los gratuitos, se usa el precio del catálogo. */ purchasePrice?: number; }
/** Los cinco IDs de activeIds mantienen el ORDEN espacial de la formación. */
export interface Team {
  name: string; gold: number; heroes: Hero[]; activeIds: string[];
  /** Órdenes persistentes por ID, incluso cuando un campeón descansa en el almacén. */
  tactics: Record<string, TacticalOrder>;
  blessing: BlessingKey | null; dailyBlessing: BlessingKey | null; marketRolls: number;
}
export interface HeroChange {
  id: string; name: string; side: Side; className: HeroClass; tier: Tier;
  before: Stats | null; after: Stats | null;
  health: number; attack: number; defense: number; speed: number;
  damage: number; damageTaken: number; healed: number; kills: number; deaths: number; saves: number; remainingHp: number; participations?: number; eliminated?: boolean;
}
/** Estado visual de un campeón en una instantánea de combate. No afecta a sus atributos permanentes. */
export interface FighterFrame {
  id: string; name: string; side: Side; hp: number; maxHp: number; shield: number;
}
/** Eventos de un turno, junto a la vida restante DESPUÉS de sus acciones. */
export interface BattleTurn {
  number: number;
  events: string[];
  fighters: FighterFrame[];
}
/** Los campos timeline/initialFighters son opcionales para poder leer guardados anteriores. */
export interface Bout {
  number: number; winner: Side; turns: number; log: string[];
  remainingA: number; remainingB: number; changes: HeroChange[];
  timeline?: BattleTurn[];
  initialFighters?: FighterFrame[];
}
export interface MatchResult { day: number; winner: Side; scoreA: number; scoreB: number; bouts: Bout[]; summary: string; changes: HeroChange[]; goldA: number; goldB: number; /** Equipos aniquilados y reiniciados tras esta jornada, conservando puntuación */ emergencyResetSides?: Side[]; }
/** Resumen inalterable que se conserva después de reiniciar el progreso estacional. */
export interface SeasonRecord {
  season: number; mode: Mode; daysPlayed: number; durationDays?: number;
  scoreA: number; scoreB: number; winsA: number; winsB: number;
  champion?: Side | null; notableHero?: string; totalKillsA?: number; totalKillsB?: number;
}
export type TradeStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
export interface TradeOffer {
  id: string;
  season: number;
  day: number;
  buyer: Side;
  seller: Side;
  heroId: string;
  heroName: string;
  amount: number;
  minPrice: number;
  status: TradeStatus;
}
export interface MythicAuction { id: string; heroId: string; minimum: number; bids: Record<Side, number>; status: 'open' | 'awarded' | 'cancelled'; winner: Side | null; }
export interface GameState {
  version: 9;
  /** La quinta batalla de la última jornada cierra la temporada sin iniciar otra. */
  seasonComplete: boolean;
  seed: string; rngState: number;
  season: number; day: number; durationDays: SeasonDuration; mode: Mode;
  seasonStartedAt: number; seasonEndsAt: number; statMode: StatMode;
  seasonHeroes: Record<string, Hero>;
  scoreA: number; scoreB: number; winsA: number; winsB: number;
  teamA: Team; teamB: Team;
  markets: Record<Side, Hero[]>;
  /** Mazo exclusivo asignado a cada jugador al empezar la temporada. */
  playerDecks: Record<Side, string[]>;
  /** Ofertas ya mostradas: se priorizan cartas nuevas en cada renovación. */
  seenMarketIds: Record<Side, string[]>;
  seasonUnavailableIds: string[];
  /** Solicitudes de compra entre los participantes de esta temporada. */
  tradeOffers: TradeOffer[];
  nextTradeId: number;
  mythicalAuction: MythicAuction | null;
  mythicSeenSeason: boolean;
  seasonBaseStats: Record<string, Stats>;
  /** Reinicios de emergencia acumulados en la temporada por equipo. */
  emergencyResets: Record<Side, number>;
  blessingChoices: BlessingKey[];
  dailyBlessingChoices: Record<Side, BlessingKey[]>;
  currentBouts: Bout[];
  eliminatedThisDay: Record<Side, string[]>;
  fallenDraftIds: Record<Side, string[]>;
  result: MatchResult | null;
  history: MatchResult[];
  records: SeasonRecord[];
}
export const CLASS_ICONS: Record<HeroClass, string> = { Mago: '✦', Guerrero: '⚔', Asesino: '◈', Apoyo: '✚', Tanque: '⬡', Bestia: '◆' };
export const BLESSINGS: Record<BlessingKey, { name: string; description: string; icon: string }> = {
  arcane: { name: 'Furia arcana', description: 'Magos: +18 % de daño', icon: '✦' },
  iron: { name: 'Piel de hierro', description: 'Todo el equipo: +12 % de defensa', icon: '⬡' },
  hunt: { name: 'Instinto salvaje', description: 'Bestias y Asesinos: +15 % de daño', icon: '◆' },
  life: { name: 'Vitalidad ancestral', description: 'Todo el equipo: +12 % de vida', icon: '✚' },
  swift: { name: 'Viento veloz', description: 'Todo el equipo: +15 % de velocidad', icon: '➶' },
  fury: { name: 'Bendición del filo', description: 'Guerreros y Tanques: +15 % de daño', icon: '⚔' }
};
