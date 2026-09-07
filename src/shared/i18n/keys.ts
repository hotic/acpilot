import type { en } from './en';

// The key set is whatever en defines; a key missing from another locale is a type error in that locale's file
export type MsgKey = keyof typeof en;
