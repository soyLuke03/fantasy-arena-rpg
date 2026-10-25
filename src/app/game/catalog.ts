import { HeroTemplate } from './models';
import champions from '../../assets/data/champions.json';
/** Catálogo editado a mano en src/assets/data/champions.json. No generar campeones en tiempo de ejecución. */
export const CATALOG = champions as HeroTemplate[];
export const MYTHICS = CATALOG.filter(c => c.tier === 'Mítico');
export const NORMAL_CHAMPIONS = CATALOG.filter(c => c.tier !== 'Mítico');
