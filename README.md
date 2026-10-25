# Fantasy Arena v0.6.0 — laboratorio RPG PvP local

Prototipo **Angular 20 + TypeScript** para **un jugador que controla dos equipos o juega contra un bot**, sin backend, sin Supabase, sin cuentas y sin API. Conserva las mecánicas de la v0.5.0 y añade las reglas diseñadas para campeones, oro, progresión y míticos.

## Arrancar

Requisitos: Node.js reciente compatible con Angular 20 (por ejemplo Node 22), npm y navegador.

```bash
npm install
npm start
```

Abrir `http://localhost:4200`. Para comprobar el motor:

```bash
npm run check:engine
npm run build
```

**Estado de pruebas de esta entrega:** el motor TypeScript compila y supera **11.128 comprobaciones automatizadas**. No se ha podido ejecutar una compilación real de Angular (`ng build`) en el entorno de creación porque no se pudo instalar las dependencias desde npm. Es necesario ejecutar `npm install` y `npm run build` en tu equipo. No se incluyen `node_modules` en el ZIP.

## Cambios de la v0.6.0

### Catálogo explícito de 126 campeones

- Edita `src/assets/data/champions.json` (120 campeones normales y 6 míticos). Cada ficha fija **ID único, clase, nombre, calidad mínima y máxima, tier máximo, coste, atributos base, límites de ganancia/pérdida al terminar una jornada y, en Míticos, habilidad única**.
- El JSON está **incluido en la compilación** del frontend. Para aplicar cambios al catálogo, vuelve a compilar o reinicia `npm start`; en la versión online futura estará en una base de datos.
- Las **estadísticas de temporada** son copias independientes del catálogo; la opción de nueva partida permite base fija o variación de ±10% en campeones normales. Los **Míticos NO tienen azar en sus estadísticas**: siempre empiezan con las mismas del JSON.
- Los campeones normales pueden mejorar de **Común → Raro → Épico → Legendario** si su calidad inicial/máxima lo permite. La calidad comprada y el nivel/tier se conservan de jornada a jornada **solo durante esa temporada**. El coste, los incrementos exactos y los máximos aparecen en las fichas.

### Evolución tras cinco batallas

- Cada jornada cuenta **cinco combates completos** entre ambos equipos. Vida, habilidades y escudos se reinician entre combates, pero **las estadísticas de temporada NO se modifican entre esas cinco batallas**.
- Tras el quinto combate se acumulan kills, muertes, curación, daño y defensas salvadoras y se aplica **un único cambio de estadísticas por campeón**. Sus topes están en `champions.json` y son visibles antes de fichar y en la ficha.
- Una estadística **nunca disminuye simplemente por derrota o bajo rendimiento**. Las penalizaciones negativas dependen de haber muerto en uno o varios de los cinco combates. El límite inferior por jornada evita caídas desproporcionadas. Los cambios siguen a lo largo de toda la temporada y se reinician al terminarla.
- En **Resultados**, la crónica coloreada se consulta por combate y el panel de variaciones muestra el **balance definitivo de la jornada completa** para ambos equipos.

### Economía

- Oro al terminar la jornada: **victoria +28, derrota +3, por kill +4 y por defensa salvadora +7** (cantidades **provisionales para probar equilibrio**).
- Eliminada la paga fija de +30 al pasar de jornada. El oro persiste durante la temporada y se gasta en fichajes, renovaciones, tiers, calidad, pujas y negociaciones.
- Renovar una tienda cuesta **2, 3, 4... oro**, según tus renovaciones de esa jornada; el contador se reinicia al avanzar.
- Cada tienda utiliza su **mazo privado de 60 campeones**, sin duplicados entre jugadores durante toda la temporada. Se mantiene `9 + 2 × participantes` (13 ofertas visibles sumando ambas tiendas en local).
- Las peticiones de compra entre jugadores conservan el **mínimo igual al precio de compra del actual propietario** y traspasan la instancia con estadísticas y mejoras.

### Campeones MÍTICOS

- Hay **6 campeones Míticos** predefinidos; están completamente **fuera de los mazos y tiendas normales**.
- Los Míticos **solo se consiguen mediante subasta especial**. No admiten tier, mejora de calidad, evolución de stats, penalizaciones por muertes, venta al mercado ni traspasos entre usuarios. Sí reciben los efectos temporales de combate.
- Sus **habilidades exclusivas** afectan al motor de combate: explosión arcana amplia, último bastión, ejecución, santuario, guardián protector y segunda embestida con absorción de vida.
- La subasta tiene una probabilidad provisional del **8% al iniciar una temporada** y del **4% por nueva jornada**, con **máximo una oportunidad mítica por temporada**.
- La reserva global se disputa en la pestaña **Subasta mítica**. Puedes **pujar desde A y B** en control doble, o hacerlo frente al bot en modo IA. La oferta ganadora se cobra al resolver la subasta, antes del combate (si no se resuelve manualmente, el combate la cierra automáticamente). Los dos equipos necesitan una plaza libre y oro suficiente.
- En **Laboratorio** hay un botón para **forzar una subasta Mítica de prueba** sin esperar a que aparezca aleatoriamente (solo si esa temporada no tiene ya una subasta registrada).

## Una jornada paso a paso

1. Comienza la **temporada** con tres campeones Comunes de tu mazo personal y eliges una bendición. Esa plantilla inicial y la bendición persisten durante toda la temporada.
2. En **Mercado**, compra hasta 5 campeones; en **Plantillas**, sube tiers o calidad, comprobando bonificaciones antes de pagar.
3. En **Subasta mítica**, puja si apareció un Mítico; en **Traspasos**, pide personajes normales del rival.
4. Combate en **Arena**. Observa las cinco batallas y consulta en **Resultados** el oro obtenido y los cambios de stats finales para cada campeón.
5. Pasa a la siguiente jornada: personajes, bendición, estadísticas, calidad y oro **se conservan**; solo el contador de renovaciones vuelve a cero.
6. Cuando termina el tiempo real configurado de **3, 7, 15 o 30 días**, la temporada se reinicia, con nueva asignación de mazos y reset de mejoras, niveles, puntuaciones y calidad hasta la mínima definida por campeón.

El prototipo permite adelantar jornadas manualmente para probar sin esperar días reales. El **reloj de temporada usa el reloj local**, que no sirve como autoridad para una liga online. Esto es un laboratorio, no una plataforma multijugador segura.

## Editar personajes sin base de datos

Modifica `src/assets/data/champions.json`. Ejemplo simplificado:

```json
{
  "id": "1-0",
  "name": "Kael, Espada Roja",
  "className": "Guerrero",
  "tier": "Común",
  "minTier": "Común",
  "maxTier": "Legendario",
  "maxLevel": 3,
  "price": 26,
  "stats": { "health": 118, "attack": 23, "defense": 17, "speed": 16 },
  "caps": {
    "health": {"min": -11, "max": 12},
    "attack": {"min": -3, "max": 5},
    "defense": {"min": -3, "max": 4},
    "speed": {"min": -2, "max": 2}
  }
}
```

Ese objeto es **solo un ejemplo**, no sustituyas todo el archivo por él: el catálogo real contiene 126 entradas. Conserva IDs únicos y clases válidas (`Mago`, `Guerrero`, `Asesino`, `Apoyo`, `Tanque`, `Bestia`). `maxLevel` es un índice de mejora: `3` se muestra como **Nivel 1 / 4**. `caps` representa la variación máxima final de estadísticas **por jornada**, calculada a partir de las actuaciones de las cinco batallas; no es un atributo del daño del golpe.

Si cambias una ficha del JSON, **crea una partida nueva** para iniciar la temporada con sus valores actualizados. La partida guardada usa su propia copia de estadísticas para proteger su progresión.

## Guardados y versiones anteriores

El juego usa `localStorage` con la clave `fantasy-arena-local-v1`. Intenta migrar automáticamente desde la v0.5.0 al cargarla en el mismo origen del navegador. Preserva equipos, mazos, oro, estadísticas y ofertas pendientes; rellena los nuevos campos del catálogo. Antes de sobrescribir el estado crea una copia `fantasy-arena-local-v1-backup-v5`. Las crónicas antiguas no tenían el balance al final de las cinco batallas y **no puede reconstruirse** con precisión. Recomiendo **Exportar partida JSON** desde la versión antigua antes de cambiar.

## Pendiente / fuera de esta entrega

- **NO hay Supabase**, cuentas, acceso en remoto, PvP en línea o sincronización en tiempo real.
- **NO está implementado el modo Game Master online** (edición en vivo, permisos y auditoría); se deja para una fase futura. Por ahora se edita el JSON y se utiliza el Laboratorio local.
- IA sencilla de reglas, no IA generativa. No hay lógica completa de campañas PvE.
- Los porcentajes de subasta, los costes de mejora, el reparto de oro, los límites por campeón y las fórmulas de progreso son **valores experimentales de balance**. No se han fijado como canon definitivo.
- No se incluye reequilibrio automático ni imágenes individuales de campeones: son datos editables, no diseños finales.

Para probar un Mítico rápidamente, entra en una partida nueva, abre **Laboratorio → Generar subasta Mítica → Subastas**. Si no tienes el oro suficiente todavía, completa una o varias jornadas y acumula recompensas.
