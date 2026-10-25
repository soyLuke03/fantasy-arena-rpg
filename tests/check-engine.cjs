const assert = require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const out=path.join(__dirname,'.compiled');
fs.mkdirSync(out,{recursive:true});
const localTsc=path.join(root,'node_modules','.bin',process.platform==='win32'?'tsc.cmd':'tsc');
execFileSync(fs.existsSync(localTsc)?localTsc:'tsc', ['--strict','--target','ES2022','--module','commonjs','--resolveJsonModule','--esModuleInterop','--outDir',out,'src/app/game/models.ts','src/app/game/catalog.ts','src/app/game/engine.ts'],{cwd:root,stdio:'inherit'});
const engine=require('./.compiled/app/game/engine.js');
const {CATALOG,MYTHICS}=require('./.compiled/app/game/catalog.js');
let checks=0;
const ok=(v,msg)=>{assert.ok(v,msg);checks++;};
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;};
function start(seed='A',mode='manual',duration=3){const s=engine.newGame(seed,mode,duration,'random',1750000000000);for(const side of ['a','b']){engine.chooseBlessing(s,side,s.blessingChoices[0]);engine.chooseDailyBlessing(s,side,s.dailyBlessingChoices[side][0]);}return s;}
function combat(s){while(!s.result){for(const side of ['a','b']){const team=side==='a'?s.teamA:s.teamB;if(!team.blessing)engine.chooseBlessing(s,side,s.blessingChoices[0]);if(!team.dailyBlessing)engine.chooseDailyBlessing(s,side,s.dailyBlessingChoices[side][0]);}engine.playNextBout(s);}return s.result;}
const sides=['a','b'];
eq(CATALOG.length,126,'Catálogo JSON completo');eq(MYTHICS.length,6,'Seis Míticos');
for(let i=0;i<60;i++){
 const s=start('test-'+i,'manual');
 ok(engine.isValidState(s),'Nueva partida válida');
 eq(s.version,9);eq(s.teamA.activeIds.length,3);eq(s.teamB.activeIds.length,3);
 eq(s.markets.a.length,6);eq(s.markets.b.length,6);
 ok(!s.markets.a.some(h=>s.markets.b.some(other=>other.id===h.id)),'Escaparates sin duplicados');
 ok(!s.playerDecks.a.some(id=>s.playerDecks.b.includes(id)),'Mazos privados exclusivos');
 for(const h of MYTHICS)eq(s.seasonHeroes[h.id].stats,h.stats,'Mítico sin variación entre temporadas');
 const price=engine.marketRefreshCost(s,'a');eq(price,2);
 if(s.teamA.gold>=price){engine.refreshMarket(s,'a');eq(engine.marketRefreshCost(s,'a'),3);}
 const original=s.teamA.heroes.map(h=>({...h.stats}));
 const first=engine.playNextBout(s);
 eq(first.number,1);eq(s.currentBouts.length,1);eq(s.history.length,0);
 ok(s.result===null,'Jornada sigue abierta tras primera batalla');
 eq(s.teamA.heroes.slice(0,3).map(h=>h.stats),original,'Sin variación después de 1 batalla');
 ok(engine.buyHero(s,'a',s.markets.a[0]?.id ?? 'NO').includes('cerrado'),'Sin mercado a mitad de jornada');
 for(let n=2;n<=4;n++){const b=engine.playNextBout(s);eq(b.number,n);eq(s.history.length,0);}
 const r=engine.playNextBout(s);
 eq(r.number,5);eq(s.history.length,1);
 ok(!!s.result,'Resultado al terminar quinta');eq(s.currentBouts.length,5);
 ok(s.result.changes.every(c=>c.participations>0 && c.participations<=5),'Participaciones contadas por campeón');
 ok(s.result.changes.every(c=>!!c.eliminated === (c.deaths>=3)),'Umbral de 3 muertes');
 ok(!s.result.changes.some(c=>c.tier==='Mítico' && ['health','attack','defense','speed'].some(k=>c[k]!==0)),'Míticos inmutables');
 eq(engine.nextDay(s,1750000000001).includes('Jornada'),true);
 eq(s.day,2);eq(s.currentBouts.length,0);eq(s.teamA.marketRolls,0);
 ok(s.teamA.activeIds.length>=3 && s.teamB.activeIds.length>=3,'Equipos válidos nueva jornada');
 ok(!s.teamA.dailyBlessing && !s.teamB.dailyBlessing,'Bendiciones diarias nuevas');
 for(const side of sides)engine.chooseDailyBlessing(s,side,s.dailyBlessingChoices[side][0]);
 combat(s);engine.nextDay(s,1750000000002);
 for(const side of sides)engine.chooseDailyBlessing(s,side,s.dailyBlessingChoices[side][0]);
 combat(s);
 const score=s.scoreA+s.scoreB;
 eq(score,9,'Tres jornadas, 3 puntos por victoria');
 ok(s.seasonComplete,"La última batalla cierra la temporada");
 eq(engine.nextDay(s,1750000000003).includes("finalizada"),true,"No reinicia automáticamente");
 eq(s.season,1,"Sigue en temporada 1 antes de confirmar");
 engine.beginNextSeason(s,1750000000003);
 eq(s.season,2);eq(s.day,1);eq(s.history.length,0);
}
// Rotaciones efectivas: distintos campeones participan en un número distinto de batallas.
{
 const s=start('rotation-case');s.teamA.gold=10000;
 for(const h of [...s.markets.a.slice(0,4)])engine.buyHero(s,'a',h.id);
 ok(s.teamA.heroes.length>=6,'Puede comprar y almacenar más de cinco');
 eq(s.teamA.activeIds.length,5);
 const original=s.teamA.heroes[0].id;
 const bench=s.teamA.heroes.find(h=>!s.teamA.activeIds.includes(h.id));
 ok(!!bench,'Hay suplente');
 engine.playNextBout(s);
 ok(engine.canRotate(s,'a'),'Puede rotar tras batalla');
 ok(!engine.canModify(s,'a'),'No puede comprar tras inicio de batalla');
 const msg=engine.rotateHero(s,'a',original,bench.id);
 ok(msg.includes('Sustitución'),'Rotación realizada');
 ok(!s.teamA.activeIds.includes(original) && s.teamA.activeIds.includes(bench.id),'Cambio en alineación');
 combat(s);
 const former=s.result.changes.find(c=>c.id===original);
 const newcomer=s.result.changes.find(c=>c.id===bench.id);
 eq(former.participations,1,'Titular descansado participó en una batalla');
 eq(newcomer.participations,4,'Suplente participó en cuatro batallas');
 eq(s.result.changes.filter(c=>c.side==='a').length,6,'Informe incluye los seis que jugaron');
}
// Eliminación forzada con una fixture de prueba, y draft de reemplazo.
{
 const s=start('deathcase');const hero=s.teamA.heroes[0];
 const change={id:hero.id,name:hero.name,side:'a',className:hero.className,tier:hero.tier,before:{...hero.stats},after:{...hero.stats},health:0,attack:0,defense:0,speed:0,damage:0,damageTaken:100,healed:0,kills:0,deaths:1,saves:0,remainingHp:0};
 const other=s.teamB.heroes[0];const changeB={...change,id:other.id,name:other.name,side:'b',deaths:0};
 // Prueba contador, sin cambiar eventos de combate.
 s.currentBouts=[1,2,3].map(n=>({number:n,winner:'b',turns:1,log:[],remainingA:0,remainingB:100,changes:[{...change},{...changeB}]}));
 eq(engine.deathCount(s,'a',hero.id),3);
 ok(engine.rotateHero(s,'a',hero.id,other.id).includes('Elige'),'No permite usar un héroe rival de suplente');
}
// Estructura de guardado persistente entre batallas (serialización JSON).
{
 const s=start('save');engine.playNextBout(s);
 const loaded=engine.migrateSavedState(JSON.parse(JSON.stringify(s)));
 ok(!!loaded && engine.isValidState(loaded),'Guardado v7 válido');
 eq(loaded.currentBouts.length,1,'Batalla parcial guardada');
 combat(loaded);eq(loaded.history.length,1);
}
// Migración v6: las cinco primeras unidades pasan a plantilla activa.
{
 const s=start('migration');const legacy=JSON.parse(JSON.stringify(s));legacy.version=6;
 delete legacy.teamA.activeIds;delete legacy.teamB.activeIds;
 delete legacy.teamA.dailyBlessing;delete legacy.teamB.dailyBlessing;
 delete legacy.dailyBlessingChoices;delete legacy.currentBouts;delete legacy.eliminatedThisDay;delete legacy.fallenDraftIds;
 const restored=engine.migrateSavedState(legacy);
 ok(!!restored && engine.isValidState(restored),'Migración desde 0.6.0');
 eq(restored.teamA.activeIds.length,3);
}
console.log(`OK: ${checks} comprobaciones base del motor Fantasy Arena v0.9.0`);
// Ensayo de eliminación REAL: tres bajas en cinco batallas y reemplazo aleatorio.
{
 const s=start('forced-elimination');
 const before=s.teamA.heroes.map(h=>h.id);
 for(const h of s.teamA.heroes)h.stats={health:1,attack:1,defense:1,speed:1};
 for(const h of s.teamB.heroes)h.stats={health:2000,attack:2000,defense:400,speed:400};
 combat(s);
 const fallen=s.result.changes.filter(c=>c.side==='a'&&c.eliminated);
 ok(fallen.length>=1,'La eliminación puede producirse realmente');
 ok(fallen.every(c=>c.deaths>=3),'Se elimina solo a quien muere 3+ veces');
 ok(fallen.every(c=>!s.teamA.heroes.some(h=>h.id===c.id) || s.result.emergencyResetSides?.includes('a')),'Eliminados no permanecen salvo si reaparecen sorteados en reinicio');
 const count=s.teamA.heroes.length;
 const emergency=!!s.result?.emergencyResetSides?.includes('a');
 engine.nextDay(s,1750000000020);
 eq(s.teamA.heroes.length,emergency?3:count+fallen.length,'Draft: 3 tras reinicio total, o un refuerzo por campeón perdido');
 ok(s.teamA.activeIds.length>=3,'Formación después de eliminación válida');
 ok(s.markets.a.every(h=>!s.fallenDraftIds.a.includes(h.id)),'Caídos no salen en tienda');
}
console.log('OK: eliminación real y draft posterior');

// v0.8.0 - Venta: mínimo 3 en propiedad y unidad desequipada.
{
 const s=start('storage-sale');
 const initial=s.teamA.heroes[0];
 ok(engine.sellHero(s,'a',initial.id).includes('tres'),'No se vende si solo se poseen tres');
 const market=s.markets.a.find(h=>h.price<=s.teamA.gold);
 ok(!!market,'Existe una oferta asequible');
 engine.buyHero(s,'a',market.id);
 eq(s.teamA.heroes.length,4);
 ok(engine.sellHero(s,'a',initial.id).includes('desequipar'),'No se venden titulares');
 ok(engine.toggleActive(s,'a',initial.id).includes('almacén'),'El usuario desequipa al titular');
 ok(engine.sellHero(s,'a',initial.id).includes('vendido'),'Venta válida desde almacén');
 eq(s.teamA.heroes.length,3,'Se conserva el mínimo de tres');
 ok(engine.sellHero(s,'a',s.teamA.heroes[0].id).includes('tres'),'No permite quedarse en dos');
}
// v0.8.0 - Traspaso solo desde almacén y nunca a mitad de batalla.
{
 const s=start('storage-trades');s.teamA.gold=5000;s.teamB.gold=5000;
 const extra=s.markets.b[0];ok(!!extra);
 engine.buyHero(s,'b',extra.id);
 const hero=s.teamB.heroes[0];
 const amount=engine.minimumOffer(hero);
 const msg=engine.requestPurchase(s,'a',hero.id,amount);
 ok(msg.includes('Oferta enviada'),'Oferta creada');
 const id=s.tradeOffers.at(-1).id;
 ok(engine.respondToPurchase(s,id,'b',true).includes('desequipar'),'No se acepta un traspaso del titular');
 ok(engine.toggleActive(s,'b',hero.id).includes('almacén'),'Vendedor desequipa al campeón');
 const goldBefore=s.teamA.gold;
 ok(engine.respondToPurchase(s,id,'b',true).includes('cambia de equipo'),'Traspaso desde almacén');
 ok(s.teamA.heroes.some(h=>h.id===hero.id),'El comprador recibe al campeón');
 eq(s.teamA.gold,goldBefore-amount,'Transferencia exacta del oro');
 eq(s.teamB.heroes.length,3,'El vendedor conserva sus tres');
 const sideBHero=s.teamB.heroes[0];
 ok(engine.requestPurchase(s,'a',sideBHero.id,engine.minimumOffer(sideBHero)).includes('tres'),'No permite negociar una plantilla de tres');
}
// v0.8.0 - Reinicio de emergencia sin perder puntos ni alterar al rival.
{
 const s=start('forced-elimination', 'manual', 7);
 s.scoreA=18;s.winsA=6;
 const otherDeck=[...s.playerDecks.b];
 const rivalIds=[...s.teamB.heroes.map(h=>h.id)];
 for(const h of s.teamA.heroes)h.stats={health:1,attack:1,defense:1,speed:1};
 for(const h of s.teamB.heroes)h.stats={health:2000,attack:2000,defense:400,speed:400};
 combat(s);
 ok(s.result.emergencyResetSides?.includes('a'),'Aniquilación provoca reinicio del equipo A');
 eq(s.emergencyResets.a,1,'Se registra un reinicio del equipo A');
 eq(s.emergencyResets.b,0,'Equipo B no sufre reinicio');
 eq(s.scoreA,18,'Conserva los 18 puntos previos');
 eq(s.winsA,6,'Conserva las 6 victorias previas');
 eq(s.day,1,'No avanza el calendario global');
 eq(s.teamA.heroes.length,3,'Recibe tres nuevos campeones comunes');
 eq(s.teamA.activeIds.length,3,'Se equipa la nueva plantilla');
 eq(s.teamA.gold,engine.START_GOLD,'Vuelve al presupuesto inicial');
 eq(s.teamA.blessing,null,'Puede elegir otra bendición de temporada');
 eq(s.teamA.marketRolls,0,'Se reinician sus renovaciones');
 eq(s.markets.a.length,engine.PERSONAL_SHOP_SLOTS,'Se rellena la tienda privada del reiniciado');
 eq(s.teamB.heroes.map(h=>h.id),rivalIds,'Equipo rival intacto');
 eq(s.playerDecks.b,otherDeck,'Mazo rival intacto');
 ok(s.teamA.heroes.every(h=>s.playerDecks.a.includes(h.id)),'Los nuevos campeones salen de su propio mazo');
 ok(!s.teamA.heroes.some(h=>s.teamB.heroes.some(o=>o.id===h.id)),'Sin duplicados entre propietarios');
 const points=s.scoreA;
 const msg=engine.nextDay(s);
 ok(msg.includes('Jornada 2'),'La liga continúa por la siguiente jornada');
 eq(s.teamA.heroes.length,3,'No duplica el draft de reemplazo tras el reinicio');
 eq(s.scoreA,points,'Puntos conservados al pasar de jornada');
 ok(engine.chooseBlessing(s,'a',s.blessingChoices[0]).includes('Bendición preparada'),'Puede elegir la bendición de su nueva plantilla');
 ok(engine.isValidState(s),'Guardado tras reinicio válido');
 const migrated=engine.migrateSavedState(JSON.parse(JSON.stringify(s)));
 ok(!!migrated && migrated.emergencyResets.a===1,'Guardado v8 conserva el reinicio');
}
// v0.8.0 - Migrar guardado de v0.7.0 con combate incompleto.
{
 const s=start('old-v7');engine.playNextBout(s);
 const copy=JSON.parse(JSON.stringify(s));copy.version=7;delete copy.emergencyResets;
 const restored=engine.migrateSavedState(copy);
 ok(!!restored && engine.isValidState(restored),'El guardado v7 migra a v8');
 eq(restored.version,9);eq(restored.currentBouts.length,1,'No pierde la batalla parcial');
 eq(restored.teamA.gold,s.teamA.gold,'Conserva el oro anterior');
}
console.log('OK: reinicio de emergencia, venta, traspasos y migración v0.8.0');

// REGRESIÓN v0.8.1: cuando muere un equipo, sus bajas jamás deben generar
// reemplazos gratuitos para el ganador, que no ha perdido ningún campeón.
// En la v0.8.0 faltaba filtrar `c.side===side` en replaceFallen().
{
 const s=start('bot-reset-repro','bot',7);
 const idsA=s.teamA.heroes.map(h=>h.id);
 for(const h of s.teamA.heroes)h.stats={health:2000,attack:2000,defense:400,speed:400};
 for(const h of s.teamB.heroes)h.stats={health:1,attack:1,defense:1,speed:1};
 combat(s);
 ok(s.result.emergencyResetSides?.includes('b'),'El bot pierde todos sus campeones');
 eq(s.teamB.heroes.length,3,'Reinicio: tres campeones nuevos para el bot');
 eq(s.eliminatedThisDay.a,[],'Un jugador sin muertes no acumula bajas rivales');
 eq(s.fallenDraftIds.a,[],'La baraja de caídos del ganador permanece vacía');
 engine.nextDay(s,1750000000999);
 eq(s.teamA.heroes.map(h=>h.id),idsA,'Equipo ganador no recibe campeones extra en la siguiente jornada');
 ok(s.teamB.heroes.length>=3,'El bot puede comprar después del reset con su oro');
}
console.log('OK: regresión v0.8.1: eliminaciones exclusivamente por equipo');

// v0.9.0 - Tácticas y posiciones hacen cambios reales en el motor.
{
 const s=start('formation-v09','manual',3);
 const a=s.teamA;
 const previous=[...a.activeIds];
 eq(engine.positionOf(a,previous[0]),'front');
 eq(engine.positionOf(a,previous[2]),'back');
 ok(engine.swapFormationSlots(s,'a',0,2).includes('intercambiadas'),'Permite mover delantera a retaguardia');
 eq(a.activeIds[0],previous[2]);eq(a.activeIds[2],previous[0]);
 ok(engine.setTacticalOrder(s,'a',previous[2],'defensive').includes('Defensiva'),'Cambia táctica individual');
 eq(a.tactics[previous[2]],'defensive');
 const bout=engine.playNextBout(s);
 ok(bout.log.some(line=>line.startsWith('⚑ Formación')),'Las posiciones influyen en la simulación');
 eq(engine.positionOf(a,previous[2]),'front','Conserva la posición');
 ok(engine.setTacticalOrder(s,'a',previous[0],'aggressive').includes('Agresiva'),'Cambiar orden entre batallas');
 const loaded=engine.migrateSavedState(JSON.parse(JSON.stringify(s)));
 eq(loaded.teamA.tactics[previous[0]],'aggressive','Guarda táctica entre batallas');
 eq(loaded.currentBouts.length,1,'Conserva primera batalla en curso');
}
// v0.9.0 - Nueva temporada solo tras confirmación explícita del usuario.
{
 const s=start('finale-v09','manual',3);
 for(let i=0;i<3;i++){
   combat(s);
   if(i<2){engine.nextDay(s);for(const side of sides)engine.chooseDailyBlessing(s,side,s.dailyBlessingChoices[side][0]);}
 }
 ok(s.seasonComplete,'El último combate pone seasonComplete=true');
 eq(s.day,3);eq(s.season,1);
 const roster=s.teamA.heroes.map(h=>h.id);
 ok(engine.nextDay(s).includes('finalizada'),'nextDay no reinicia una temporada finalizada');
 eq(s.teamA.heroes.map(h=>h.id),roster,'Las plantillas se mantienen en el podio');
 eq(s.records.length,0,'No se archiva hasta aceptar');
 ok(engine.beginNextSeason(s).includes('Comienza'),'Confirmación explícita da paso a la siguiente');
 eq(s.season,2);eq(s.day,1);ok(!s.seasonComplete);
 eq(s.records.length,1,'Clasificación anterior archivada');
 ok(!!s.records[0].notableHero,'Archiva campeón más destacado');
 ok(engine.isValidState(s),'Guardado temporada nueva válido');
}
// Migrar guardado 0.8.1 sin perder tácticas futuras y conservar el cierre pendiente.
{
 const s=start('legacy-8','manual',3);
 engine.playNextBout(s);
 const legacy=JSON.parse(JSON.stringify(s));legacy.version=8;delete legacy.seasonComplete;
 delete legacy.teamA.tactics;delete legacy.teamB.tactics;
 const migrated=engine.migrateSavedState(legacy);
 ok(!!migrated && engine.isValidState(migrated),'Migra v0.8.1 a v0.9.0');
 eq(migrated.currentBouts.length,1);
 eq(migrated.teamA.tactics,{});
}
console.log('OK: v0.9.0 posiciones, órdenes, podio, inicio confirmado y migración');
// v0.10.0: cada turno reproduce eventos originales y barras de vida reales.
// El campo visual NO cambia ninguna regla de puntuación ni afecta a la semilla.
{
  const s = start('playback-v010', 'manual', 3);
  const bout = engine.playNextBout(s);
  ok(Array.isArray(bout.timeline), 'Cada batalla incluye una secuencia visual');
  eq(bout.timeline.length, bout.turns, 'Un fotograma de turno por cada turno simulado');
  eq(bout.timeline.map(t => t.number), Array.from({length:bout.turns}, (_,i)=>i+1), 'Numeración consecutiva y explícita');
  eq(bout.initialFighters.length, s.teamA.activeIds.length + s.teamB.activeIds.length, 'Fotograma inicial muestra ambas alineaciones');
  eq(bout.timeline.flatMap(t=>t.events), bout.log.slice(1,-1), 'La animación reproduce todos los eventos del log y en el mismo orden');
  const final = bout.timeline.at(-1).fighters;
  for(const change of bout.changes){
    const frame=final.find(f=>f.id===change.id && f.side===change.side);
    ok(!!frame, 'Fotograma final incluye a todos los participantes');
    eq(frame.hp,change.remainingHp,'La vida visual coincide con el motor real');
    ok(frame.hp>=0 && frame.hp<=frame.maxHp,'Las barras no salen de rango');
  }
  const snapshot=JSON.parse(JSON.stringify(s));
  const reloaded=engine.migrateSavedState(snapshot);
  eq(reloaded.currentBouts[0].timeline,bout.timeline,'El guardado conserva toda la reproducción');
  const left=s.teamA.heroes.map(h=>JSON.stringify(h.stats));
  ok(!s.result, 'Una sola batalla sigue sin cerrar la jornada');
  eq(s.teamA.heroes.map(h=>JSON.stringify(h.stats)),left,'La reproducción no causa evolución intermedia');
  for(let i=0;i<4;i++)engine.playNextBout(s);
  ok(!!s.result,'Solo la quinta batalla cierra y recompensa la jornada');
  eq(s.result.bouts[0].timeline,bout.timeline,'El informe mantiene la secuencia tras cerrar la jornada');
}
console.log('OK: v0.10.0 secuencia por turnos, salud, eventos, guardado y cierre de jornada');
