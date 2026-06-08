export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  primaryText: string;
  secondaryText?: string;
  style: string;
  layer: number;
}

export interface AssStyle {
  name: string;
  fontName: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  backColor: string;
  bold: boolean;
  italic: boolean;
  marginL: number;
  marginR: number;
  marginV: number;
  alignment: number;
}

export interface AssDocument {
  title: string;
  styles: AssStyle[];
  cues: SubtitleCue[];
}
