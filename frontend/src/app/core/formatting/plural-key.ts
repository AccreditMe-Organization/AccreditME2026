// ACC-94 — the keys FormatService.count() and amCount accept: every dotted path
// to a counted string in en.json's "plural" section. Derived at compile time,
// so a mistyped or removed key fails ng build. Type-only: the JSON is never
// bundled by this import.
import type en from '../../../assets/i18n/en.json';

type PluralLeaf = { other: string };

type PluralPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends PluralLeaf ? `${Prefix}${K}` : PluralPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

type PluralSection = typeof en extends { plural: infer P } ? P : never;

export type PluralKey = [PluralSection] extends [never] ? never : PluralPaths<PluralSection>;
