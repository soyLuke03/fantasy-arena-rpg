const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const compiled=path.join(__dirname,'.compiled');
fs.mkdirSync(compiled,{recursive:true});
const bin=path.join(root,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
execFileSync(fs.existsSync(bin)?bin:'tsc',[
  '--strict','--target','ES2022','--module','commonjs','--resolveJsonModule','--esModuleInterop',
  '--outDir',compiled,'src/app/game/models.ts','src/app/game/catalog.ts','src/app/game/engine.ts'
],{cwd:root,stdio:'inherit'});
const e=require('./.compiled/app/game/engine.js');
const {CATALOG,MYTHICS,NORMAL_CHAMPIONS}=require('./.compiled/app/game/catalog.js');
let checks=0;
const check=(v,msg)=>{assert.ok(v,msg);checks++};
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++};
const NOW=1761370000000;
function fresh(seed='LOCAL',mode='manual',duration=7,stat='random') {return e.newGame(seed,mode,duration,stat,NOW)}
function bless(s){for(const side of ['a','b'])e.chooseBlessing(s,side,s.blessingChoices[0])}
const tiers=['Común','Raro','Épico','Legendario','Mítico'];
eq(CATALOG.length,126,'126 campeones editados en JSON');eq(MYTHICS.length,6,'Seis míticos');eq(NORMAL_CHAMPIONS.length,120,'120 normales');
check(new Set(CATALOG.map(x=>x.id)).size===126,'Ids distintos');
for(const h of CATALOG){
  check(h.name.length>3,'Nombre legible');check(h.stats.health>0,'PV válidos');check(h.price>0,'Coste válido');
  check(tiers.indexOf(h.minTier)<=tiers.indexOf(h.maxTier),'Calidad coherente');
  for(const stat of ['health','attack','defense','speed'])check(h.caps[stat].min<=0&&h.caps[stat].max>=0,'Cap de crecimiento válido');
  if(h.tier==='Mítico'){eq(h.minTier,'Mítico');eq(h.maxTier,'Mítico');eq(h.maxLevel,0);check(!!h.ability,'Mítico con habilidad');}
}
for(const duration of e.SEASON_LENGTHS)eq(fresh('range','manual',duration).seasonEndsAt,NOW+duration*e.DAY_MS,'Duración real');
for(let seed=0;seed<200;seed++){
  const s=fresh('seed-'+seed);check(e.isValidState(s),'Estado inicial válido');
  eq(s.playerDecks.a.length,60,'Mazo A de 60');eq(s.playerDecks.b.length,60,'Mazo B de 60');
  check(s.playerDecks.a.every(id=>!s.playerDecks.b.includes(id)),'Exclusividad temporal');
  check([...s.playerDecks.a,...s.playerDecks.b].every(id=>!id.startsWith('myth-')),'Mítico fuera del mercado');
  eq(e.visibleMarketCount(s),13,'13 ofertas totales');
  eq(s.teamA.heroes.length,3,'Tres comunes iniciales');
  check(s.teamA.heroes.every(h=>h.tier==='Común'),'Draft común');
  check(s.teamB.heroes.every(h=>h.tier==='Común'),'Draft común bot/manual');
  for(const myth of MYTHICS)eq(s.seasonHeroes[myth.id].stats,myth.stats,'Míticos siempre iguales en temporada aleatoria');
}
// Mercado: contador sube, se reinicia por jornada, nunca presta cartas al rival.
{
 const s=fresh('shopcase');const before=s.markets.a.map(h=>h.id);eq(e.marketRefreshCost(s,'a'),2);
 let success=0;for(let i=0;i<4;i++){
   const fee=e.marketRefreshCost(s,'a');const msg=e.refreshMarket(s,'a');
   if(msg.startsWith('Tienda renovada')){success++;eq(e.marketRefreshCost(s,'a'),fee+1)}
   check(s.markets.a.every(h=>s.playerDecks.a.includes(h.id)),'Renovación no invade B');
 }
 check(success>=3,'Mercado puede renovarse varias veces');
 check(s.markets.a.some(h=>!before.includes(h.id)),'Aparecen nuevos campeones');
 bless(s);e.simulateMatch(s);e.nextDay(s,NOW+10);eq(e.marketRefreshCost(s,'a'),2,'Coste vuelve a 2');
}
// Mejora de nivel, vista previa exacta, mejora calidad y reinicio estacional.
{
 const s=fresh('upgrades','manual',7,'fixed');const h=s.teamA.heroes[0];
 s.teamA.gold=1000;const before={...h.stats};const prev=e.upgradePreview(h,'level');
 check(e.upgradeHero(s,'a',h.id).includes('nivel'),'Tier adquirido');
 for(const stat of ['health','attack','defense','speed'])eq(h.stats[stat]-before[stat],prev[stat],'Vista previa igual al resultado');
 const first=h.tier;const qualityPrev=e.upgradePreview(h,'quality');const b={...h.stats};
 check(e.upgradeQuality(s,'a',h.id).includes('asciende'),'Calidad mejorada');
 check(tiers.indexOf(h.tier)>tiers.indexOf(first),'Calidad aumenta');
 for(const stat of ['health','attack','defense','speed'])eq(h.stats[stat]-b[stat],qualityPrev[stat],'Preview calidad exacto');
 e.expireSeason(s,NOW+7*e.DAY_MS+1);
 eq(s.season,2,'Reinicio temporada');eq(s.seasonHeroes[h.id].tier,CATALOG.find(c=>c.id===h.id).tier,'Restituida calidad mínima');
 eq(s.seasonHeroes[h.id].level,0,'Restituido tier');
}
// Cinco rondas: fotos de las estadísticas idénticas durante rondas y resumen al final.
for(let seed=0;seed<70;seed++){
 const s=fresh('combat-'+seed);bless(s);
 const pre=new Map([...s.teamA.heroes,...s.teamB.heroes].map(h=>[h.id,{...h.stats}]));
 const ga=s.teamA.gold,gb=s.teamB.gold;const result=e.simulateMatch(s);
 eq(result.bouts.length,5,'Cinco combates');check(result.scoreA+result.scoreB===5,'Cinco decisiones');
 for(const bout of result.bouts)for(const c of bout.changes){
   eq(c.before,pre.get(c.id),'Sin cambios prematuros');eq(c.after,pre.get(c.id),'No hay evolución dentro de las cinco');
 }
 for(const change of result.changes){
   const final=(change.side==='a'?s.teamA:s.teamB).heroes.find(h=>h.id===change.id);
   eq(final.stats,change.after,'Resumen final corresponde a ficha');
   for(const stat of ['health','attack','defense','speed']){
     check(change[stat]>=final.caps[stat].min&&change[stat]<=final.caps[stat].max,'Cumple límites por jornada');
   }
   if(change.deaths===0)for(const stat of ['health','attack','defense','speed'])check(change[stat]>=0,'Nunca pierde stats si no muere');
 }
 const calcGold=(side)=> (result.winner===side?e.WIN_GOLD:e.LOSS_GOLD)+result.changes.filter(c=>c.side===side).reduce((n,c)=>n+c.kills*e.KILL_GOLD+c.saves*e.SAVE_GOLD,0);
 eq(result.goldA,calcGold('a'),'Recompensa A correcta');eq(result.goldB,calcGold('b'),'Recompensa B correcta');
 eq(s.teamA.gold,ga+result.goldA,'Ingreso oro A');eq(s.teamB.gold,gb+result.goldB,'Ingreso oro B');
 e.nextDay(s,NOW+12345);check(s.teamA.heroes.every(h=>pre.has(h.id)),'Plantilla persiste');
}
// Habilidades y Míticos: ni una sola variación persistente.
{
 const s=fresh('myth-fixture','manual');
 if(!s.mythicalAuction)check(e.forceMythicAuction(s).includes('abierta'),'Forzar subasta local');
 const auction=s.mythicalAuction;check(!!auction,'Subasta creada');check(auction.heroId.startsWith('myth-'));
 const amount=auction.minimum;s.teamA.gold=1000;
 check(e.placeMythicBid(s,'a',amount).includes('puja'),'Puja válida');
 check(e.placeMythicBid(s,'b',amount).includes('superar'),'No se iguala mejor oferta');
 check(e.resolveMythicAuction(s).includes('gana'),'Adjudica a mejor oferta');
 const hero=s.teamA.heroes.find(h=>h.id===auction.heroId);check(!!hero,'Mítico entra al equipo');
 eq(hero.stats,MYTHICS.find(h=>h.id===hero.id).stats,'Estadísticas Míticas originales');
 check(e.upgradeHero(s,'a',hero.id).includes('no pueden'),'No aumenta tier');
 check(e.upgradeQuality(s,'a',hero.id).includes('no puede'),'No mejora calidad');
 check(e.sellHero(s,'a',hero.id).includes('Míticos'),'No hay reventa');
 check(e.requestPurchase(s,'b',hero.id,amount).includes('subasta'),'No se adquiere por traspaso');
 bless(s);const result=e.simulateMatch(s);const change=result.changes.find(c=>c.id===hero.id);
 eq(change.before,change.after,'Mítico inmutable en batalla');eq(s.teamA.heroes.find(h=>h.id===hero.id).stats,hero.stats,'Mítico fijo en ficha');
 const fixed={...hero.stats};e.expireSeason(s,NOW+8*e.DAY_MS);
 eq(s.seasonHeroes[hero.id].stats,fixed,'Mítico fijo entre temporadas');
}
// Migrar v0.5.0 al nuevo catálogo JSON.
{
 const s=fresh('migrate-me');const legacy=structuredClone(s);
 legacy.version=5;delete legacy.mythicalAuction;delete legacy.mythicSeenSeason;
 for(const id of Object.keys(legacy.seasonHeroes))if(id.startsWith('myth-'))delete legacy.seasonHeroes[id];
 for(const team of [legacy.teamA,legacy.teamB])for(const h of team.heroes){delete h.minTier;delete h.maxTier;delete h.maxLevel;delete h.caps;}
 const migrated=e.migrateSavedState(legacy,NOW);
 check(!!migrated,'Migración recupera estado');eq(migrated.version,6);eq(Object.keys(migrated.seasonHeroes).length,126,'Nueva baraja disponible');
 check(migrated.teamA.heroes.every(h=>h.caps&&h.minTier),'Enriquece fichas antiguas');
 check(migrated.markets.a.every(h=>h.caps&&h.maxLevel),'Enriquece ofertas antiguas');
}
console.log(`OK: ${checks.toLocaleString('es-ES')} comprobaciones de catálogo, mercado, temporadas, combate, Míticos, subastas y migración.`);
