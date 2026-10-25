# Guía de código — Fantasy Arena v0.9.0

Esta guía está escrita para que puedas orientarte en el proyecto sin tener que leer 60 KB de motor de golpe. **No hay Supabase, backend ni cuentas**. El catálogo de los campeones se carga desde JSON; los progresos de temporada se guardan en `localStorage`.

## 1. Por dónde empezar

| Archivo | Responsabilidad | Cuándo tocarlo |
|---|---|---|
| `src/app/game/models.ts` | Tipos TypeScript de campeones, equipos, batallas, traspasos y guardado. | Al añadir un dato nuevo o cambiar la forma de un objeto. |
| `src/app/game/catalog.ts` | Carga y tipa el catálogo JSON. | Normalmente no hace falta modificarlo. |
| `src/assets/data/champions.json` | **Los 126 campeones definidos**: estadísticas, calidad, habilidades, límites. | Para crear o equilibrar personajes. **JSON no admite comentarios**: consulta esta guía. |
| `src/app/game/engine.ts` | Motor puro de TypeScript: reglas, sorteos, combate, economía y jornadas. | Al cambiar una mecánica del juego. |
| `src/app/app.component.ts` | Traduce acciones de la interfaz en llamadas al motor; guarda partida. | Al conectar botones, controles, mensajes o estados de Angular. |
| `src/app/app.component.html` | Pantallas y controles visibles. | Al cambiar qué información se muestra. |
| `src/app/app.component.css` | Diseño visual responsive. | Al rediseñar tarjetas, formaciones o colores. |
| `tests/check-engine.cjs` | Tests de reglas sin abrir Angular. | Siempre que se modifica el motor. |

## 2. Modelo de juego: tres objetos distintos

- `HeroTemplate`: ficha **global e inmutable** del catálogo. Tiene `id`, `name`, `className`, `tier`, `minTier`, `maxTier`, `maxLevel`, `stats`, `caps`, `price` y habilidad opcional.
- `Hero`: copia para la **temporada en curso**, con estadísticas y nivel propios. Los Míticos no tienen mejoras ni variaciones permanentes.
- `Team`: oro, campeones en propiedad (`heroes`), alineación ordenada (`activeIds`), órdenes por campeón (`tactics`) y bendiciones.

`GameState` reúne los dos equipos, sus mazos exclusivos, ofertas visibles, subastas, historial, rondas abiertas y el estado `seasonComplete`. No guardes una copia distinta de una misma propiedad en Angular: el motor es la fuente de verdad.

## 3. Alineación y órdenes (nuevas en v0.9.0)

`activeIds` contiene **IDs en orden de casilla**, no necesariamente en el orden de compra:

```text
Casilla 0 · DELANTERA     Casilla 1 · DELANTERA
Casilla 2 · RETAGUARDIA  Casilla 3 · RETAGUARDIA  Casilla 4 · RETAGUARDIA
```

Si solo tienes tres combatientes, ocupan las tres primeras casillas: dos delante, uno detrás. Puedes intercambiar dos posiciones con `swapFormationSlots(state,side,i,j)` y cambiar la orden de cada campeón con `setTacticalOrder(state,side,id,order)`. Ambas acciones se permiten entre batallas, **no cambian resultados pasados** y se mantienen en el guardado.

En `makeFighters()` el orden se transforma en una propiedad temporal `line`, y la táctica guardada en `team.tactics[id]` se transforma en `tactic`. `battleTarget()` normalmente prefiere objetivos de primera línea (75 % de las elecciones); los Asesinos ignoran esa preferencia. La retaguardia obtiene una reducción de daño mientras quede algún delantero vivo (excepto frente a Asesinos).

| Táctica | Efectos actuales (balanceables) |
|---|---|
| `aggressive` | +12 % al daño causado y recibido; prioriza enemigos debilitados **dentro de los objetivos accesibles**. |
| `balanced` | No recibe multiplicadores especiales. Mantiene el comportamiento de clase. |
| `defensive` | −15 % al daño causado y recibido; más oportunidades de proteger/curar para Tanques/Apoyos. |

Esas variaciones **solo afectan a cada batalla**, nunca modifican `Hero.stats` automáticamente.

## 4. Una jornada = cinco batallas

`playNextBout(state)` simula una sola batalla y registra su crónica. La interfaz permite avanzar manualmente. Durante las batallas 1–4 se pueden cambiar alineaciones y órdenes, pero NO comprar, vender o cambiar mejoras. Cada batalla se juega con las estadísticas permanentes que tenía el campeón al inicio de la jornada; sus actuaciones se almacenan en `currentBouts`.

Solo cuando termina la **quinta** batalla se ejecuta `finalizeMatch()`:

1. Acumula actuaciones de todos los campeones que participaron, incluso reservas que entraron temporalmente.
2. Aplica cambios permanentes con `applyDayProgress()` (Míticos excluidos).
3. Calcula recompensas, puntos y estadísticas de la jornada.
4. Elimina a quienes acumularon **tres o más muertes** y programa su draft de reemplazo.
5. Si alguien perdió **todos los campeones en propiedad**, ejecuta el reinicio de emergencia SOLO para ese jugador, preservando puntuación y victorias.
6. Si era la última jornada, activa `seasonComplete = true`.

**No apliques stats después de cada batalla**: contradiría el diseño. `HeroChange` guarda además la variación y los totales para la pantalla Resultados.

## 5. Temporadas y pantalla intermedia

Se elige una duración de `3`, `7`, `15` o `30` jornadas. `nextDay()` solo avanza mientras queden jornadas. **La última termina sin reiniciar automáticamente**, gracias a `seasonComplete`.

El botón visible **Comenzar nueva temporada** pide confirmación en Angular y llama `beginNextSeason()`; esto archiva clasificación y estadísticas destacadas en `records`, reinicia progreso y comienza temporada siguiente. El menú **Crear nueva partida** es otra cosa: elimina la partida local actual tras pedir confirmación.

## 6. Mercado y economía

- Los **120 campeones normales** se distribuyen en `playerDecks.a` y `playerDecks.b` al empezar la temporada; los mazos son exclusivos.
- Cada tienda tiene **seis ofertas**, independientes, y `refreshMarket()` solo rota las de su propietario.
- Precio de refresco: `2 + marketRolls`; el contador vuelve a 0 en la siguiente jornada.
- `buyHero()`, `sellHero()`, `requestPurchase()` y `respondToPurchase()` comprueban permisos, oro y capacidad.
- Solo se venden campeones del **almacén** y sin dejar al vendedor con menos de tres personajes.
- Los Míticos vienen de la reserva global y solo se obtienen mediante `placeMythicBid()` y `resolveMythicAuction()`.

## 7. Cómo editar el catálogo JSON

Localiza el personaje por `id` único, por ejemplo:

```json
{
  "id": "guerrero-uno",
  "name": "Nombre de ejemplo",
  "className": "Guerrero",
  "tier": "Común",
  "minTier": "Común",
  "maxTier": "Legendario",
  "maxLevel": 3,
  "price": 28,
  "stats": {"health": 120, "attack": 25, "defense": 15, "speed": 12},
  "caps": {
    "health": {"min": -8, "max": 10},
    "attack": {"min": -2, "max": 3},
    "defense": {"min": -2, "max": 2},
    "speed": {"min": -1, "max": 1}
  }
}
```

El ejemplo es **orientativo**: no copies un objeto encima de otro ni repitas IDs. Los valores reales están en el catálogo existente. Si cambias el JSON, crea una nueva partida de prueba para asegurarte de que el estado antiguo no arrastra otros valores.

## 8. Guardados y migración

`STORAGE_KEY` conserva el identificador anterior para recuperar partidas antiguas. `migrateSavedState()` convierte las partidas v0.8.1 a la versión **9** y añade `tactics` y `seasonComplete` sin borrar campeones, oro, clasificaciones ni combates parciales. Angular crea una copia original en `localStorage` con sufijo `-backup-v8` cuando se migra.

Antes de cambiar reglas o catálogo, pulsa **Exportar partida JSON**. No edites manualmente guardados de un jugador sin hacer copia.

## 9. Pruebas recomendadas

```bash
npm install
npm run check:engine
npm run build
npm start
```

En el Laboratorio puedes ejecutar cien simulaciones reproducibles con la misma semilla, sin modificar la partida. Usa la semilla si detectas un bug.

**Nota:** `npm run check:engine` solo compila y valida el motor TypeScript. `npm run build` es necesario para verificar el HTML/TypeScript específico de Angular. Si falla, copia el error completo para corregirlo.


## Reproducción de batallas (v0.10.0)

Lee `docs/REPRODUCCION_DE_BATALLAS.md` para entender `Bout.timeline`, el reloj de reproducción en Angular y las crónicas por turno. La reproducción nunca vuelve a ejecutar el combate: es una representación visual de un resultado ya calculado.
