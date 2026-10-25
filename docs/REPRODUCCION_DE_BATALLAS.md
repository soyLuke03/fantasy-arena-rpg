# Reproducción de combates (v0.10.0)

## Dos pasos independientes

1. El **motor**, en `src/app/game/engine.ts`, simula la batalla **una vez** con la semilla. La función privada `simulateBout()` ahora incluye en cada `Bout` una propiedad `timeline` con sus turnos y una instantánea inicial (`initialFighters`).
2. La **interfaz**, en `src/app/app.component.ts` y `app.component.html`, reproduce esos turnos poco a poco. El temporizador `playbackClock` no ejecuta daño, no consume recursos y **nunca recalcula el ganador**.

Las barras de vida se obtienen de `BattleTurn.fighters`, fotografías del estado real tras cada turno. Los eventos de un turno se obtienen de la misma `log` que almacena el simulador. El límite continúa siendo **25 turnos por batalla**.

## Dónde cambiar la velocidad

`startPlaybackClock()` usa aproximadamente 1250, 650 y 290 ms por turno (×1, ×2, ×4). Son ritmos de **reproducción**, no de simulación. `advancePlayback`, `pausePlayback`, `resumePlayback`, `skipPlayback` y `closePlayback` controlan la visualización.

## Las cinco batallas y las sustituciones

Cada click en «Simular batalla» llama a `playNextBout()` **una única vez**. La interfaz cubre la página hasta que el usuario termine o salte la reproducción. Tras cerrar, puede cambiar su alineación **entre** batallas. Las recompensas, eliminaciones definitivas y variaciones permanentes de atributos **solo se aplican después de la quinta batalla**, como siempre.

## Crónica agrupada y compatibilidad

La pestaña «Resultados» enseña las actuaciones agrupadas en detalles de cada turno y permite **volver a reproducir** una batalla sin alterar el estado del juego. Los guardados antiguos sin `timeline` siguen mostrando el log clásico. La v0.10.0 mantiene la estructura de guardado compatible con la v0.9.0 (`GameState.version=9` intencionadamente): no se eliminan ni sobrescriben partidas manualmente.

## Qué pasa al cerrar y volver al navegador

El resultado se calcula y guarda antes de la animación. Si cierras el navegador a mitad de la reproducción, el resultado ya está persistido. Puedes **repetir la visualización** desde Resultados (o el podio si era la batalla final), pero no se repite el combate ni se conceden recompensas duplicadas.

## Limitaciones

La barra salta entre los valores de vida al **final de cada turno**, no tras cada acción individual. Se usan transiciones CSS sencillas y se respeta `prefers-reduced-motion`. El cálculo es síncrono y la animación es local: no requiere Supabase ni conexiones simultáneas.
