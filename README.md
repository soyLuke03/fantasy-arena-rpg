# Fantasy Arena v0.10.0 — Laboratorio RPG PvP local

Versión nueva basada en **v0.9.0**, con mejoras de presentación, estrategia y documentación. Se sigue ejecutando **solo en tu PC** con Angular 20 y TypeScript. **No hay Supabase** ni multijugador online. Catálogo JSON editable de 126 campeones (120 normales y 6 Míticos).

## Descarga, instalación y puesta en marcha

Necesitas una versión compatible de Node.js (recomendada Node 22) y npm. Descomprime el ZIP en una carpeta nueva, abre una terminal en esa carpeta y ejecuta:

```bash
npm install
npm run check:engine
npm run build
npm start
```

Después visita `http://localhost:4200`. Como siempre, el prototipo guarda el estado en el `localStorage` del navegador. La carpeta `node_modules` **no viene en el ZIP** y es normal.

### Novedad principal de v0.10.0: combate visual por turnos

- Al pulsar **Simular batalla**, se abre una reproducción **no instantánea** con barras de vida de ambos equipos y los eventos del turno actual. El motor ha calculado el resultado de antemano: la reproducción solo lo muestra y no puede alterarlo.
- Controles: **Pausar / Continuar**, avance manual **Turno**, velocidad **×1 / ×2 / ×4**, **Saltar al final** y **Cerrar y continuar**.
- Las crónicas de **Resultados** agrupan los eventos por **turnos desplegables**, con nombres coloreados según el equipo. El botón **Volver a ver batalla** reproduce una batalla ya disputada **sin consumir una segunda acción de jornada**.
- Al terminar una temporada, el podio ofrece **Revivir batalla final**.
- Los guardados antiguos sin datos visuales siguen pudiendo consultarse en el formato anterior.
- Más información en `docs/REPRODUCCION_DE_BATALLAS.md`.

### Funciones heredadas de la v0.9.0

1. **Tarjetas más legibles.** Las estadísticas principales aparecen de un vistazo. La ficha del personaje incluye rareza, potencial y progresión detallada; los datos densos se pueden desplegar. Se mantienen las fichas completas y las vistas previas de mejoras.
2. **Formación real 2 + 3.** Los dos primeros campeones de tu alineación ocupan la **delantera**; hasta tres ocupan **retaguardia**. El motor suele atacar delante y protege más a los traseros mientras permanezcan delanteros vivos. Un Asesino puede saltarse la protección.
3. **Órdenes por campeón.** Agresiva (+12 % daño causado y recibido, busca rematar), Equilibrada y Defensiva (−15 % daño causado y recibido; Tanques/Apoyos protegen y curan más a menudo). Estos porcentajes son provisionales. Puedes reorganizar formación y órdenes **entre batallas**.
4. **Motivos de botones bloqueados.** Aparecen pistas visibles junto a los controles de mercado, compras, fichas, ventas, mejoras, formación, subastas y bendiciones. No dependemos solo del `title` del navegador, que no siempre funciona en botones `disabled` o en móviles.
5. **Pantalla final entre temporadas.** Tras la quinta batalla de la **última jornada** aparece un podio con puntuaciones, victorias y campeón destacado. **La temporada no se reinicia sola**: puedes permanecer en esa pantalla, exportar una copia y pulsar **Comenzar nueva temporada** con confirmación. El historial se archiva al confirmar.
6. **Documentación extensa en castellano.** JSDoc en las operaciones principales, comentarios que explican las reglas delicadas y dos documentos en `docs/` para navegar el proyecto.

## Reglas que se conservan

- **Máximo cinco campeones en combate**, resto en almacén, y los cinco se enfrentan en cada batalla.
- **Cinco batallas por jornada**, con botón para simular cada batalla por separado y poder rotar entre ellas. En PvP online habrá intervalos reales; aquí avanzas cuando quieras.
- Al terminar la quinta se calculan variaciones de estadísticas, premios, puntos y bajas definitivas. Antes de ese momento, las estadísticas base no cambian por actuaciones.
- **Tres muertes en la jornada** eliminan definitivamente al personaje; si un equipo pierde toda su plantilla, recibe tres campeones y 250 oro, pero **conserva puntos, victorias e historial**.
- Personajes Míticos sin mejora ni variación de estadísticas, obtenidos solo en subastas.
- Tiendas con **seis ofertas por jugador** y mazos privados exclusivos; oro de victoria, kills y defensas salvadoras; bendiciones de temporada y jornada.
- No se venden personajes equipados, no puedes dejarte menos de tres en propiedad, y los traspasos se bloquean durante las batallas.
- Duraciones de **3, 7, 15 o 30 jornadas**. En local se pasa a la jornada siguiente sin espera real.

## Carpetas importantes

```text
src/
  app/
    app.component.ts           # Controlador de Angular y localStorage
    app.component.html         # Pantallas y componentes visuales
    app.component.css          # Estilos adaptables a móvil
    game/
      models.ts                # Interfaces y tipos
      catalog.ts               # Carga del catálogo JSON
      engine.ts                # Simulador, mercado, economía, temporadas
  assets/data/champions.json   # Catálogo de campeones personalizables

docs/
  GUIA_DEL_CODIGO.md           # Arquitectura, funciones y dónde cambiar cada regla
  REGLAS_DE_JUEGO.md           # Resumen de reglas para las pruebas

tests/check-engine.cjs        # Pruebas automáticas del motor en Node
```

**Empieza por `docs/GUIA_DEL_CODIGO.md`**. El JSON debe continuar siendo JSON válido: admite datos, pero no comentarios dentro del propio archivo.

## Compatibilidad del guardado

Se intenta migrar automáticamente el estado v0.8.1 a la estructura v0.9.0, conservando personajes, oro, rondas parciales y puntuaciones. Se añaden las órdenes tácticas con valor por defecto `balanced`, y la bandera de cierre de temporada. **Te recomiendo exportar primero la partida v0.8.1**. El código conserva la clave de almacenamiento anterior para poder recuperar la partida cuando abras la v0.9.0 en el mismo origen.

## Comprobaciones realizadas y limitaciones

- **Compilación estricta TypeScript del motor:** correcta. La v0.10.0 añade pruebas de turnos, instantáneas de salud, registro ordenado y guardados de batalla.
- **Pruebas automáticas del motor:** pasan, incluyendo posición delantera/retaguardia, órdenes, varias jornadas, pantalla final y migración desde v0.8.1.
- **Comprobación de tipos de `app.component.ts` y `main.ts`:** correcta con definiciones mínimas temporales de Angular, porque no se pudieron instalar los paquetes de Angular en este entorno.
- **`npm run build` de Angular:** **NO se ha podido ejecutar/verificar aquí**. El acceso a npm expiró al intentar instalar las dependencias. Debe ejecutarse en tu ordenador; si aparece un fallo de plantilla o compilación, trae la salida completa.

Esta es una versión de **pruebas**, no un juego equilibrado ni una plataforma multijugador. La primera parte a evaluar es si las nuevas decisiones tácticas aportan estrategia sin hacer que una clase domine a las demás.
