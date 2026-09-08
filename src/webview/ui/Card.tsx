import type { HTMLAttributes, Ref } from 'react';
import { cn } from './cn';
import { cva } from 'class-variance-authority';

const cardVariants = cva('rounded-lg border border-card-line bg-card shadow-card');

// Container: the surface axis (hairline / tonal / stroke) decides border and background via the --card-* tokens
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  return <div className={cn(cardVariants(), className)} {...rest} />;
}
