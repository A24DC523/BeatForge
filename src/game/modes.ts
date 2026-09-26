import type { MessageKey } from '../i18n';
import type { GameModeId } from '../types';

export interface GameModeDefinition {
  id: GameModeId;
  label: string;
  shortKey: MessageKey;
  descriptionKey: MessageKey;
  controlsDesktopKey: MessageKey;
  controlsMobileKey: MessageKey;
  shortLabel: string;
  description: string;
  controlsDesktop: string;
  controlsMobile: string;
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
    shortLabel: 'Pointer',
    description: 'Free-position notes with Tap, Hold, and Slide preserved.',
    controlsDesktop: 'Mouse + Z / X',
    controlsMobile: 'Tap / hold / drag',
  },
  {
    id: 'lanes4',
    label: '4K LANES',
    shortKey: 'mode.lanes4.short',
    descriptionKey: 'mode.lanes4.description',
    controlsDesktopKey: 'mode.lanes4.desktop',
    controlsMobileKey: 'mode.lanes4.mobile',
    shortLabel: '4 Keys',
    description: 'Four-lane mode focused on rhythm and finger independence.',
    controlsDesktop: 'D / F / J / K',
    controlsMobile: 'Tap four lanes',
    lanes: 4,
  },
  {
    id: 'split2',
    label: '2K SPLIT',
    shortKey: 'mode.split2.short',
    descriptionKey: 'mode.split2.description',
    controlsDesktopKey: 'mode.split2.desktop',
    controlsMobileKey: 'mode.split2.mobile',
    shortLabel: '2 Keys',
    description: 'Fast left/right two-lane play built around alternating rhythms.',
    controlsDesktop: 'F / J',
    controlsMobile: 'Tap left / right',
    lanes: 2,
  },
  {
    id: 'pulse1',
    label: '1K PULSE',
    shortKey: 'mode.pulse1.short',
    descriptionKey: 'mode.pulse1.description',
    controlsDesktopKey: 'mode.pulse1.desktop',
    controlsMobileKey: 'mode.pulse1.mobile',
    shortLabel: 'One Tap',
    description: 'Pure timing mode with no aiming—just follow the beat.',
    controlsDesktop: 'Space',
    controlsMobile: 'Tap anywhere',
    lanes: 1,
  },
  {
    id: 'drum',
    label: 'DRUM',
    shortKey: 'mode.drum.short',
    descriptionKey: 'mode.drum.description',
    controlsDesktopKey: 'mode.drum.desktop',
    controlsMobileKey: 'mode.drum.mobile',
    shortLabel: 'Don / Ka',
    description: 'Red/blue drum mode: identify Don and Ka while following the rhythm.',
    controlsDesktop: 'F / J = Don · D / K = Ka',
    controlsMobile: 'Tap red / blue drum side',
  },
  {
    id: 'catch',
    label: 'CATCH',
    shortKey: 'mode.catch.short',
    descriptionKey: 'mode.catch.description',
    controlsDesktopKey: 'mode.catch.desktop',
    controlsMobileKey: 'mode.catch.mobile',
    shortLabel: 'Move & Catch',
    description: 'Move the catcher horizontally and intercept notes at the judgment line.',
    controlsDesktop: '← / → or A / D',
    controlsMobile: 'Drag left / right',
  },
];

export function gameModeById(id: GameModeId) {
  return GAME_MODES.find((mode) => mode.id === id) ?? GAME_MODES[0];
}
