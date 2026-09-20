import type { GameModeId } from '../types';

export interface GameModeDefinition {
  id: GameModeId;
  label: string;
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
    shortLabel: 'Pointer',
    description: '自由定位音符，Tap / Hold / Slide 全部保留。',
    controlsDesktop: '滑鼠 + Z / X',
    controlsMobile: '直接點擊 / 長按 / 拖曳',
  },
  {
    id: 'lanes4',
    label: '4K LANES',
    shortLabel: '4 Keys',
    description: '四軌落鍵模式，專注節奏與手指分工。',
    controlsDesktop: 'D / F / J / K',
    controlsMobile: '點擊四條軌道',
    lanes: 4,
  },
  {
    id: 'split2',
    label: '2K SPLIT',
    shortLabel: '2 Keys',
    description: '左右雙軌高速模式，適合快速交替節拍。',
    controlsDesktop: 'F / J',
    controlsMobile: '點擊左 / 右半邊',
    lanes: 2,
  },
  {
    id: 'pulse1',
    label: '1K PULSE',
    shortLabel: 'One Tap',
    description: '純 Timing 模式，不需要瞄準位置，只要跟住節拍。',
    controlsDesktop: 'Space',
    controlsMobile: '任意位置點擊',
    lanes: 1,
  },
  {
    id: 'drum',
    label: 'DRUM',
    shortLabel: 'Don / Ka',
    description: '紅藍鼓點模式，分辨 Don / Ka 並跟住節奏敲擊。',
    controlsDesktop: 'F / J = Don · D / K = Ka',
    controlsMobile: '點擊紅 / 藍鼓面',
  },
  {
    id: 'catch',
    label: 'CATCH',
    shortLabel: 'Move & Catch',
    description: '移動接手追蹤音符位置，在判定線接住節拍。',
    controlsDesktop: '← / → 或 A / D',
    controlsMobile: '左右拖曳接手',
  },
];

export function gameModeById(id: GameModeId) {
  return GAME_MODES.find((mode) => mode.id === id) ?? GAME_MODES[0];
}
