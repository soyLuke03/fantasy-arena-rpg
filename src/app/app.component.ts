import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CATALOG } from './game/catalog';
import {
  batchTest, buyHero, canModify, chooseBlessing, classAdvantage, expireSeason, migrateSavedState, marketRefreshCost,
  heroUpgradeCost, isValidState, newGame, nextDay,
  refreshMarket, sellHero, simulateMatch, requestPurchase, respondToPurchase, cancelPurchase, minimumOffer,
  STORAGE_KEY, upgradeHero, upgradeQuality, qualityUpgradeCost, upgradePreview, placeMythicBid, resolveMythicAuction, forceMythicAuction,
  WIN_GOLD, LOSS_GOLD, KILL_GOLD, SAVE_GOLD, globalMarketCapacity, marketFor, visibleMarketCount, LOCAL_PLAYERS, personalMarketSlots, personalDeck, personalDeckRemaining
} from './game/engine';
import { BLESSINGS, BlessingKey, CLASSES, CLASS_ICONS, GameState, Hero, HeroClass, Mode, SeasonDuration, Side, StatMode, Tier } from './game/models';

type Tab = 'arena'|'market'|'roster'|'trades'|'auction'|'reports'|'lab';
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
  settingsMode: Mode = 'bot';
  showSettings = false;
  tradeHeroId = '';
  tradeAmount = 0;
  batchMessage = '';
  auctionBid = 120;
  readonly rewards = {winner:WIN_GOLD,loser:LOSS_GOLD,kill:KILL_GOLD,save:SAVE_GOLD};
  readonly classes = CLASSES;
  readonly allBlessings = BLESSINGS;
  readonly catalogSize = CATALOG.length;

  readonly icons = CLASS_ICONS;
  readonly globalSlots = globalMarketCapacity(LOCAL_PLAYERS);
  get privateOffers():Hero[] { return marketFor(this.state, this.selectedSide); }
  get publicOfferCount():number { return visibleMarketCount(this.state); }
  get privateSlots():number { return personalMarketSlots(this.selectedSide); }
  get deckSize():number { return personalDeck(this.state,this.selectedSide).length; }
  get deckRemaining():number { return personalDeckRemaining(this.state,this.selectedSide); }
  get seenOffers():number { return this.state.seenMarketIds[this.selectedSide].length; }
  readonly statFields = [
    {key:'health',label:'Vida',icon:'♥'},
    {key:'attack',label:'Ataque',icon:'⚔'},
    {key:'defense',label:'Defensa',icon:'⬡'},
    {key:'speed',label:'Velocidad',icon:'➶'}
  ] as const;

  ngOnInit(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        const restored = migrateSavedState(saved);
        if (restored) {
          this.state = restored;
          if ([1,2,3,4,5].includes((saved as {version?: number})?.version ?? 0)) {
            // Una copia del guardado original antes de actualizar formato.
            if (!localStorage.getItem(STORAGE_KEY + '-backup-v' + (saved as {version:number}).version)) localStorage.setItem(STORAGE_KEY + '-backup-v' + (saved as {version:number}).version,raw);
            this.notice='Guardado migrado a v0.6.0: el catálogo JSON y las nuevas reglas están disponibles.';
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
  ngOnDestroy(): void { if(this.clock) clearInterval(this.clock); }
  private checkSeasonDeadline(): void {
    this.now=Date.now();
    const result=expireSeason(this.state,this.now);
    if(result) {
      this.notice=result;
      this.tab='arena';this.selectedSide='a';this.selectedBout=0;
      this.save();
    }
  }
  get remainingTime():string {
    const ms=Math.max(0,this.state.seasonEndsAt-this.now);
    const d=Math.floor(ms/86_400_000);
    const h=Math.floor(ms%86_400_000/3_600_000);
    const m=Math.floor(ms%3_600_000/60_000);
    return d?`${d}d ${h}h`:`${h}h ${m}min`;
  }
  get shopRefreshCost():number { return marketRefreshCost(this.state,this.selectedSide); }
  get blessingLocked():boolean {return this.state.history.length>0;}
  get freeSlots(): number[] { return Array.from({length:Math.max(0,5-this.state.teamA.heroes.length)},(_,i)=>i); }
  get currentTeam() { return this.selectedSide === 'a' ? this.state.teamA : this.state.teamB; }
  get enemyTeam() { return this.selectedSide === 'a' ? this.state.teamB : this.state.teamA; }
  get canEdit() { return canModify(this.state,this.selectedSide); }
  get ready() { return !this.state.result && !!this.state.teamA.blessing && !!this.state.teamB.blessing && this.state.teamA.heroes.length>=3 && this.state.teamB.heroes.length>=3; }
  get played() { return this.state.history.length; }
  get winnerName() { return this.state.result?.winner === 'a' ? 'TU EQUIPO' : 'EQUIPO RIVAL'; }
  get teamAHealth() { return this.state.teamA.heroes.reduce((total,h)=>total+h.stats.health,0); }
  get teamBHealth() { return this.state.teamB.heroes.reduce((total,h)=>total+h.stats.health,0); }

  changeTab(tab:Tab):void {if(tab==='trades'&&this.state.mode==='bot')this.selectedSide='a';this.tab=tab;this.batchMessage='';}
  chooseSide(side:Side):void {this.selectedSide=side;}
  heroIcon(className:HeroClass):string {return this.icons[className];}
  heroClass(className:HeroClass):string {return 'hero-'+CLASSES.indexOf(className);}
  tierClass(tier:Tier):string {return tier==='Común'?'tier-common':tier==='Raro'?'tier-rare':tier==='Épico'?'tier-epic':tier==='Mítico'?'tier-mythic':'tier-legend';}
  advantage(a:HeroClass,b:HeroClass):number {return classAdvantage(a,b);}
  advantageLabel(a:HeroClass,b:HeroClass):string {
    const val=classAdvantage(a,b);
    return val>0?'Ventaja':val<0?'Desventaja':'Igualado';
  }
  upgradeCost(hero:Hero):number{return heroUpgradeCost(hero);}
  qualityCost(hero:Hero):number{return qualityUpgradeCost(hero);}
  isQualityMax(hero:Hero):boolean {return !Number.isFinite(this.qualityCost(hero));}
  upgradeStats(hero:Hero,kind:'level'|'quality') {return upgradePreview(hero,kind);}
  get auction() {return this.state.mythicalAuction;}
  get auctionHero() {return this.auction?this.state.seasonHeroes[this.auction.heroId]:null;}
  get auctionTopBid() {return this.auction?Math.max(this.auction.bids.a,this.auction.bids.b):0;}
  get auctionBidValid() {return this.auctionBid>=Math.max(this.auction?.minimum??0,this.auctionTopBid+1)&&this.auctionBid<=this.currentTeam.gold&&this.currentTeam.heroes.length<5;}
  sellValue(hero:Hero):number{return Math.floor(hero.price*.7)+hero.level*6;}
  minTradePrice(hero:Hero):number {return minimumOffer(hero);}
  performanceTotals(side:Side) {
    return (this.state.result?.changes??[]).filter(c=>c.side===side).reduce((sum,c)=>({
      kills:sum.kills+c.kills,deaths:sum.deaths+c.deaths,saves:sum.saves+c.saves
    }),{kills:0,deaths:0,saves:0});
  }
  get targetHero():Hero|undefined {return this.enemyTeam.heroes.find(h=>h.id===this.tradeHeroId);}
  get tradeOffersNewest() {return [...this.state.tradeOffers].reverse();}
  get activeTrades() {return this.state.tradeOffers.filter(t=>t.status==='pending').length;}
  statusLabel(status:import('./game/models').TradeStatus):string {
    return ({pending:'Pendiente',accepted:'Aceptada',rejected:'Rechazada',cancelled:'Cancelada',expired:'Caducada'})[status];
  }
  chooseTradeTarget(id:string):void {
    this.tradeHeroId=id;
    const hero=this.targetHero;
    this.tradeAmount=hero?minimumOffer(hero):0;
  }
  submitTrade():void {
    this.checkSeasonDeadline();
    if(!this.targetHero)return;
    const id=this.targetHero.id;
    this.action(requestPurchase(this.state,this.selectedSide,id,Number(this.tradeAmount)));
    // Permite hacer otra propuesta después, sin limpiar la selección.
  }
  replyTrade(id:string,accept:boolean):void {
    this.checkSeasonDeadline();
    this.action(respondToPurchase(this.state,id,this.selectedSide,accept));
  }
  cancelTrade(id:string):void {
    this.checkSeasonDeadline();
    this.action(cancelPurchase(this.state,id,this.selectedSide));
  }
  isOwned(id:string):boolean {return [...this.state.teamA.heroes,...this.state.teamB.heroes].some(h=>h.id===id);}

  /** Texto del registro dividido en nombres con color de equipo, sin HTML inyectado. */
  logParts(line:string, changes:import('./game/models').HeroChange[]):{text:string;side:Side|null}[] {
    const heroes=changes.map(c=>({name:c.name,side:this.changeSide(c)}))
      .filter(c=>c.name).sort((a,b)=>b.name.length-a.name.length);
    if (!heroes.length) return [{text:line,side:null}];
    const escaped=heroes.map(c=>c.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    // Regex construida solo con nombres del catálogo (nunca contenido arbitrario HTML).
    const pattern=new RegExp('('+escaped.join('|')+')','g');
    const pieces:{text:string;side:Side|null}[]=[];
    let pos=0; let hit:RegExpExecArray|null;
    while((hit=pattern.exec(line))!==null) {
      if(hit.index>pos)pieces.push({text:line.slice(pos,hit.index),side:null});
      const owner=heroes.find(h=>h.name===hit![0]);
      pieces.push({text:hit[0],side:owner?.side??null});
      pos=hit.index+hit[0].length;
    }
    if(pos<line.length)pieces.push({text:line.slice(pos),side:null});
    return pieces.length?pieces:[{text:line,side:null}];
  }
  changeSide(change:import('./game/models').HeroChange):Side {
    if(change.side==='a'||change.side==='b')return change.side;
    return this.state.teamB.heroes.some(h=>h.id===change.id)?'b':'a';
  }
  reportChanges(side:Side):import('./game/models').HeroChange[] {
    return (this.state.result?.changes??[]).filter(c=>this.changeSide(c)===side);
  }
  displayDelta(amount:number):string { return amount>0?'+'+amount:''+amount; }
  deltaTone(amount:number):string {return amount>0?'positive-delta':amount<0?'negative-delta':'neutral-delta';}
  getStats(change:import('./game/models').HeroChange,when:'before'|'after',key:keyof import('./game/models').Stats):number|null {
    return change[when]?.[key]??null;
  }
  lastDayDiff(heroId:string,key:keyof import('./game/models').Stats):number {
    const last=this.state.history[this.state.history.length-1];
    return last?.changes?.find(c=>c.id===heroId)?.[key]??0;
  }
  seasonDiff(hero:Hero,key:keyof import('./game/models').Stats):number {
    const base=this.state.seasonBaseStats?.[hero.id];
    return base?hero.stats[key]-base[key]:0;
  }
  hasPreviousDay():boolean {return this.state.history.length>0;}

  private save():void {
    try {localStorage.setItem(STORAGE_KEY,JSON.stringify(this.state));}catch { /* Funciona sin persistencia cuando está bloqueada. */ }
    this.state={...this.state};
  }
  private action(message:string):void {this.notice=message;this.save();}
  buy(id:string):void {this.checkSeasonDeadline();this.action(buyHero(this.state,this.selectedSide,id));}
  sell(id:string):void {this.checkSeasonDeadline();this.action(sellHero(this.state,this.selectedSide,id));}
  upgrade(id:string):void {this.checkSeasonDeadline();this.action(upgradeHero(this.state,this.selectedSide,id));}
  raiseQuality(id:string):void {this.checkSeasonDeadline();this.action(upgradeQuality(this.state,this.selectedSide,id));}
  bidMythic():void {this.checkSeasonDeadline();this.action(placeMythicBid(this.state,this.selectedSide,Math.floor(Number(this.auctionBid))));}
  settleMythic():void {this.checkSeasonDeadline();this.action(resolveMythicAuction(this.state));}
  debugMythic():void {this.checkSeasonDeadline();this.action(forceMythicAuction(this.state));}
  blessing(side:Side,key:BlessingKey):void {this.checkSeasonDeadline();this.action(chooseBlessing(this.state,side,key));}
  refresh():void {this.checkSeasonDeadline();this.action(refreshMarket(this.state,this.selectedSide));}

  fight():void {
    this.checkSeasonDeadline();
    try {
      const r=simulateMatch(this.state);
      this.notice=`${r.summary} Marcador: ${r.scoreA} - ${r.scoreB}.`;
      this.selectedBout=0;
      this.tab='reports';
      this.save();
    } catch(e) {this.notice=e instanceof Error?e.message:'Error durante el combate.';}
  }
  advance():void {this.checkSeasonDeadline();this.action(nextDay(this.state));this.tab='arena';this.selectedSide='a';this.selectedBout=0;this.batchMessage='';}
  inspectBout(index:number):void {this.selectedBout=index;}
  runBatch():void {
    try {
      const report=batchTest(this.state,100);
      this.batchMessage=`100 simulaciones · Tu equipo: ${report.a} victorias (${report.percentageA} %) · Rival: ${report.b}. No altera la jornada.`;
    } catch(e) {this.batchMessage=e instanceof Error?e.message:'No se pudo simular.';}
  }
  startGame():void {
    if (!window.confirm('Esto reemplaza la partida local actual y reinicia la temporada. ¿Continuar? Exporta el JSON antes si quieres conservarla.')) return;
    const cleanSeed=(this.settingsSeed.trim()||'ARENA-01').slice(0,60);
    this.state=newGame(cleanSeed,this.settingsMode,this.settingsDays,this.settingsStatMode);
    this.now=Date.now();
    this.selectedSide='a';this.tab='arena';this.selectedBout=0;this.tradeHeroId='';this.tradeAmount=0;this.showSettings=false;this.batchMessage='';
    this.action('Nueva partida local iniciada. ¡Que empiece el draft!');
  }
  exportSave():void {
    const content=JSON.stringify({exportedAt:new Date().toISOString(),game:this.state},null,2);
    const blob=new Blob([content],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`fantasy-arena-temporada-${this.state.season}.json`;a.click();
    URL.revokeObjectURL(url);
    this.notice='Partida exportada en formato JSON.';
  }
}
