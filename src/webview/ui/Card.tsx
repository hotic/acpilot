import type { HTMLAttributes } from 'react';
import { cn } from './cn';

// Container: the surface axis (hairline / tonal / stroke) decides border and background via the --card-* tokens
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-card-line bg-card shadow-card', className)} {...rest} />;
}
