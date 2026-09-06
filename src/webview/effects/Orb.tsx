import { ThinkingOrb } from 'thinking-orbs';
import { useAppearance } from '../appearance';
import { ORB_SIZE, ORB_SPEED, ORB_STATE, type OrbKind } from './presets';

// 20px inline Orb, exactly filling the lead slot; theme follows the ancestor data-theme (the library reads it itself)
export function Orb({ kind, paused }: { kind: OrbKind; paused?: boolean }) {
  const { motion } = useAppearance();
  return (
    <span className="flex size-lead items-center justify-center">
      <ThinkingOrb state={ORB_STATE[kind]} size={ORB_SIZE} speed={ORB_SPEED[motion]} paused={paused || motion === 'none'} />
    </span>
  );
}
