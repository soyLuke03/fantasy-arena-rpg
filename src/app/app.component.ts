import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CATALOG } from './game/catalog';
import {
  beginNextSeason, setTacticalOrder, swapFormationSlots, positionOf, batchTest, buyHero, canModify, chooseBlessing, classAdvantage, expireSeason, migrateSavedState, marketRefreshCost,
  heroUpgradeCost, isValidState, newGame, nextDay, playNextBout, chooseDailyBlessing, toggleActive, rotateHero, deathCount, canRotate, isActive, MAX_OWNED_HEROES,
  refreshMarket, sellHero, requestPurchase, respondToPurchase, cancelPurchase, minimumOffer,
  STORAGE_KEY, upgradeHero, upgradeQuality, qualityUpgradeCost, upgradePreview, placeMythicBid, resolveMythicAuction, forceMythicAuction,
  WIN_GOLD, LOSS_GOLD, KILL_GOLD, SAVE_GOLD, globalMarketCapacity, marketFor, visibleMarketCount, LOCAL_PLAYERS, personalMarketSlots, personalDeck, personalDeckRemaining
} from './game/engine';
import { BLESSINGS, BlessingKey, CLASSES, CLASS_ICONS, GameState, Hero, HeroClass, Bout, FighterFrame, Mode, SeasonDuration, Side, StatMode, Tier, TacticalOrder } from './game/models';

type Tab = 'arena' | 'market' | 'roster' | 'trades' | 'auction' | 'reports' | 'lab';
@Component({
  selector: 'fa-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  state: GameState = newGame('ARENA-01');
  tab: Tab = 'arena';
  selectedSide: Side = 'a';
  selectedBout = 0;
  notice = 'Laboratorio listo. Prepara tu equipo y elige una bendición.';
  settingsSeed = 'ARENA-01';
  settingsDays: SeasonDuration = 7;
  settingsStatMode: StatMode = 'fixed';
  now = Date.now();
  private clock: ReturnType<typeof setInterval> | null = null;
  /** Reloj exclusivo de la REPRODUCCIÓN. La lógica de batalla ya ha sido resuelta. */
  private playbackClock: ReturnType<typeof setInterval> | null = null;
  /** null: sin animación. El índice 0 representa el estado inicial (antes del turno 1). */
  playback: { bout: Bout; index: number; playing: boolean } | null = null;
  playbackSpeed: 1 | 2 | 4 = 1;
  settingsMode: Mode = 'bot';
  showSettings = false;
  tradeHeroId = '';
  tradeAmount = 0;
  batchMessage = '';
  swapOut: Record<Side, string> = { a: '', b: '' };
  swapIn: Record<Side, string> = { a: '', b: '' };
  /** Posiciones seleccionadas en el editor táctico para intercambiarlas. */
  slotFrom: Record<Side, number> = { a: 0, b: 0 };
  slotTo: Record<Side, number> = { a: 1, b: 1 };
  readonly tacticalOrders: { value: TacticalOrder; label: string; description: string }[] = [
    { value: 'aggressive', label: 'Agresiva', description: '+12 % al causar y recibir daño. Busca rematar enemigos.' },
    { value: 'balanced', label: 'Equilibrada', description: 'Comportamiento normal de la clase.' },
    { value: 'defensive', label: 'Defensiva', description: '−15 % de daño causado y recibido. Protege y cura con mayor frecuencia.' }
  ];
  auctionBid = 120;
  readonly rewards = { winner: WIN_GOLD, loser: LOSS_GOLD, kill: KILL_GOLD, save: SAVE_GOLD };
  readonly classes = CLASSES;
  readonly sides: Side[] = ['a', 'b'];
  readonly allBlessings = BLESSINGS;
  readonly catalogSize = CATALOG.length;

  readonly icons = CLASS_ICONS;
  readonly globalSlots = globalMarketCapacity(LOCAL_PLAYERS);
  get privateOffers(): Hero[] { return marketFor(this.state, this.selectedSide); }
  get publicOfferCount(): number { return visibleMarketCount(this.state); }
  get privateSlots(): number { return personalMarketSlots(this.selectedSide); }
  get deckSize(): number { return personalDeck(this.state, this.selectedSide).length; }
  get deckRemaining(): number { return personalDeckRemaining(this.state, this.selectedSide); }
  get seenOffers(): number { return this.state.seenMarketIds[this.selectedSide].length; }
  readonly statFields = [
    { key: 'health', label: 'Vida', icon: '♥' },
    { key: 'attack', label: 'Ataque', icon: '⚔' },
    { key: 'defense', label: 'Defensa', icon: '⬡' },
    { key: 'speed', label: 'Velocidad', icon: '➶' }
  ] as const;

  /** Carga el guardado anterior, migra si es necesario y arranca el reloj local. */
  ngOnInit(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        const restored = migrateSavedState(saved);
        if (restored) {
          this.state = restored;
          if ([1, 2, 3, 4, 5, 6, 7, 8].includes((saved as { version?: number })?.version ?? 0)) {
            // Una copia del guardado original antes de actualizar formato.
            if (!localStorage.getItem(STORAGE_KEY + '-backup-v' + (saved as { version: number }).version)) localStorage.setItem(STORAGE_KEY + '-backup-v' + (saved as { version: number }).version, raw);
            this.notice = 'Guardado migrado a v0.9.0. Exporta una copia antes de seguir probando.';
          }
        }
      }
    } catch { /* Navegador sin almacenamiento disponible. */ }
    this.checkSeasonDeadline();
    this.settingsSeed = this.state.seed;
    this.settingsDays = this.state.durationDays;
    this.settingsMode = this.state.mode;
    this.settingsStatMode = this.state.statMode;
    if (this.state.result) this.tab = 'reports';
    this.clock = setInterval(() => this.checkSeasonDeadline(), 30_000);
  }
  ngOnDestroy(): void {
    if (this.clock) clearInterval(this.clock);
    this.stopPlaybackClock();
  }
  private checkSeasonDeadline(): void {
    this.now = Date.now();
    const result = expireSeason(this.state, this.now);
    if (result) {
      this.notice = result;
      this.tab = 'arena'; this.selectedSide = 'a'; this.selectedBout = 0;
      this.save();
    }
  }
  get emergencyResetLabel(): string { return (this.state.result?.emergencyResetSides ?? []).map(side => side === 'a' ? 'Equipo A' : 'Equipo B').join(' y '); }
  get emergencyResetPlural(): boolean { return (this.state.result?.emergencyResetSides?.length ?? 0) > 1; }
  get remainingTime(): string {
    const ms = Math.max(0, this.state.seasonEndsAt - this.now);
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor(ms % 86_400_000 / 3_600_000);
    const m = Math.floor(ms % 3_600_000 / 60_000);
    return d ? `${d}d ${h}h` : `${h}h ${m}min`;
  }
  get shopRefreshCost(): number { return marketRefreshCost(this.state, this.selectedSide); }
  blessingIsLocked(side: Side): boolean { const team = side === 'a' ? this.state.teamA : this.state.teamB; return !canModify(this.state, side) || (this.state.history.length > 0 && team.blessing !== null); }
  canSellHero(hero: Hero): boolean { return this.canEdit && this.currentTeam.heroes.length > 3 && !this.heroActive(hero.id) && hero.tier !== 'Mítico'; }
  /** La clasificación permanece en pantalla al terminar: NO se inicia otra temporada sola. */
  get seasonFinished(): boolean { return this.state.seasonComplete; }
  get seasonWinner(): string { return this.state.scoreA === this.state.scoreB ? 'Empate' : this.state.scoreA > this.state.scoreB ? 'Equipo A' : 'Equipo B'; }
  get endStats(): { hero: string; kills: number; saves: number } {
    const records = new Map<string, { hero: string; kills: number; saves: number }>();
    for (const battle of this.state.history) for (const change of battle.changes) {
      const prior = records.get(change.id) ?? { hero: change.name, kills: 0, saves: 0 };
      prior.kills += change.kills; prior.saves += change.saves; records.set(change.id, prior);
    }
    return [...records.values()].sort((a, b) => b.kills * 2 + b.saves - a.kills * 2 - a.saves)[0] ?? { hero: 'Sin datos', kills: 0, saves: 0 };
  }
  get boutsDone(): number { return this.state.currentBouts.length; }
  get boutsLeft(): number { return 5 - this.boutsDone; }
  get partialScoreA(): number { return this.state.currentBouts.filter(b => b.winner === 'a').length; }
  get remainingDays(): number { return Math.max(0, this.state.durationDays - this.state.day + (this.state.result ? 0 : 1)); }
  get canRotateCurrent(): boolean { return canRotate(this.state, this.selectedSide); }
  heroActive(id: string): boolean { return isActive(this.state, this.selectedSide, id); }
  heroDeaths(side: Side, id: string): number { return deathCount(this.state, side, id); }
  /** La alineación se renderiza según el ORDEN de casillas (no el catálogo). */
  starters(side: Side): Hero[] { const team = side === 'a' ? this.state.teamA : this.state.teamB; return team.activeIds.map(id => team.heroes.find(h => h.id === id)).filter((h): h is Hero => !!h); }
  get positions(): number[] { return [0, 1, 2, 3, 4]; }
  lineOf(side: Side, id: string): string {
    const team = side === 'a' ? this.state.teamA : this.state.teamB;
    const line = positionOf(team, id);
    return line === 'front' ? 'Delantera' : line === 'back' ? 'Retaguardia' : 'Almacén';
  }
  tacticOf(side: Side, id: string): TacticalOrder { return (side === 'a' ? this.state.teamA : this.state.teamB).tactics?.[id] ?? 'balanced'; }
  updateTactic(side: Side, id: string, order: TacticalOrder): void { this.action(setTacticalOrder(this.state, side, id, order)); }
  swapPositions(side: Side): void { this.action(swapFormationSlots(this.state, side, Number(this.slotFrom[side]), Number(this.slotTo[side]))); }

  bench(side: Side): Hero[] { const team = side === 'a' ? this.state.teamA : this.state.teamB; return team.heroes.filter(h => !team.activeIds.includes(h.id)); }
  rotate(side: Side): void { this.action(rotateHero(this.state, side, this.swapOut[side], this.swapIn[side])); this.swapOut[side] = ''; this.swapIn[side] = ''; }
  setActive(id: string): void { this.action(toggleActive(this.state, this.selectedSide, id)); }
  dayBlessing(side: Side, key: BlessingKey): void { this.action(chooseDailyBlessing(this.state, side, key)); }
  get freeSlots(): number[] { return Array.from({ length: Math.max(0, 5 - this.state.teamA.activeIds.length) }, (_, i) => i); }
  get currentTeam() { return this.selectedSide === 'a' ? this.state.teamA : this.state.teamB; }
  get enemyTeam() { return this.selectedSide === 'a' ? this.state.teamB : this.state.teamA; }
  get canEdit() { return canModify(this.state, this.selectedSide); }
  get ready() { return !this.state.result && !!this.state.teamA.blessing && !!this.state.teamB.blessing && !!this.state.teamA.dailyBlessing && !!this.state.teamB.dailyBlessing && this.state.teamA.activeIds.length >= 3 && this.state.teamB.activeIds.length >= 3; }
  get played() { return this.state.history.length; }
  get winnerName() { return this.state.result?.winner === 'a' ? 'TU EQUIPO' : 'EQUIPO RIVAL'; }
  get teamAHealth() { return this.starters('a').reduce((total, h) => total + h.stats.health, 0); }
  get teamBHealth() { return this.starters('b').reduce((total, h) => total + h.stats.health, 0); }

  changeTab(tab: Tab): void { if (tab === 'trades' && this.state.mode === 'bot') this.selectedSide = 'a'; this.tab = tab; this.batchMessage = ''; }
  chooseSide(side: Side): void { this.selectedSide = side; }
  heroIcon(className: HeroClass): string { return this.icons[className]; }
  heroClass(className: HeroClass): string { return 'hero-' + CLASSES.indexOf(className); }
  tierClass(tier: Tier): string { return tier === 'Común' ? 'tier-common' : tier === 'Raro' ? 'tier-rare' : tier === 'Épico' ? 'tier-epic' : tier === 'Mítico' ? 'tier-mythic' : 'tier-legend'; }
  advantage(a: HeroClass, b: HeroClass): number { return classAdvantage(a, b); }
  advantageLabel(a: HeroClass, b: HeroClass): string {
    const val = classAdvantage(a, b);
    return val > 0 ? 'Ventaja' : val < 0 ? 'Desventaja' : 'Igualado';
  }
  upgradeCost(hero: Hero): number { return heroUpgradeCost(hero); }
  qualityCost(hero: Hero): number { return qualityUpgradeCost(hero); }
  isQualityMax(hero: Hero): boolean { return !Number.isFinite(this.qualityCost(hero)); }
  upgradeStats(hero: Hero, kind: 'level' | 'quality') { return upgradePreview(hero, kind); }
  get auction() { return this.state.mythicalAuction; }
  get auctionHero() { return this.auction ? this.state.seasonHeroes[this.auction.heroId] : null; }
  get auctionTopBid() { return this.auction ? Math.max(this.auction.bids.a, this.auction.bids.b) : 0; }
  get auctionBidValid() { return this.auctionBid >= Math.max(this.auction?.minimum ?? 0, this.auctionTopBid + 1) && this.auctionBid <= this.currentTeam.gold && this.currentTeam.heroes.length < MAX_OWNED_HEROES; }
  /** Razones visibles junto a botones inhabilitados. No depender del hover de un botón disabled. */
  refreshReason(): string {
    if (!this.canEdit) return this.boutsDone ? 'La tienda se cierra durante las cinco batallas.' : 'La jornada está cerrada o este equipo lo controla la IA.';
    if (this.currentTeam.gold < this.shopRefreshCost) return `Necesitas ${this.shopRefreshCost} de oro; tienes ${this.currentTeam.gold}.`;
    return '';
  }
  buyReason(hero: Hero): string {
    if (!this.canEdit) return 'Solo puedes comprar antes de la primera batalla y en tu propia tienda.';
    if (this.currentTeam.heroes.length >= MAX_OWNED_HEROES) return 'Almacén completo (25 campeones).';
    if (this.currentTeam.gold < hero.price) return `Te faltan ${hero.price - this.currentTeam.gold} monedas de oro.`;
    return '';
  }
  sellReason(hero: Hero): string {
    if (!this.canEdit) return 'No puedes vender con la jornada en curso o cerrada.';
    if (this.currentTeam.heroes.length <= 3) return 'Debes conservar un mínimo de tres campeones.';
    if (this.heroActive(hero.id)) return 'Desequipa al campeón y envíalo al almacén.';
    if (hero.tier === 'Mítico') return 'Los Míticos no se venden.';
    return '';
  }
  tierReason(hero: Hero): string {
    if (!this.canEdit) return 'Las mejoras se hacen antes de la primera batalla.';
    if (hero.tier === 'Mítico') return 'Un Mítico tiene estadísticas fijas y no admite mejoras.';
    if (hero.level >= hero.maxLevel) return 'Ha alcanzado su tier máximo.';
    if (this.currentTeam.gold < this.upgradeCost(hero)) return `Necesitas ${this.upgradeCost(hero)} de oro.`;
    return '';
  }
  qualityReason(hero: Hero): string {
    if (!this.canEdit) return 'Las mejoras se hacen antes de la primera batalla.';
    if (hero.tier === 'Mítico') return 'Los campeones Míticos no evolucionan.';
    if (this.isQualityMax(hero)) return 'Calidad máxima alcanzada.';
    if (this.currentTeam.gold < this.qualityCost(hero)) return `Necesitas ${this.qualityCost(hero)} de oro.`;
    return '';
  }
  alignReason(hero: Hero): string {
    if (!this.canRotateCurrent) return 'La jornada ya está finalizada.';
    if (this.heroActive(hero.id) && this.currentTeam.activeIds.length <= 3) return 'Debes mantener al menos tres titulares.';
    if (!this.heroActive(hero.id) && this.currentTeam.activeIds.length >= 5) return 'Cinco plazas ocupadas. Retira antes a un titular.';
    if (!this.heroActive(hero.id) && this.heroDeaths(this.selectedSide, hero.id) >= 3) return 'El campeón acumula tres muertes y no puede volver a alinearse.';
    return '';
  }
  fightReason(): string {
    if (this.state.result) return 'Este enfrentamiento ya terminó.';
    if (this.state.teamA.activeIds.length < 3 || this.state.teamB.activeIds.length < 3) return 'Ambos equipos necesitan al menos tres titulares.';
    if (!this.state.teamA.blessing || !this.state.teamB.blessing) return 'Falta elegir una bendición de temporada.';
    if (!this.state.teamA.dailyBlessing || !this.state.teamB.dailyBlessing) return 'Falta elegir la bendición de jornada de cada equipo.';
    return '';
  }
  tradeReason(): string {
    if (!this.canEdit) return 'Solo puedes enviar ofertas antes de comenzar las batallas.';
    if (this.currentTeam.heroes.length >= MAX_OWNED_HEROES) return 'El almacén está lleno.';
    if (this.enemyTeam.heroes.length <= 3) return 'El equipo vendedor debe conservar tres campeones.';
    if (!this.targetHero) return 'Selecciona primero un campeón rival.';
    if (this.tradeAmount < this.minTradePrice(this.targetHero)) return `La oferta mínima es ${this.minTradePrice(this.targetHero)} oro.`;
    if (this.tradeAmount > this.currentTeam.gold) return `Tienes ${this.currentTeam.gold} oro, insuficiente para esta oferta.`;
    return '';
  }
  bidReason(): string {
    if (!this.canEdit) return 'Solo puedes pujar antes de la primera batalla de la jornada.';
    if (!this.auction || this.auction.status !== 'open') return 'Ahora no hay subasta abierta.';
    if (this.currentTeam.heroes.length >= MAX_OWNED_HEROES) return 'Tu almacén está lleno.';
    if (this.auctionBid <= this.auctionTopBid || this.auctionBid < this.auction.minimum) return `Debes superar ${Math.max(this.auctionTopBid, this.auction.minimum - 1)} monedas.`;
    if (this.auctionBid > this.currentTeam.gold) return `Necesitas ${this.auctionBid - this.currentTeam.gold} oro adicional.`;
    return '';
  }
  /** Totaliza las muertes y su estado sin avanzar una batalla. */
  sellValue(hero: Hero): number { return Math.floor(hero.price * .7) + hero.level * 6; }
  minTradePrice(hero: Hero): number { return minimumOffer(hero); }
  performanceTotals(side: Side) {
    return (this.state.result?.changes ?? []).filter(c => c.side === side).reduce((sum, c) => ({
      kills: sum.kills + c.kills, deaths: sum.deaths + c.deaths, saves: sum.saves + c.saves
    }), { kills: 0, deaths: 0, saves: 0 });
  }
  get targetHero(): Hero | undefined { return this.enemyTeam.heroes.find(h => h.id === this.tradeHeroId); }
  get tradeOffersNewest() { return [...this.state.tradeOffers].reverse(); }
  get activeTrades() { return this.state.tradeOffers.filter(t => t.status === 'pending').length; }
  statusLabel(status: import('./game/models').TradeStatus): string {
    return ({ pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada', cancelled: 'Cancelada', expired: 'Caducada' })[status];
  }
  chooseTradeTarget(id: string): void {
    this.tradeHeroId = id;
    const hero = this.targetHero;
    this.tradeAmount = hero ? minimumOffer(hero) : 0;
  }
  submitTrade(): void {
    this.checkSeasonDeadline();
    if (!this.targetHero) return;
    const id = this.targetHero.id;
    this.action(requestPurchase(this.state, this.selectedSide, id, Number(this.tradeAmount)));
    // Permite hacer otra propuesta después, sin limpiar la selección.
  }
  replyTrade(id: string, accept: boolean): void {
    this.checkSeasonDeadline();
    this.action(respondToPurchase(this.state, id, this.selectedSide, accept));
  }
  cancelTrade(id: string): void {
    this.checkSeasonDeadline();
    this.action(cancelPurchase(this.state, id, this.selectedSide));
  }
  isOwned(id: string): boolean { return [...this.state.teamA.heroes, ...this.state.teamB.heroes].some(h => h.id === id); }

  /** La crónica seleccionada sirve tanto para la jornada actual como para los informes cerrados. */
  get selectedReportBout(): Bout | null {
    return (this.state.result?.bouts ?? this.state.currentBouts)[this.selectedBout] ?? null;
  }

  /** Empieza a mostrar los turnos calculados; no modifica oro, estadísticas ni RNG. */
  private startPlayback(bout: Bout): void {
    this.stopPlaybackClock();
    this.playback = { bout, index: 0, playing: true };
    this.startPlaybackClock();
  }
  /** El podio puede enseñar la batalla decisiva sin avanzar la temporada. */
  replayLastBout(): void {
    const last = this.state.result?.bouts?.at(-1) ?? this.state.currentBouts.at(-1);
    if (last?.timeline?.length) this.startPlayback(last);
    else this.notice = 'Este combate no tiene una secuencia visual disponible.';
  }
  /** Permite volver a VER una batalla anterior sin volver a SIMULARLA. */
  replaySelectedBout(): void {
    const bout = this.selectedReportBout;
    if (!bout?.timeline?.length) {
      this.notice = 'Esta batalla pertenece a un guardado antiguo y no tiene turnos para reproducir.';
      return;
    }
    this.startPlayback(bout);
  }
  private stopPlaybackClock(): void {
    if (this.playbackClock !== null) {
      clearInterval(this.playbackClock);
      this.playbackClock = null;
    }
  }
  private startPlaybackClock(): void {
    this.stopPlaybackClock();
    if (!this.playback?.playing) return;
    // Los tres ritmos incluyen un pequeño margen para leer las acciones.
    const delay = this.playbackSpeed === 1 ? 1250 : this.playbackSpeed === 2 ? 650 : 290;
    this.playbackClock = setInterval(() => this.advancePlayback(), delay);
  }
  advancePlayback(): void {
    if (!this.playback) return;
    const count = this.playback.bout.timeline?.length ?? 0;
    if (this.playback.index < count) this.playback.index++;
    if (this.playback.index >= count) {
      this.playback.playing = false;
      this.stopPlaybackClock();
    }
  }
  pausePlayback(): void {
    if (!this.playback) return;
    this.playback.playing = false;
    this.stopPlaybackClock();
  }
  resumePlayback(): void {
    if (!this.playback || this.playback.index >= this.playbackTotalTurns) return;
    this.playback.playing = true;
    this.startPlaybackClock();
  }
  setPlaybackSpeed(value: number | string): void {
    const num = Number(value);
    this.playbackSpeed = num === 2 || num === 4 ? num : 1;
    this.startPlaybackClock();
  }
  skipPlayback(): void {
    if (!this.playback) return;
    this.playback.index = this.playbackTotalTurns;
    this.pausePlayback();
  }
  closePlayback(): void {
    this.stopPlaybackClock();
    this.playback = null;
    // El último combate cierra la jornada, pero se muestra el resultado solo
    // después de terminar (o saltar) la animación.
    if (this.state.result) this.tab = 'reports';
  }
  get playbackTotalTurns(): number { return this.playback?.bout.timeline?.length ?? 0; }
  get playbackFinished(): boolean { return !!this.playback && this.playback.index >= this.playbackTotalTurns; }
  get playbackTurnNumber(): number { return this.playback?.index ?? 0; }
  get playbackEvents(): string[] {
    const p = this.playback;
    return p && p.index > 0 ? (p.bout.timeline?.[p.index - 1]?.events ?? []) : [];
  }
  get playbackFighters(): FighterFrame[] {
    const p = this.playback;
    if (!p) return [];
    return p.index > 0
      ? (p.bout.timeline?.[p.index - 1]?.fighters ?? [])
      : (p.bout.initialFighters ?? []);
  }
  playbackSideFighters(side: Side): FighterFrame[] {
    return this.playbackFighters.filter(f => f.side === side);
  }
  hpPercent(f: FighterFrame): number {
    return Math.max(0, Math.min(100, Math.round(100 * f.hp / Math.max(1, f.maxHp))));
  }

  /** Texto del registro dividido en nombres con color de equipo, sin HTML inyectado. */
  logParts(line: string, changes: import('./game/models').HeroChange[]): { text: string; side: Side | null }[] {
    const heroes = changes.map(c => ({ name: c.name, side: this.changeSide(c) }))
      .filter(c => c.name).sort((a, b) => b.name.length - a.name.length);
    if (!heroes.length) return [{ text: line, side: null }];
    const escaped = heroes.map(c => c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Regex construida solo con nombres del catálogo (nunca contenido arbitrario HTML).
    const pattern = new RegExp('(' + escaped.join('|') + ')', 'g');
    const pieces: { text: string; side: Side | null }[] = [];
    let pos = 0; let hit: RegExpExecArray | null;
    while ((hit = pattern.exec(line)) !== null) {
      if (hit.index > pos) pieces.push({ text: line.slice(pos, hit.index), side: null });
      const owner = heroes.find(h => h.name === hit![0]);
      pieces.push({ text: hit[0], side: owner?.side ?? null });
      pos = hit.index + hit[0].length;
    }
    if (pos < line.length) pieces.push({ text: line.slice(pos), side: null });
    return pieces.length ? pieces : [{ text: line, side: null }];
  }
  changeSide(change: import('./game/models').HeroChange): Side {
    if (change.side === 'a' || change.side === 'b') return change.side;
    return this.state.teamB.heroes.some(h => h.id === change.id) ? 'b' : 'a';
  }
  reportChanges(side: Side): import('./game/models').HeroChange[] {
    return (this.state.result?.changes ?? []).filter(c => this.changeSide(c) === side);
  }
  displayDelta(amount: number): string { return amount > 0 ? '+' + amount : '' + amount; }
  deltaTone(amount: number): string { return amount > 0 ? 'positive-delta' : amount < 0 ? 'negative-delta' : 'neutral-delta'; }
  getStats(change: import('./game/models').HeroChange, when: 'before' | 'after', key: keyof import('./game/models').Stats): number | null {
    return change[when]?.[key] ?? null;
  }
  lastDayDiff(heroId: string, key: keyof import('./game/models').Stats): number {
    const last = this.state.history[this.state.history.length - 1];
    return last?.changes?.find(c => c.id === heroId)?.[key] ?? 0;
  }
  seasonDiff(hero: Hero, key: keyof import('./game/models').Stats): number {
    const base = this.state.seasonBaseStats?.[hero.id];
    return base ? hero.stats[key] - base[key] : 0;
  }
  hasPreviousDay(): boolean { return this.state.history.length > 0; }

  /** Guarda el estado completo: cartas, alineaciones, tácticas y batallas parciales. */
  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* Funciona sin persistencia cuando está bloqueada. */ }
    this.state = { ...this.state };
  }
  private action(message: string): void { this.notice = message; this.save(); }
  buy(id: string): void { this.checkSeasonDeadline(); this.action(buyHero(this.state, this.selectedSide, id)); }
  sell(id: string): void { this.checkSeasonDeadline(); this.action(sellHero(this.state, this.selectedSide, id)); }
  upgrade(id: string): void { this.checkSeasonDeadline(); this.action(upgradeHero(this.state, this.selectedSide, id)); }
  raiseQuality(id: string): void { this.checkSeasonDeadline(); this.action(upgradeQuality(this.state, this.selectedSide, id)); }
  bidMythic(): void { this.checkSeasonDeadline(); this.action(placeMythicBid(this.state, this.selectedSide, Math.floor(Number(this.auctionBid)))); }
  settleMythic(): void { this.checkSeasonDeadline(); this.action(resolveMythicAuction(this.state)); }
  debugMythic(): void { this.checkSeasonDeadline(); this.action(forceMythicAuction(this.state)); }
  blessing(side: Side, key: BlessingKey): void { this.checkSeasonDeadline(); this.action(chooseBlessing(this.state, side, key)); }
  refresh(): void { this.checkSeasonDeadline(); this.action(refreshMarket(this.state, this.selectedSide)); }

  /** Una pulsación = UNA batalla; la quinta cierra y recompensa la jornada. */
  fight(): void {
    this.checkSeasonDeadline();
    try {
      const bout = playNextBout(this.state);
      const scoreA = this.state.currentBouts.filter(b => b.winner === 'a').length;
      const scoreB = this.boutsDone - scoreA;
      this.notice = this.state.result ? `${this.state.result.summary} Marcador: ${scoreA}-${scoreB}. Jornada completada.` : `Batalla ${bout.number}/5: vence ${bout.winner === 'a' ? 'Equipo A' : 'Equipo B'}. Marcador ${scoreA}-${scoreB}. Puedes cambiar campeones antes de la próxima.`;
      this.selectedBout = bout.number - 1;
      this.tab = 'arena';
      this.save();
      this.startPlayback(bout);
    } catch (e) { this.notice = e instanceof Error ? e.message : 'Error durante el combate.'; }
  }
  /** Cierra la jornada habitual, excepto la última, que se conserva para el podio. */
  advance(): void {
    if (this.seasonFinished) { this.tab = 'reports'; this.notice = 'Temporada finalizada: revisa la clasificación y comienza una nueva cuando quieras.'; return; }
    this.checkSeasonDeadline(); this.action(nextDay(this.state)); this.tab = 'arena'; this.selectedSide = 'a'; this.selectedBout = 0;
    this.batchMessage = ''; this.swapOut = { a: '', b: '' }; this.swapIn = { a: '', b: '' };
  }
  /** Requiere confirmación: archiva clasificación y reinicia progreso estacional. */
  beginSeason(): void {
    if (!this.seasonFinished) return;
    if (!window.confirm('Se archivará la clasificación y se reiniciarán campeones, oro y mejoras. ¿Comenzar una nueva temporada?')) return;
    this.action(beginNextSeason(this.state)); this.tab = 'arena'; this.selectedSide = 'a'; this.selectedBout = 0;
    this.swapOut = { a: '', b: '' }; this.swapIn = { a: '', b: '' };
  }
  inspectBout(index: number): void { this.selectedBout = index; }
  runBatch(): void {
    try {
      const report = batchTest(this.state, 100);
      this.batchMessage = `100 simulaciones · Tu equipo: ${report.a} victorias (${report.percentageA} %) · Rival: ${report.b}. No altera la jornada.`;
    } catch (e) { this.batchMessage = e instanceof Error ? e.message : 'No se pudo simular.'; }
  }
  /** Crea una partida NUEVA; no confundir con beginSeason() del podio. */
  startGame(): void {
    if (!window.confirm('Esto reemplaza la partida local actual y reinicia la temporada. ¿Continuar? Exporta el JSON antes si quieres conservarla.')) return;
    const cleanSeed = (this.settingsSeed.trim() || 'ARENA-01').slice(0, 60);
    this.stopPlaybackClock(); this.playback = null;
    this.state = newGame(cleanSeed, this.settingsMode, this.settingsDays, this.settingsStatMode);
    this.now = Date.now();
    this.selectedSide = 'a'; this.tab = 'arena'; this.selectedBout = 0; this.tradeHeroId = ''; this.tradeAmount = 0; this.showSettings = false; this.batchMessage = '';
    this.action('Nueva partida local iniciada. ¡Que empiece el draft!');
  }
  /** Exporta copia JSON manual de la partida para poder recuperar errores. */
  exportSave(): void {
    const content = JSON.stringify({ exportedAt: new Date().toISOString(), game: this.state }, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `fantasy-arena-temporada-${this.state.season}.json`; a.click();
    URL.revokeObjectURL(url);
    this.notice = 'Partida exportada en formato JSON.';
  }
}
