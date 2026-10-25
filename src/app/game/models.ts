export const CLASSES = ['Mago', 'Guerrero', 'Asesino', 'Apoyo', 'Tanque', 'Bestia'] as const;
export type HeroClass = typeof CLASSES[number];
export type Tier = 'Común' | 'Raro' | 'Épico' | 'Legendario' | 'Mítico';
export const QUALITY: readonly Tier[] = ['Común','Raro','Épico','Legendario','Mítico'];
export type StatKey = keyof Stats;
export interface StatRange { min:number; max:number; }
export type GrowthCaps = Record<StatKey, StatRange>;
export type Side = 'a' | 'b';
export type Mode = 'bot' | 'manual';
export type StatMode = 'fixed' | 'random';
export type SeasonDuration = 3 | 7 | 15 | 30;
export type BlessingKey = 'arcane' | 'iron' | 'hunt' | 'life' | 'swift' | 'fury';
export interface Stats { health: number; attack: number; defense: number; speed: number; }
export interface HeroTemplate { id:string; name:string; className:HeroClass; tier:Tier; minTier:Tier; maxTier:Tier; maxLevel:number; price:number; stats:Stats; caps:GrowthCaps; ability?:string; abilityDescription?:string; }
export interface Hero extends HeroTemplate { level: number; stats: Stats; /** Importe pagado por el propietario actual. En los gratuitos, se usa el precio del catálogo. */ purchasePrice?: number; }
export interface Team { name: string; gold: number; heroes: Hero[]; blessing: BlessingKey | null; marketRolls: number; }
export interface HeroChange {
  id: string; name: string; side: Side; className: HeroClass; tier: Tier;
  before: Stats | null; after: Stats | null;
  health: number; attack: number; defense: number; speed: number;
  damage: number; damageTaken: number; healed: number; kills: number; deaths:number; saves:number; remainingHp: number;
}
export interface Bout { number: number; winner: Side; turns: number; log: string[]; remainingA: number; remainingB: number; changes: HeroChange[]; }
export interface MatchResult { day:number; winner:Side; scoreA:number; scoreB:number; bouts:Bout[]; summary:string; changes:HeroChange[]; goldA:number; goldB:number; }
export interface SeasonRecord { season: number; mode: Mode; daysPlayed: number; durationDays?: number; scoreA: number; scoreB: number; winsA: number; winsB: number; }
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
export interface MythicAuction { id:string; heroId:string; minimum:number; bids:Record<Side,number>; status:'open'|'awarded'|'cancelled'; winner:Side|null; }
export interface GameState {
  version: 6;
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
  blessingChoices: BlessingKey[];
  result: MatchResult | null;
  history: MatchResult[];
  records: SeasonRecord[];
}
export const CLASS_ICONS: Record<HeroClass, string> = { Mago:'✦', Guerrero:'⚔', Asesino:'◈', Apoyo:'✚', Tanque:'⬡', Bestia:'◆' };
export const BLESSINGS: Record<BlessingKey, {name:string; description:string; icon:string}> = {
  arcane: {name:'Furia arcana',description:'Magos: +18 % de daño',icon:'✦'},
  iron: {name:'Piel de hierro',description:'Todo el equipo: +12 % de defensa',icon:'⬡'},
  hunt: {name:'Instinto salvaje',description:'Bestias y Asesinos: +15 % de daño',icon:'◆'},
  life: {name:'Vitalidad ancestral',description:'Todo el equipo: +12 % de vida',icon:'✚'},
  swift: {name:'Viento veloz',description:'Todo el equipo: +15 % de velocidad',icon:'➶'},
  fury: {name:'Bendición del filo',description:'Guerreros y Tanques: +15 % de daño',icon:'⚔'}
};
