import { modelBrand } from '@shared/models';
import { MarkSvg } from './marks';

// Vendor logo for a model family ("GLM-5.2" → Zhipu mark); unknown families fall back to an initial-letter tile
export function ModelMark({ family, className }: { family: string; className?: string }) {
  return <MarkSvg id={modelBrand(family)} name={family} className={className} />;
}
