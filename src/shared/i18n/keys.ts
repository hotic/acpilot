import type { zhCN } from './zh-CN';

// The key set is whatever zh-CN defines; a key missing from another locale is a type error in that locale's file
export type MsgKey = keyof typeof zhCN;
