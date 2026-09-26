import type { MessageKey } from '../i18n';
import type { GameModeId } from '../types';

export interface GameModeDefinition {
  id: GameModeId;
  label: string;
  shortKey: MessageKey;
  descriptionKey: MessageKey;
  controlsDesktopKey: MessageKey;
  controlsMobileKey: MessageKey;
  lanes?: number;
}

export const GAME_MODES: GameModeDefinition[] = [
  {
    id: 'forge',
    label: 'FORGE',
    shortKey: 'mode.forge.short',
    descriptionKey: 'mode.forge.description',
    controlsDesktopKey: 'mode.forge.desktop',
    controlsMobileKey: 'mode.forge.mobile',
  },
  {
    id: 'lanes4',
    label: '4K LANES',
    shortKey: 'mode.lanes4.short',
    descriptionKey: 'mode.lanes4.description',
    controlsDesktopKey: 'mode.lanes4.desktop',
    controlsMobileKey: 'mode.lanes4.mobile',
    lanes: 4,
  },
  {
    id: 'split2',
    label: '2K SPLIT',
    shortKey: 'mode.split2.short',
    descriptionKey: 'mode.split2.description',
    controlsDesktopKey: 'mode.split2.desktop',
    controlsMobileKey: 'mode.split2.mobile',
    lanes: 2,
  },
  {
    id: 'pulse1',
    label: '1K PULSE',
    shortKey: 'mode.pulse1.short',
    descriptionKey: 'mode.pulse1.description',
    controlsDesktopKey: 'mode.pulse1.desktop',
    controlsMobileKey: 'mode.pulse1.mobile',
    lanes: 1,
  },
  {
    id: 'drum',
    label: 'DRUM',
    shortKey: 'mode.drum.short',
    descriptionKey: 'mode.drum.description',
    controlsDesktopKey: 'mode.drum.desktop',
    controlsMobileKey: 'mode.drum.mobile',
  },
  {
    id: 'catch',
    label: 'CATCH',
    shortKey: 'mode.catch.short',
    descriptionKey: 'mode.catch.description',
    controlsDesktopKey: 'mode.catch.desktop',
    controlsMobileKey: 'mode.catch.mobile',
  },
];

export function gameModeById(id: GameModeId) {
  return GAME_MODES.find((mode) => mode.id === id) ?? GAME_MODES[0];
}
