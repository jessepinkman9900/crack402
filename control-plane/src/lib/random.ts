import { nanoid } from "nanoid";

export interface Random {
  id(prefix: string): string;
  float(): number;
  int(min: number, max: number): number;
}

export const realRandom: Random = {
  id: (prefix: string) => `${prefix}${nanoid(20)}`,
  float: () => Math.random(),
  int: (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min,
};
