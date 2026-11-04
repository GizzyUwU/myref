declare module "citeproc" {
  export type CslItem = Record<string, unknown>;

  export interface CiteprocSystem {
    retrieveLocale: (lang: string) => string;
    retrieveItem: (id: string) => CslItem;
  }

  export interface BibliographyMeta {
    entry_ids: string[][];
    [key: string]: unknown;
  }

  export type Bibliography = [BibliographyMeta, string[]];

  export class Engine {
    constructor(
      sys: CiteprocSystem,
      style: string,
      lang?: string,
      forceLang?: boolean,
    );
    updateItems(ids: string[]): void;
    makeBibliography(): Bibliography | false;
    makeCitationCluster(
      items: Array<{ id: string; locator?: string; label?: string }>,
    ): string;
    setOutputFormat(format: "html" | "text" | "rtf"): void;
  }

  const CSL: {
    Engine: typeof Engine;
  };

  export default CSL;
}
