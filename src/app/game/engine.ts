import { CATALOG, MYTHICS, NORMAL_CHAMPIONS } from './catalog';
import { BLESSINGS, BlessingKey, Bout, CLASSES, GameState, Hero, HeroChange, HeroClass, HeroTemplate, MatchResult, Mode, SeasonDuration, Side, StatMode, Stats, Team, TradeOffer, MythicAuction, QUALITY } from './models';

export const START_GOLD = 120;
export const MAX_HEROES = 5;
export const STORAGE_KEY = 'fantasy-arena-local-v1';
export const MARKET_REFRESH_BASE = 2; // 1 + (1 + n), n = renovaciones previas en esta jornada.
export const WIN_GOLD=28;
export const LOSS_GOLD=3;
export const KILL_GOLD=4;
export const SAVE_GOLD=7;
export const DAILY_GOLD_REWARD=0; // Compatibilidad: recompensas solo por acciones y resultado.
export const SEASON_LENGTHS: readonly SeasonDuration[] = [3, 7, 15, 30];
export const DAY_MS = 24 * 60 * 60 * 1000;
export const STAT_VARIATION = {health: 0.10, attack: 0.10, defense: 0.10, speed: 0.10} as const;
export const globalMarketCapacity = (players: number): number => 9 + 2 * Math.max(0, Math.floor(players));
export const LOCAL_PLAYERS = 2; // Modo de prueba A vs B. La arquitectura online admitirá más.
export const marketRefreshCost = (state: GameState, side: Side = 'a'): number => MARKET_REFRESH_BASE + teamFor(state,side).marketRolls;

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
    while (pool.length && result.length < howMany) result.push(pool.splice(this.int(pool.length),1)[0]);
    return result;
  }
  getState(): number { return this.state; }
}

// +1 indica ventaja; -1 desventaja; 0 equilibrio. Cruces excepto Mago: valores provisionales.
const WINS: Record<HeroClass, HeroClass[]> = {
  Mago: ['Bestia','Apoyo','Guerrero'],
  Guerrero: ['Asesino','Tanque'],
  Asesino: ['Mago','Apoyo'],
  Apoyo: ['Guerrero','Tanque'],
  Tanque: ['Asesino','Bestia'],
  Bestia: ['Guerrero','Asesino','Apoyo']
};
export function classAdvantage(attacker: HeroClass, defender: HeroClass): -1|0|1 {
  if (attacker===defender || (attacker==='Mago' && defender==='Tanque') || (attacker==='Tanque' && defender==='Mago')) return 0;
  if (WINS[attacker].includes(defender)) return 1;
  return WINS[defender].includes(attacker) ? -1 : 0;
}
export function makeHero(template: HeroTemplate): Hero {
  return { ...template, stats:{...template.stats}, level:0, purchasePrice:template.price };
}
function teamFor(state: GameState, side: Side): Team { return side==='a'?state.teamA:state.teamB; }
function other(side:Side):Side { return side==='a'?'b':'a'; }
function excludeOwned(state:GameState): Set<string> {
  return new Set([...state.teamA.heroes,...state.teamB.heroes].map(hero=>hero.id));
}
/** Pool único de temporada: un héroe fichado o sorteado nunca vuelve al mercado, aunque se venda. */
function unavailable(state: GameState): Set<string> {
  return new Set([...state.seasonUnavailableIds,...excludeOwned(state)]);
}
export function marketFor(state:GameState,side:Side): Hero[] {
  return state.markets[side];
}
export function visibleMarketCount(state:GameState):number {
  return state.markets.a.length+state.markets.b.length;
}
/** 9+2×jugadores limita ofertas visibles TOTALES; cada tienda roba de un mazo distinto. */
export function personalMarketSlots(side:Side, players=LOCAL_PLAYERS):number {
  const total=globalMarketCapacity(players);
  return Math.floor(total/players)+(side==='a' && total%players>0?1:0);
}
/** El reparto es permanente durante la temporada; no se intercambian cartas entre jugadores. */
export function personalDeck(state: GameState, side: Side): Hero[] {
  return state.playerDecks[side].map(id=>state.seasonHeroes[id]);
}
export function personalDeckRemaining(state: GameState, side: Side): number {
  const blocked=unavailable(state);
  return state.playerDecks[side].filter(id=>!blocked.has(id)).length;
}
/** Reparto equilibrado por clase y rareza, reproducible con la semilla de temporada. */
function dealDecks(rng:Random, reserved?:Record<Side,string[]>):Record<Side,string[]> {
  const decks:Record<Side,string[]>={a:[...new Set(reserved?.a??[])],b:[...new Set(reserved?.b??[])]};
  const assigned=new Set([...decks.a,...decks.b]);
  const allTiers=['Común','Raro','Épico','Legendario'] as const;
  for (const role of CLASSES) for(const tier of allTiers) {
    const group=rng.take(NORMAL_CHAMPIONS.filter(h=>h.className===role && h.tier===tier && !assigned.has(h.id)),CATALOG.length);
    let countA=decks.a.filter(id=>CATALOG.some(h=>h.id===id&&h.className===role&&h.tier===tier)).length;
    let countB=decks.b.filter(id=>CATALOG.some(h=>h.id===id&&h.className===role&&h.tier===tier)).length;
    for(const h of group) {
      const side:Side=countA===countB?(rng.int(2)===0?'a':'b'):countA<countB?'a':'b';
      decks[side].push(h.id);assigned.add(h.id);
      if(side==='a')countA++; else countB++;
    }
  }
  return decks;
}
function shopCandidates(state:GameState,side:Side,includeOwn=false):HeroTemplate[] {
  const excluded=new Set<string>(includeOwn?[]:state.markets[side].map(h=>h.id));
  const banned=unavailable(state);
  return NORMAL_CHAMPIONS.filter(h=>state.playerDecks[side].includes(h.id)&&!excluded.has(h.id)&&!banned.has(h.id));
}
/** Primero cartas aún no vistas; al agotarse, reciclamos las no compradas del mazo propio. */
function newOfferCards(state:GameState,side:Side,rng:Random,count:number,includeOwn=false):HeroTemplate[] {
  const candidates=shopCandidates(state,side,includeOwn);
  const seen=new Set(state.seenMarketIds[side]);
  const unseen=rng.take(candidates.filter(h=>!seen.has(h.id)),count);
  const extra=rng.take(candidates.filter(h=>seen.has(h.id)),count-unseen.length);
  const cards=[...unseen,...extra];
  for(const h of cards)if(!seen.has(h.id)){state.seenMarketIds[side].push(h.id);seen.add(h.id);}
  return cards;
}
function fillShop(state:GameState,side:Side,rng:Random):void {
  const missing=Math.max(0,personalMarketSlots(side)-state.markets[side].length);
  for(const template of newOfferCards(state,side,rng,missing))
    state.markets[side].push(cloneHero(state.seasonHeroes[template.id]));
}
function fillMarkets(state:GameState,rng:Random):void {
  fillShop(state,'a',rng);
  fillShop(state,'b',rng);
}
function cloneHero(hero: Hero): Hero { return {...hero, stats: {...hero.stats}}; }
function botSetup(state:GameState, rng:Random):void {
  const team=state.teamB;
  // La IA compra EXCLUSIVAMENTE desde su tienda privada, respetando la reserva del rival.
  if(state.mythicalAuction?.status==='open' && team.gold>=state.mythicalAuction.minimum+5 && team.heroes.length<5){
    // Rival: participa en la subasta en vez de gastar todo su oro en héroes comunes.
    state.mythicalAuction.bids.b=state.mythicalAuction.minimum+5;
    team.blessing ??= rng.pick(state.blessingChoices);
    return;
  }
  const offers=rng.take(state.markets.b, state.markets.b.length)
    .sort((a,b)=> (a.tier==='Épico'?0:a.tier==='Raro'?1:2)-(b.tier==='Épico'?0:b.tier==='Raro'?1:2));
  for (const offer of offers) {
    if (team.heroes.length>=MAX_HEROES) break;
    if (team.gold>=offer.price) {
      buyFromPrivateShop(state,'b',offer.id,rng);
    }
  }
  if (!team.blessing) team.blessing = rng.pick(state.blessingChoices);
  const affordable = team.heroes.filter(h=>h.tier!=='Mítico' && team.gold>=heroUpgradeCost(h) && h.level<h.maxLevel);
  if (affordable.length) { const h=rng.pick(affordable); upgradeHeroDirect(team,h); syncHero(state,h); }
}
function syncHero(state:GameState, hero:Hero):void {
  state.seasonHeroes[hero.id]=cloneHero(hero);
}
function initialSeasonStats(template:HeroTemplate,rng:Random,mode:StatMode):Hero {
  const hero=makeHero(template);
  if(mode==='random' && template.tier!=='Mítico') {
    // Se sortea una vez por temporada. Nunca se vuelve a tirar al renovar el mercado.
    for(const key of ['health','attack','defense','speed'] as const) {
      const variation=STAT_VARIATION[key];
      hero.stats[key]=Math.max(1,Math.round(template.stats[key]*(1+(rng.next()*2-1)*variation)));
    }
  }
  return hero;
}
function draftSeason(state:GameState,rng:Random):void {
  state.seasonHeroes=Object.fromEntries(CATALOG.map(template=>[template.id,initialSeasonStats(template,rng,state.statMode)]));
  state.seasonBaseStats=Object.fromEntries(Object.values(state.seasonHeroes).map(h=>[h.id,{...h.stats}]));
  state.markets={a:[],b:[]};
  state.tradeOffers=[];
  state.nextTradeId=1;
  state.playerDecks=dealDecks(rng);
  state.seenMarketIds={a:[],b:[]};
  const draftFor=(side:Side)=>rng.take(NORMAL_CHAMPIONS.filter(h=>state.playerDecks[side].includes(h.id) && h.minTier==='Común'),3);
  const startersA=draftFor('a');const startersB=draftFor('b');
  if(startersA.length<3 || startersB.length<3) throw new Error('Cada jugador necesita tres campeones comunes en su mazo.');
  state.teamA={name:'Tu equipo',gold:START_GOLD,heroes:startersA.map(h=>cloneHero(state.seasonHeroes[h.id])),blessing:null,marketRolls:0};
  state.teamB={name:state.mode==='bot'?'Rival IA':'Equipo B',gold:START_GOLD,heroes:startersB.map(h=>cloneHero(state.seasonHeroes[h.id])),blessing:null,marketRolls:0};
  state.seasonUnavailableIds=[...startersA,...startersB].map(h=>h.id);
  state.blessingChoices=rng.take(Object.keys(BLESSINGS) as BlessingKey[],3);
  state.mythicalAuction=null;
  state.mythicSeenSeason=false;
  // Aparición excepcional: una única oportunidad por temporada y reserva global separada.
  if(rng.next()<0.08) openMythicAuction(state,rng);
  fillMarkets(state,rng);
  if(state.mode==='bot') botSetup(state,rng);
  state.result=null;
  state.rngState=rng.getState();
}
export function newGame(seed='ARENA-01', mode:Mode='bot', durationDays:SeasonDuration=7, statMode:StatMode='fixed', now=Date.now()):GameState {
  const rng=Random.fromSeed(seed.trim()||'ARENA-01');
  if(!SEASON_LENGTHS.includes(durationDays)) throw new Error('La duración debe ser 3, 7, 15 o 30 días.');
  const state:GameState={
    version:6,seed:seed.trim()||'ARENA-01',rngState:0,season:1,day:1,durationDays,mode,
    seasonStartedAt:now,seasonEndsAt:now+durationDays*DAY_MS,statMode,seasonHeroes:{},
    scoreA:0,scoreB:0,winsA:0,winsB:0,
    teamA:{name:'Tu equipo',gold:START_GOLD,heroes:[],blessing:null,marketRolls:0},
    teamB:{name:'Rival IA',gold:START_GOLD,heroes:[],blessing:null,marketRolls:0},
    markets:{a:[],b:[]},playerDecks:{a:[],b:[]},seenMarketIds:{a:[],b:[]},seasonUnavailableIds:[],tradeOffers:[],nextTradeId:1,mythicalAuction:null,mythicSeenSeason:false,seasonBaseStats:{},blessingChoices:[],result:null,history:[],records:[]
  };
  draftSeason(state,rng); return state;
}
export function canModify(state:GameState,side:Side):boolean { return !state.result && (side==='a'||state.mode==='manual'); }
function buyFromPrivateShop(state:GameState,side:Side,id:string,existingRng?:Random):string {
  const team=teamFor(state,side);
  if(team.heroes.length>=MAX_HEROES) return 'Ya tienes cinco personajes equipados.';
  const hero=state.markets[side].find(h=>h.id===id);
  if(!hero) return 'El personaje no está en tu tienda privada.';
  if(team.gold<hero.price) return 'No tienes oro suficiente.';
  if(unavailable(state).has(hero.id)) return 'Ese personaje ya fue obtenido esta temporada.';
  team.gold-=hero.price;
  const purchased=cloneHero(state.seasonHeroes[hero.id]);
  purchased.purchasePrice=hero.price;
  team.heroes.push(purchased);
  syncHero(state,purchased);
  state.markets[side]=state.markets[side].filter(h=>h.id!==id);
  state.seasonUnavailableIds.push(hero.id);
  // La venta posterior no devuelve el personaje al mercado esta temporada.
  const rng=existingRng??new Random(state.rngState);
  fillShop(state,side,rng);
  if(!existingRng) state.rngState=rng.getState();
  return `${hero.name} se ha unido a ${team.name}.`;
}
export function buyHero(state:GameState,side:Side,id:string): string {
  if(!canModify(state,side)) return 'El mercado está cerrado para ese equipo.';
  return buyFromPrivateShop(state,side,id);
}
/** Precio de compra del propietario actual; draft inicial: precio base del catálogo. */
export function minimumOffer(hero:Hero):number {
  return Math.max(1, Number.isSafeInteger(hero.purchasePrice) && (hero.purchasePrice as number)>0 ? hero.purchasePrice! : hero.price);
}
/** Solicitar comprar un héroe al rival, aun si procede del mazo privado del rival. */
export function requestPurchase(state:GameState,buyer:Side,heroId:string,amount:number):string {
  if(!canModify(state,buyer))return 'Solo puedes negociar durante la preparación de la jornada.';
  const seller=other(buyer);
  const mine=teamFor(state,buyer),theirs=teamFor(state,seller);
  const hero=theirs.heroes.find(h=>h.id===heroId);
  if(!hero)return 'El personaje no pertenece actualmente al equipo rival.';
  if(hero.tier==='Mítico')return 'Los Míticos solo pueden obtenerse mediante subasta.';
  if(!Number.isSafeInteger(amount)||amount<=0)return 'Introduce una oferta de oro entera y positiva.';
  const minimum=minimumOffer(hero);
  if(amount<minimum)return `La oferta mínima por ${hero.name} es ${minimum} de oro.`;
  if(mine.gold<amount)return 'No tienes oro suficiente para realizar esa oferta.';
  if(mine.heroes.length>=MAX_HEROES)return 'No puedes recibir un personaje con la plantilla completa (máximo 5).';
  if(theirs.heroes.length<=3)return 'El vendedor debe conservar un mínimo de tres personajes.';
  if(state.tradeOffers.some(o=>o.status==='pending'&&o.buyer===buyer&&o.heroId===heroId))
    return 'Ya tienes una oferta pendiente por ese personaje.';
  const offer:TradeOffer={id:`T${state.season}-${state.nextTradeId++}`,season:state.season,day:state.day,
    buyer,seller,heroId:hero.id,heroName:hero.name,amount,minPrice:minimum,status:'pending'};
  state.tradeOffers.push(offer);
  // En modo bot, la IA valora la propuesta inmediatamente. Umbral provisional para pruebas.
  if(state.mode==='bot'&&seller==='b'){
    if(amount>=Math.ceil(minimum*1.4)){
      const response=respondToPurchase(state,offer.id,'b',true);
      return response;
    }
    offer.status='rejected';
    return `La IA rechaza ${amount} de oro por ${hero.name} (busca al menos un 40 % por encima de su coste).`;
  }
  return `Oferta enviada: ${amount} de oro por ${hero.name}. El propietario podrá aceptarla o rechazarla.`;
}
/** Aceptar o rechazar solamente como el propietario del héroe solicitado. */
export function respondToPurchase(state:GameState,offerId:string,actingSide:Side,accept:boolean):string {
  const offer=state.tradeOffers.find(o=>o.id===offerId);
  if(!offer||offer.status!=='pending')return 'La oferta no está pendiente.';
  if(offer.seller!==actingSide)return 'Solo el propietario puede responder a esta oferta.';
  if(state.result)return 'Las negociaciones se cierran al comenzar el combate.';
  if(!accept){offer.status='rejected';return `Oferta rechazada por ${offer.heroName}.`;}
  const buyer=teamFor(state,offer.buyer),seller=teamFor(state,offer.seller);
  const hero=seller.heroes.find(h=>h.id===offer.heroId);
  if(!hero){offer.status='expired';return 'El campeón ya no está en ese equipo. Oferta caducada.';}
  if(hero.tier==='Mítico')return 'Los Míticos no se pueden traspasar.';
  if(buyer.heroes.length>=MAX_HEROES)return 'No se puede aceptar: el comprador tiene cinco personajes.';
  if(seller.heroes.length<=3)return 'No se puede aceptar: el vendedor se quedaría con menos de tres personajes.';
  if(buyer.gold<offer.amount)return 'No se puede aceptar: el comprador ya no tiene oro suficiente.';
  if(offer.amount<minimumOffer(hero))return 'No se puede aceptar: el mínimo de compra ha cambiado.';
  // Operación atómica en memoria local. En Supabase será una transacción en PostgreSQL.
  buyer.gold-=offer.amount;
  seller.gold+=offer.amount;
  seller.heroes=seller.heroes.filter(h=>h.id!==hero.id);
  const transferred=cloneHero(hero);
  transferred.purchasePrice=offer.amount;
  buyer.heroes.push(transferred);
  syncHero(state,transferred);
  offer.status='accepted';
  for(const p of state.tradeOffers)if(p.id!==offer.id&&p.status==='pending'&&p.heroId===hero.id)p.status='expired';
  return `${hero.name} cambia de equipo por ${offer.amount} de oro. Conserva sus estadísticas y nivel.`;
}
export function cancelPurchase(state:GameState,offerId:string,actingSide:Side):string {
  const offer=state.tradeOffers.find(o=>o.id===offerId);
  if(!offer||offer.status!=='pending')return 'La oferta no está pendiente.';
  if(offer.buyer!==actingSide)return 'Solo quien envió la oferta puede cancelarla.';
  if(state.result)return 'Las negociaciones se cierran al comenzar el combate.';
  offer.status='cancelled';
  return 'Oferta cancelada.';
}
function expirePendingTrades(state:GameState):void {
  for(const offer of state.tradeOffers)if(offer.status==='pending')offer.status='expired';
}
export function sellHero(state:GameState,side:Side,id:string):string {
  if(!canModify(state,side)) return 'No puedes vender después de combatir.';
  const team=teamFor(state,side);
  if(team.heroes.length<=3) return 'Debes conservar al menos tres personajes.';
  const hero=team.heroes.find(h=>h.id===id);
  if(!hero) return 'Personaje no encontrado.';
  if(hero.tier==='Mítico')return 'Los Míticos no se venden: se consiguen solo por subastas.';
  const refund=Math.floor(hero.price*.7)+hero.level*6;
  team.gold+=refund;
  team.heroes=team.heroes.filter(h=>h.id!==id);
  for(const offer of state.tradeOffers)if(offer.status==='pending'&&offer.heroId===hero.id)offer.status='expired';
  syncHero(state, hero);
  // No se repone en ninguna tienda: los personajes vendidos quedan retirados de esta temporada.
  return `${hero.name} vendido por ${refund} de oro.`;
}
export const LEVEL_BONUS:Stats={health:10,attack:3,defense:2,speed:1};
export const QUALITY_BONUS:Stats={health:14,attack:4,defense:3,speed:1};
export function heroUpgradeCost(hero:Hero):number {return hero.tier==='Mítico'?Infinity:16+hero.level*12;}
export function qualityUpgradeCost(hero:Hero):number {
  if(hero.tier==='Mítico' || QUALITY.indexOf(hero.tier)>=QUALITY.indexOf(hero.maxTier))return Infinity;
  return [60,110,170][QUALITY.indexOf(hero.tier)] ?? Infinity;
}
export function upgradePreview(hero:Hero,kind:'level'|'quality'):Stats {
  return {...(kind==='level'?LEVEL_BONUS:QUALITY_BONUS)};
}
function boost(hero:Hero,gain:Stats):void {
  for(const k of ['health','attack','defense','speed'] as const)hero.stats[k]+=gain[k];
}
function upgradeHeroDirect(team:Team,hero:Hero):void {
  const price=heroUpgradeCost(hero);
  team.gold-=price;hero.level++;boost(hero,LEVEL_BONUS);
}
export function upgradeHero(state:GameState,side:Side,id:string):string {
  if(!canModify(state,side))return 'La jornada ya está cerrada.';
  const team=teamFor(state,side),hero=team.heroes.find(h=>h.id===id);
  if(!hero)return 'Personaje no encontrado.';
  if(hero.tier==='Mítico')return 'Los Míticos no pueden recibir mejoras.';
  if(hero.level>=hero.maxLevel)return 'Ha alcanzado su tier máximo.';
  if(team.gold<heroUpgradeCost(hero))return 'Oro insuficiente.';
  upgradeHeroDirect(team,hero);syncHero(state,hero);
  return `${hero.name}: nivel ${hero.level+1}/${hero.maxLevel+1}.`;
}
export function upgradeQuality(state:GameState,side:Side,id:string):string {
  if(!canModify(state,side))return 'La jornada ya está cerrada.';
  const team=teamFor(state,side),hero=team.heroes.find(h=>h.id===id);
  if(!hero)return 'Personaje no encontrado.';
  const cost=qualityUpgradeCost(hero);
  if(!Number.isFinite(cost))return 'Este campeón no puede subir más de calidad.';
  if(team.gold<cost)return 'Oro insuficiente para ascender su calidad.';
  team.gold-=cost;
  hero.tier=QUALITY[QUALITY.indexOf(hero.tier)+1];
  boost(hero,QUALITY_BONUS);syncHero(state,hero);
  return `${hero.name} asciende a calidad ${hero.tier}.`;
}
/** La subasta es el único origen de los míticos. No aparecen en mazos ni en tiendas. */
function openMythicAuction(state:GameState,rng:Random):void {
  if(state.mythicSeenSeason)return;
  const mythic=rng.pick(MYTHICS);
  state.mythicalAuction={id:`M${state.season}`,heroId:mythic.id,minimum:mythic.price,bids:{a:0,b:0},status:'open',winner:null};
  state.mythicSeenSeason=true;
}
/** Herramienta de laboratorio: abre una subasta mítica de prueba sin afectar a otras ligas. */
export function forceMythicAuction(state:GameState):string {
  if(state.result)return 'Avanza de jornada antes de abrir una subasta.';
  if(state.mythicalAuction)return 'Ya existe una subasta mítica en esta temporada.';
  const rng=new Random(state.rngState);
  state.mythicSeenSeason=false;
  openMythicAuction(state,rng);
  state.rngState=rng.getState();
  return 'Subasta mítica experimental abierta en esta partida local.';
}
export function placeMythicBid(state:GameState,side:Side,amount:number):string {
  const a=state.mythicalAuction,team=teamFor(state,side);
  if(!a || a.status!=='open'||state.result)return 'No hay subasta mítica abierta.';
  if(!canModify(state,side))return 'No tienes permisos para pujar por este equipo.';
  if(team.heroes.length>=MAX_HEROES)return 'Libera un hueco antes de pujar (máximo cinco).';
  if(!Number.isSafeInteger(amount)||amount<a.minimum)return `La puja mínima es ${a.minimum} oro.`;
  const otherBid=a.bids[other(side)];
  if(amount<=otherBid||amount<=a.bids[side])return `Tu oferta debe superar todas las pujas vigentes.`;
  if(team.gold<amount)return 'Oro insuficiente para realizar esta puja.';
  a.bids[side]=amount;
  return `${team.name} puja ${amount} oro por ${state.seasonHeroes[a.heroId].name}.`;
}
export function resolveMythicAuction(state:GameState):string {
  const a=state.mythicalAuction;
  if(!a||a.status!=='open')return 'No hay subasta mítica pendiente.';
  const side:Side|null=a.bids.a===0&&a.bids.b===0?null:a.bids.a>a.bids.b?'a':'b';
  if(!side){a.status='cancelled';return 'Subasta cerrada sin ofertas.';}
  const team=teamFor(state,side),price=a.bids[side];
  if(team.gold<price||team.heroes.length>=MAX_HEROES){a.status='cancelled';return 'Subasta cancelada: el ganador no puede pagar o no tiene espacio.';}
  team.gold-=price;
  const hero=cloneHero(state.seasonHeroes[a.heroId]);hero.purchasePrice=price;
  team.heroes.push(hero);syncHero(state,hero);
  state.seasonUnavailableIds.push(hero.id);
  a.status='awarded';a.winner=side;
  return `${team.name} gana la subasta de ${hero.name} por ${price} oro.`;
}
export function chooseBlessing(state:GameState,side:Side,key:BlessingKey):string {
  if(!canModify(state,side)) return 'No puedes cambiar la bendición.';
  if(state.history.length>0) return 'La bendición queda fijada después del primer combate de la temporada.';
  if(!state.blessingChoices.includes(key)) return 'Bendición no disponible en esta temporada.';
  teamFor(state,side).blessing=key;
  return 'Bendición preparada para el combate.';
}
export function refreshMarket(state:GameState,side:Side='a'):string {
  if(!canModify(state,side)) return 'El mercado está cerrado.';
  const team=teamFor(state,side);
  const cost=marketRefreshCost(state,side);
  if(team.gold<cost) return 'No tienes oro suficiente para renovar el mercado.';
  const previous=state.markets[side];
  const rng=new Random(state.rngState);
  const desired=personalMarketSlots(side);
  const oldSeen=[...state.seenMarketIds[side]];
  // Sin mezclar mazos. Evitamos incluso repetir cartas del escaparate actual
  // mientras existan alternativas sin comprar en el mazo del usuario.
  const fresh=newOfferCards(state,side,rng,desired);
  const remaining=Math.max(0,desired-fresh.length);
  const fallback=rng.take(previous.filter(h=>!fresh.some(n=>n.id===h.id)),remaining);
  const next=[...fresh,...fallback];
  if(!next.length || (next.length===previous.length && next.every(h=>previous.some(p=>p.id===h.id)))) {
    state.seenMarketIds[side]=oldSeen;
    return 'No quedan cartas diferentes en tu mazo para renovar. No se ha cobrado oro.';
  }
  team.gold-=cost;
  team.marketRolls++;
  state.markets[side]=next.map(h=>cloneHero(state.seasonHeroes[h.id]));
  state.rngState=rng.getState();
  return `Tienda renovada por ${cost} de oro. La siguiente renovación cuesta ${marketRefreshCost(state,side)}.`;
}

interface Fighter {
  id:string; name:string; className:HeroClass; side:Side; stats:Stats;
  hp:number; maxHp:number; shield:number; turns:number;
  damage:number; damageTaken:number; healed:number; kills:number;saves:number;shieldBy:string|null;mythicGuardUsed:boolean;
}
function makeFighters(team:Team,side:Side):Fighter[] {
  return team.heroes.map(h=>{
    const s={...h.stats};
    switch(team.blessing){
      case 'iron':s.defense=Math.round(s.defense*1.12);break;
      case 'life':s.health=Math.round(s.health*1.12);break;
      case 'swift':s.speed=Math.round(s.speed*1.15);break;
      case 'arcane':if(h.className==='Mago')s.attack=Math.round(s.attack*1.18);break;
      case 'hunt':if(['Bestia','Asesino'].includes(h.className))s.attack=Math.round(s.attack*1.15);break;
      case 'fury':if(['Guerrero','Tanque'].includes(h.className))s.attack=Math.round(s.attack*1.15);break;
    }
    return {id:h.id,name:h.name,className:h.className,side,stats:s,hp:s.health,maxHp:s.health,shield:0,turns:0,damage:0,damageTaken:0,healed:0,kills:0,saves:0,shieldBy:null,mythicGuardUsed:false};
  });
}
function alive(units:Fighter[]):Fighter[] {return units.filter(u=>u.hp>0);}
function battleTarget(attacker:Fighter,enemies:Fighter[],rng:Random):Fighter {
  const living=alive(enemies);
  if(attacker.className==='Asesino') return [...living].sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
  if(attacker.className==='Mago') {
    const weaknesses=living.filter(target=>classAdvantage(attacker.className,target.className)===1);
    if(weaknesses.length)return rng.pick(weaknesses);
  }
  return rng.pick(living);
}
function strike(attacker:Fighter,defender:Fighter,allies:Fighter[],rng:Random,log:string[],strength=1):void {
  let target=defender;
  const guard=alive(allies).filter(f=>f.className==='Tanque' && f.id!==defender.id);
  const guardRoll=rng.next();
  const defenderPotential=Math.max(4,Math.round((attacker.stats.attack*(.58+.12)-defender.stats.defense*.22)*strength));
  const mythicalGuardian=guard.find(g=>g.id==='myth-tank' && !g.mythicGuardUsed && defenderPotential>=defender.hp+defender.shield);
  if(guard.length && (mythicalGuardian||guardRoll<.22)) {
    target=mythicalGuardian??rng.pick(guard);
    if(mythicalGuardian)mythicalGuardian.mythicGuardUsed=true;
    if(defenderPotential>=defender.hp+defender.shield){target.saves++;log.push(`★ ¡${target.name} salva a ${defender.name} de un golpe mortal!`);}
    else log.push(`🛡 ${target.name} intercepta un ataque dirigido a ${defender.name}.`);
  }
  const adv=classAdvantage(attacker.className,target.className);
  let multiplier=adv===1?1.16:adv===-1?.88:1;
  if(attacker.className==='Guerrero' && rng.next()<.23){multiplier*=1.35;log.push(`⚔ ${attacker.name} prepara un golpe contundente.`);}
  if(attacker.className==='Asesino' && rng.next()<.26){multiplier*=1.65;log.push(`◈ ¡Golpe crítico de ${attacker.name}!`);}
  if(attacker.id==='myth-assassin' && target.hp/target.maxHp<.35){multiplier*=1.6;log.push(`★ ${attacker.name} desata Sentencia de Sombra.`);}
  if(attacker.id==='myth-war' && attacker.hp/attacker.maxHp<.4){multiplier*=1.45;log.push(`★ ${attacker.name} activa su Último Bastión.`);}
  const raw=(attacker.stats.attack*(.58+rng.next()*.25)-target.stats.defense*.22)*multiplier*strength;
  const hit=Math.max(4,Math.round(raw));
  if(target===defender && hit>=target.hp+target.shield && target.shield>0 && target.shieldBy){
    const guardian=allies.find(h=>h.id===target.shieldBy);
    if(guardian){guardian.saves++;log.push(`★ ¡El escudo de ${guardian.name} evita la muerte de ${target.name}!`);}
  }
  const blocked=Math.min(target.shield,hit);target.shield-=blocked;
  const damage=Math.min(target.hp,hit-blocked);
  target.hp=Math.max(0,target.hp-damage);
  attacker.damage+=damage;target.damageTaken+=damage;
  if(attacker.id==='myth-beast'&&damage>0){const heal=Math.min(attacker.maxHp-attacker.hp,Math.round(damage*.3));attacker.hp+=heal;attacker.healed+=heal;}
  const icon=adv===1?'↑':adv===-1?'↓':'·';
  log.push(`${icon} ${attacker.name} → ${target.name}: ${damage} de daño${blocked?` (${blocked} bloqueado)`:''}.${target.hp===0?' ☠ DERROTADO':''}`);
  if(target.hp===0)attacker.kills++;
}
function takeAction(actor:Fighter,friends:Fighter[],enemies:Fighter[],rng:Random,log:string[]):void {
  if(!alive(enemies).length)return;
  actor.turns++;
  const wounded=alive(friends).filter(h=>h.hp<=h.maxHp*.78);
  if(actor.id==='myth-support' && wounded.length){
    let healed=0;for(const friend of wounded){const n=Math.min(friend.maxHp-friend.hp,Math.round(8+actor.stats.attack*.38));friend.hp+=n;healed+=n;}
    actor.healed+=healed;log.push(`★ ${actor.name} invoca Santuario y cura ${healed} PV al equipo.`);return;
  }
  if(actor.className==='Apoyo' && wounded.length && actor.turns%3!==0) {
    const target=[...wounded].sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
    const amount=Math.min(target.maxHp-target.hp,Math.round(11+actor.stats.attack*.56));
    target.hp+=amount;actor.healed+=amount;
    log.push(`✚ ${actor.name} cura ${amount} PV a ${target.name}.`);
    return;
  }
  if(actor.className==='Tanque' && (actor.turns%3===1)) {
    const target=[...alive(friends)].sort((a,b)=>a.shield-b.shield)[0];
    const shield=Math.round(12+actor.stats.defense*.6);
    target.shield+=shield;target.shieldBy=actor.id;
    log.push(`⬡ ${actor.name} protege a ${target.name} con ${shield} puntos de escudo.`);
    return;
  }
  const primary=battleTarget(actor,enemies,rng);
  if(actor.className==='Mago' && actor.turns%3===0) {
    const others=alive(enemies).filter(h=>h.id!==primary.id);
    log.push(`✦ ${actor.name} desencadena una explosión arcana.`);
    strike(actor,primary,enemies,rng,log,.85);
    if(actor.id==='myth-mage'){for(const target of others)if(target.hp>0)strike(actor,target,enemies,rng,log,.6);}
    else if(others.length)strike(actor,rng.pick(others),enemies,rng,log,.7);
    return;
  }
  strike(actor,primary,enemies,rng,log);
  if(actor.className==='Bestia' && alive(enemies).length && (actor.id==='myth-beast'||rng.next()<.28)) {
    log.push(`◆ ¡${actor.name} ataca una segunda vez!`);
    strike(actor,battleTarget(actor,enemies,rng),enemies,rng,log,.55);
  }
}
/** Cada batalla SOLO registra actuaciones. Las stats NO cambian hasta acabar las cinco. */
function recordBout(team:Team,side:Side,fighters:Fighter[]):HeroChange[] {
 return team.heroes.map(hero=>{
   const f=fighters.find(f=>f.id===hero.id)!;
   return {id:hero.id,name:hero.name,side,className:hero.className,tier:hero.tier,
    before:{...hero.stats},after:{...hero.stats},health:0,attack:0,defense:0,speed:0,
    damage:f.damage,damageTaken:f.damageTaken,healed:f.healed,kills:f.kills,
    deaths:f.hp===0?1:0,saves:f.saves,remainingHp:f.hp};
 });
}
function applyDayProgress(team:Team,side:Side,bouts:Bout[]):HeroChange[] {
 return team.heroes.map(hero=>{
   const metrics=bouts.flatMap(b=>b.changes).filter(c=>c.id===hero.id&&c.side===side);
   const sum=(field:'kills'|'deaths'|'damage'|'damageTaken'|'healed'|'saves')=>metrics.reduce((acc,c)=>acc+c[field],0);
   const kills=sum('kills'), deaths=sum('deaths'), damage=sum('damage'), taken=sum('damageTaken'), healed=sum('healed'), saves=sum('saves');
   const before={...hero.stats};
   if(hero.tier!=='Mítico') {
     const proposed:Stats={
       health:Math.floor(healed/70)+saves*2-deaths*2,
       attack:Math.floor(kills/2)+Math.floor(damage/300)-deaths,
       defense:Math.floor(taken/130)+saves-deaths,
       speed:Math.floor(kills/4)-Math.floor(deaths/2)
     };
     for(const k of ['health','attack','defense','speed'] as const){
       const caps=hero.caps[k];const delta=Math.max(caps.min,Math.min(caps.max,proposed[k]));
       // Penalizaciones solo procedentes de muertes, nunca de perder la batalla.
       hero.stats[k]=Math.max(1,hero.stats[k]+delta);
     }
   }
   return {id:hero.id,name:hero.name,side,className:hero.className,tier:hero.tier,
     before,after:{...hero.stats},health:hero.stats.health-before.health,
     attack:hero.stats.attack-before.attack,defense:hero.stats.defense-before.defense,
     speed:hero.stats.speed-before.speed,damage,damageTaken:taken,healed,kills,deaths,saves,remainingHp:metrics.at(-1)?.remainingHp??0};
 });
}
function simulateBout(teamA:Team,teamB:Team,number:number,rng:Random):Bout {
  const left=makeFighters(teamA,'a');const right=makeFighters(teamB,'b');
  const log:string[]=[];
  let turns=0;
  for(let round=0;round<25;round++){
    if(!alive(left).length||!alive(right).length)break;
    turns++;
    const order=[...alive(left),...alive(right)].map(h=>({h,initiative:h.stats.speed+rng.next()*13}))
      .sort((a,b)=>b.initiative-a.initiative).map(i=>i.h);
    for(const fighter of order){
      if(fighter.hp<=0||!alive(left).length||!alive(right).length)continue;
      const friends=fighter.side==='a'?left:right;
      const enemies=fighter.side==='a'?right:left;
      takeAction(fighter,friends,enemies,rng,log);
    }
  }
  const remainingA=left.reduce((sum,h)=>sum+h.hp/h.maxHp,0);
  const remainingB=right.reduce((sum,h)=>sum+h.hp/h.maxHp,0);
  const winner:Side=remainingA===remainingB?(rng.next()<.5?'a':'b'):(remainingA>remainingB?'a':'b');
  log.push(`🏁 Ronda ${number}: gana ${winner==='a'?'Equipo A':'Equipo B'} (vida media restante ${Math.round(remainingA/left.length*100)} % vs ${Math.round(remainingB/right.length*100)} %).`);
  const changes=[...recordBout(teamA,'a',left),...recordBout(teamB,'b',right)];
  return {number,winner,turns,log,remainingA:Math.round(remainingA/left.length*100),remainingB:Math.round(remainingB/right.length*100),changes};
}
export function simulateMatch(state:GameState): MatchResult {
  if(state.result)throw new Error('Esta jornada ya se ha disputado.');
  if(state.teamA.heroes.length<3 || state.teamB.heroes.length<3)throw new Error('Se requieren tres personajes por equipo.');
  if(!state.teamA.blessing||!state.teamB.blessing)throw new Error('Selecciona una bendición para cada equipo.');
  if(state.mythicalAuction?.status==='open')resolveMythicAuction(state);
  const rng=new Random(state.rngState);
  const bouts:Bout[]=[];
  let scoreA=0,scoreB=0;
  for(let n=1;n<=5;n++){
    const bout=simulateBout(state.teamA,state.teamB,n,rng);bouts.push(bout);
    if(bout.winner==='a')scoreA++;else scoreB++;
  }
  const winner:Side=scoreA>scoreB?'a':'b';
  const summary=winner==='a'?'¡Victoria! Has ganado el enfrentamiento.':'Derrota: el equipo rival se impone en esta jornada.';
  const changes=[...applyDayProgress(state.teamA,'a',bouts),...applyDayProgress(state.teamB,'b',bouts)];
  const prize=(side:Side)=> (winner===side?WIN_GOLD:LOSS_GOLD)+changes.filter(c=>c.side===side).reduce((sum,c)=>sum+c.kills*KILL_GOLD+c.saves*SAVE_GOLD,0);
  const goldA=prize('a'),goldB=prize('b');
  state.teamA.gold+=goldA;state.teamB.gold+=goldB;
  const result:MatchResult={day:state.day,winner,scoreA,scoreB,bouts,summary,changes,goldA,goldB};
  state.result=result;state.history.push(result);
  expirePendingTrades(state);
  if(winner==='a'){state.scoreA+=3;state.winsA++;}else{state.scoreB+=3;state.winsB++;}
  for(const hero of [...state.teamA.heroes,...state.teamB.heroes]) syncHero(state,hero);
  state.rngState=rng.getState();
  return result;
}
function archiveAndRestartSeason(state:GameState,now:number):string {
  state.records.push({season:state.season,mode:state.mode,daysPlayed:state.history.length,durationDays:state.durationDays,
    scoreA:state.scoreA,scoreB:state.scoreB,winsA:state.winsA,winsB:state.winsB});
  state.season++;
  state.day=1;
  state.seasonStartedAt=now;
  state.seasonEndsAt=now+state.durationDays*DAY_MS;
  state.scoreA=state.scoreB=state.winsA=state.winsB=0;
  state.history=[];
  draftSeason(state,new Random(state.rngState));
  return `Comienza la temporada ${state.season}: nueva plantilla, nuevas bendiciones y nuevas estadísticas iniciales.`;
}
/** Se ejecuta al abrir la aplicación y periódicamente. El reloj local es provisional; en Supabase mandará el servidor. */
export function expireSeason(state:GameState,now=Date.now()):string|null {
  if(now<state.seasonEndsAt) return null;
  return archiveAndRestartSeason(state,now);
}
export function nextDay(state:GameState,now=Date.now()):string {
  if(now>=state.seasonEndsAt) return archiveAndRestartSeason(state,now);
  if(!state.result) return 'Debes disputar la jornada antes de avanzar.';
  const rng=new Random(state.rngState);
  expirePendingTrades(state);
  state.day++;
  state.result=null;
  // La plantilla, la bendición, el nivel y las estadísticas se mantienen toda la temporada.
  for(const team of [state.teamA,state.teamB]) {
    team.marketRolls=0;
    // El oro se entrega al cerrar la jornada por victoria, bajas y defensas salvadoras.
  }
  // Una oportunidad Mítica excepcional puede aparecer más avanzada la temporada.
  if(!state.mythicSeenSeason && rng.next()<0.04) openMythicAuction(state,rng);
  // El bot mantiene sus fichajes previos y decide si invierte el oro ganado.
  if(state.mode==='bot') botSetup(state,rng);
  fillMarkets(state,rng);
  state.rngState=rng.getState();
  return `Jornada ${state.day}: mantienes personajes, calidad y stats; las renovaciones vuelven a costar 2.`;
}
export function batchTest(state:GameState,simulations=100):{a:number;b:number;percentageA:number} {
  if(state.teamA.heroes.length<3||state.teamB.heroes.length<3||!state.teamA.blessing||!state.teamB.blessing)throw new Error('Ambos equipos necesitan sus bendiciones.');
  let a=0,b=0;
  const rng=new Random(state.rngState);
  for(let i=0;i<simulations;i++){
    const cloneA:Team={...state.teamA,heroes:state.teamA.heroes.map(h=>({...h,stats:{...h.stats}}))};
    const cloneB:Team={...state.teamB,heroes:state.teamB.heroes.map(h=>({...h,stats:{...h.stats}}))};
    let winsA=0;
    for(let n=1;n<=5;n++)if(simulateBout(cloneA,cloneB,n,rng).winner==='a')winsA++;
    if(winsA>=3)a++;else b++;
  }
  return {a,b,percentageA:Math.round((a/simulations)*100)};
}
export function isValidState(value:unknown):value is GameState {
  if(!value||typeof value!=='object')return false;
  const v=value as Partial<GameState>;
  if(v.version!==6||!Array.isArray(v.tradeOffers)||!Number.isSafeInteger(v.nextTradeId)||typeof v.seed!=='string'||typeof v.rngState!=='number'||
     typeof v.day!=='number'||!SEASON_LENGTHS.includes(v.durationDays as SeasonDuration)||
     (v.statMode!=='fixed'&&v.statMode!=='random')||
     !v.markets||!Array.isArray(v.markets.a)||!Array.isArray(v.markets.b)||
     !v.playerDecks||!Array.isArray(v.playerDecks.a)||!Array.isArray(v.playerDecks.b)||
     !v.seenMarketIds||!Array.isArray(v.seenMarketIds.a)||!Array.isArray(v.seenMarketIds.b)||
     !Array.isArray(v.seasonUnavailableIds)||!v.seasonBaseStats||!v.seasonHeroes||
     typeof v.seasonStartedAt!=='number'||typeof v.seasonEndsAt!=='number'||
     !v.teamA||!v.teamB||typeof v.teamA.marketRolls!=='number'||
     typeof v.teamB.marketRolls!=='number'||!('mythicalAuction' in v)||typeof v.mythicSeenSeason!=='boolean'||!Array.isArray(v.teamA.heroes)||
     !Array.isArray(v.teamB.heroes)||!Array.isArray(v.history))return false;
  const a=new Set(v.playerDecks.a);const b=new Set(v.playerDecks.b);
  if([...a].some(id=>b.has(id)))return false;
  return v.markets.a.every(h=>a.has(h.id)) && v.markets.b.every(h=>b.has(h.id));
}
/** Migration preserving rosters, season stats and visible offers.
 * Old rolled-off offers cannot be reconstructed retrospectively: decks are assigned now.
 */
export function migrateSavedState(value:unknown,now=Date.now()):GameState|null {
  if(isValidState(value))return value;
  if(!value||typeof value!=='object')return null;
  const v=value as Record<string,any>;
  if(v.version===1 && typeof v.seed==='string' && v.teamA && v.teamB &&
     Array.isArray(v.teamA.heroes) && Array.isArray(v.teamB.heroes) && Array.isArray(v.market)) {
    const oldDays=Number(v.maxDays)||14;
    const durationDays=SEASON_LENGTHS.reduce((a,b)=>Math.abs(a-oldDays)<=Math.abs(b-oldDays)?a:b);
    const seasonHeroes:Record<string,Hero>=Object.fromEntries(CATALOG.map(h=>[h.id,makeHero(h)]));
    for(const hero of [...v.market,...v.teamA.heroes,...v.teamB.heroes])
      if(hero&&seasonHeroes[hero.id]) seasonHeroes[hero.id]=cloneHero(hero);
    v.version=2;v.durationDays=durationDays;v.seasonStartedAt=now;
    v.seasonEndsAt=now+durationDays*DAY_MS;v.statMode='fixed';v.seasonHeroes=seasonHeroes;
    v.teamA.marketRolls=0;v.teamB.marketRolls=0;
  }
  const rng=new Random(typeof v.rngState==='number'?v.rngState:Random.fromSeed(v.seed??'ARENA-01').getState());
  if(v.version===2) {
    if(!v.teamA||!v.teamB||!Array.isArray(v.teamA.heroes)||!Array.isArray(v.teamB.heroes)||
       !Array.isArray(v.market)||!v.seasonHeroes)return null;
    const sourceOffers=v.market.filter((h:Hero)=>!!v.seasonHeroes[h?.id]);
    v.markets={a:sourceOffers.slice(0,personalMarketSlots('a')).map(cloneHero),b:[]};
    v.seasonUnavailableIds=[...new Set([...v.teamA.heroes,...v.teamB.heroes].map((h:Hero)=>h.id))];
    v.seasonBaseStats=Object.fromEntries(CATALOG.map(h=>[h.id,{...h.stats}]));
    v.version=3;
  }
  if(v.version===4 && v.teamA && v.teamB && v.playerDecks && v.markets) {
    v.tradeOffers=[];
    v.nextTradeId=1;
    for(const hero of [...v.teamA.heroes,...v.teamB.heroes]) {
      if(hero.purchasePrice===undefined)hero.purchasePrice=hero.price;
    }
    v.version=5;
    // Proseguir a la migración v6.
  }
  if(v.version===5) {
    if(!v.teamA||!v.teamB||!v.playerDecks||!v.markets)return null;
    for(const hero of [...v.teamA.heroes,...v.teamB.heroes]) {
      const fresh=CATALOG.find(h=>h.id===hero.id);if(!fresh)continue;
      hero.minTier=fresh.minTier;hero.maxTier=fresh.maxTier;hero.maxLevel=fresh.maxLevel;
      hero.caps=fresh.caps;hero.ability=fresh.ability;
    }
    v.seasonHeroes=Object.fromEntries(CATALOG.map(template=>{
      const existing=v.seasonHeroes?.[template.id];
      return [template.id,existing?{...makeHero(template),...existing,minTier:template.minTier,maxTier:template.maxTier,maxLevel:template.maxLevel,caps:template.caps,ability:template.ability}:makeHero(template)];
    }));
    for(const side of ['a','b'] as const){
      v.markets[side]=(v.markets[side]??[]).map((old:Hero)=>({
        ...v.seasonHeroes[old.id],stats:{...old.stats}
      }));
    }
    v.seasonBaseStats=Object.fromEntries(CATALOG.map(template=>[template.id,v.seasonBaseStats?.[template.id]??{...template.stats}]));
    v.mythicalAuction=null;v.mythicSeenSeason=false;
    v.version=6;
    for(const record of v.history??[])if(!record.changes){record.changes=[];record.goldA=0;record.goldB=0;}
    if(v.result&&!v.result.changes){v.result.changes=[];v.result.goldA=0;v.result.goldB=0;}
    return isValidState(v)?v as GameState:null;
  }
  if(v.version!==3||!v.teamA||!v.teamB||!v.markets||
     !Array.isArray(v.markets.a)||!Array.isArray(v.markets.b)||!v.seasonHeroes)return null;
  // Respeta campeones ya obtenidos y ofertas actuales de ambas tiendas.
  const reservedA=[...v.teamA.heroes,...v.markets.a].map((h:Hero)=>h.id);
  const reservedB=[...v.teamB.heroes,...v.markets.b].map((h:Hero)=>h.id);
  const decks=dealDecks(rng,{a:reservedA,b:reservedB.filter((id:string)=>!reservedA.includes(id))});
  const previousHeroes=v.seasonHeroes as Record<string,Hero>;
  v.seasonHeroes=Object.fromEntries(CATALOG.map(h=>[h.id,previousHeroes[h.id]?cloneHero(previousHeroes[h.id]):initialSeasonStats(h,rng,v.statMode==='random'?'random':'fixed')]));
  v.seasonBaseStats=Object.fromEntries(CATALOG.map(h=>[h.id,v.seasonBaseStats?.[h.id]??{...v.seasonHeroes[h.id].stats}]));
  v.playerDecks=decks;
  v.seenMarketIds={a:v.markets.a.map((h:Hero)=>h.id),b:v.markets.b.map((h:Hero)=>h.id)};
  v.version=5;
  v.tradeOffers=[];
  v.nextTradeId=1;
  for(const hero of [...v.teamA.heroes,...v.teamB.heroes]) {
    if(hero.purchasePrice===undefined)hero.purchasePrice=hero.price;
  }
  const result=v as GameState;
  fillMarkets(result,rng);
  result.rngState=rng.getState();
  return migrateSavedState(result,now);
}
export function classDescription(heroClass:HeroClass):string {
  const wins=CLASSES.filter(c=>classAdvantage(heroClass,c)===1);
  return `Fuerte contra ${wins.length?wins.join(', '):'ninguna clase'}.`;
}
