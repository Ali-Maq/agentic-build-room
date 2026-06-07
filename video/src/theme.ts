// Atelier palette, tuned for screen/video (a warm charcoal stage so the paper
// text + forest-green accent pop), and the project's real fonts.
import { loadFont as loadFraunces } from '@remotion/google-fonts/Fraunces';
import { loadFont as loadHanken } from '@remotion/google-fonts/HankenGrotesk';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

export const fraunces = loadFraunces().fontFamily; // display / brand
export const hanken = loadHanken().fontFamily; // UI / body
export const mono = loadMono().fontFamily; // code

export const C = {
  bg: '#15130F', // warm charcoal stage
  bg2: '#1E1B16',
  panel: '#211D17',
  line: '#3A352C',
  paper: '#FBFAF8',
  ink: '#F3F0E9',
  inkSoft: '#B7B0A3',
  faint: '#827B6E',
  green: '#46B17E', // forest accent (brighter for video)
  greenDeep: '#2E6F4E',
  amber: '#E0A94B',
  blue: '#7FB3FF',
  ai: '#C3A8FF',
};
