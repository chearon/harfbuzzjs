declare namespace HarfbuzzJsInit {
  type HbBlob = {
    destroy(): void;
    ptr: number;
  };

  type HbFace = {
    upem: number;
    destroy(): void;
    ptr: number;
    name: string;
    reference_table(name: string): Uint8Array;
  };

  type HbFontMetrics = {
    ascender: number,
    descender: number,
    lineGap: number
    superscript: number,
    subscript: number,
    xHeight: number
  };

  type HbFont = {
    ptr: number;
    glyphToPath(gid: number): string;
    glyphToJson(gid: number): {type: string, values: number[]}[];
    setScale(xScale: number, yScale: number): void;
    getMetrics(dir: 'ltr' | 'rtl' | 'ttb' | 'btt'): HbFontMetrics;
    destroy(): void;
  };

  type HbFlags = 'BOT'
    | 'EOT'
    | 'PRESERVE_DEFAULT_IGNORABLES'
    | 'REMOVE_DEFAULT_IGNORABLES'
    | 'PRODUCE_UNSAFE_TO_CONCAT'
    | 'DO_NOT_INSERT_DOTTED_CIRCLE';

  type HbGlyphInfo = {
    g: number,
    cl: number,
    ax: number,
    ay: number,
    dx: number,
    dy: number,
    flags: number
  };

  type HbBuffer = {
    ptr: number,
    addText(text: string): void;
    guessSegmentProperties(): void;
    setDirection(dir: 'ltr' | 'rtl' | 'ttb' | 'btt'): void;
    getDirection(): number,
    setFlags(flags: HbFlags[]): void;
    setLanguage(lang: string): void;
    setScript(script: string): void;
    setClusterLevel(level: number): void;
    json(): HbGlyphInfo[];
    reverse(): void;
  };

  type Harfbuzz = {
    createBlob(buffer: ArrayBuffer): HbBlob,
    createFace(blob: HbBlob, index: number): HbFace,
    createFont(face: HbFace): HbFont,
    createBuffer(): HbBuffer,
    shape(font: HbFont, buffer: HbBuffer): void;
  };
}

declare const HarfbuzzJsInit: Promise<HarfbuzzJsInit.Harfbuzz>;

export = HarfbuzzJsInit;
