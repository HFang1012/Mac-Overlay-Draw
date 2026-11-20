// The tools Pane holds, and Away's moods. Shared by the settings window, the Away screen and the main
// process, so names, glyphs and colors come from one place.
(function () {
  // Each tool keeps its own colors: Scrawl's eraser pink on graphite, Away's lilac and apricot on plum.
  const C = { ink: '#2B2733', inkLip: '#16131C', accent: '#B9A5F4', accentLip: '#8E76DC', peach: '#FFC593', peachLip: '#E39C60' };
  const SC = { ink: '#262B36', inkLip: '#0F1218', pink: '#F49CB0', pinkLip: '#D96F8A' };

  // Chunky glyphs: a flat shape over a darker copy of itself, nudged down (the "lip").
  const lip = (shape, fill, under, dy) => `<g transform="translate(0 ${dy})" fill="${under}" stroke="${under}">${shape}</g><g fill="${fill}" stroke="${fill}">${shape}</g>`;

  const GLYPHS = {
    // Scrawl's loop, ending where the pen touches down.
    scrawl: {
      viewBox: '200 270 640 470',
      body: () => {
        const loop = '<path d="M262 640 C372 640 480 590 506 470 C526 372 456 306 392 334 C318 366 326 492 424 566 C508 628 628 628 690 548 C716 514 734 474 746 436" fill="none" stroke-width="78" stroke-linecap="round" stroke-linejoin="round" class="scribble" stroke-dasharray="1400"/>';
        return lip(loop, SC.pink, SC.pinkLip, 30) + `<circle cx="752" cy="444" r="74" fill="${SC.inkLip}"/><circle cx="752" cy="414" r="74" fill="${SC.ink}"/>`;
      },
    },
    // Away: a cup on its saucer, steam curling up. You've gone to get coffee.
    away: {
      viewBox: '0 0 60 44',
      body: () => {
        const cup = '<path d="M12 17 H40 V27 Q40 37 30 37 H22 Q12 37 12 27 Z" stroke="none"/><path d="M39 19.5 h3.5 a5.5 5.5 0 0 1 0 11 h-4 v-4 h4 a1.5 1.5 0 0 0 0 -3 h-3.5 z" stroke="none"/>';
        const saucer = '<rect x="7" y="36" width="38" height="5" rx="2.5" stroke="none"/>';
        const steam = '<g class="steam" fill="none" stroke-width="3.4" stroke-linecap="round"><path d="M21 12 q-3 -3 0 -6 t0 -6" class="s1"/><path d="M31 12 q-3 -3 0 -6 t0 -6" class="s2"/></g>';
        return `<g transform="translate(0 3)">${steam.replace('class="steam"', `class="steam" stroke="${C.accentLip}"`)}</g>` +
          steam.replace('class="steam"', `class="steam" stroke="${C.accent}"`) +
          lip(saucer, C.ink, C.inkLip, 2) + lip(cup, C.peach, C.peachLip, 3);
      },
    },
  };
  function glyph(id, h = 22) {
    const g = GLYPHS[id];
    const [, , vw, vh] = g.viewBox.split(' ').map(Number);
    return `<svg class="glyph-${id}" width="${((h * vw) / vh).toFixed(1)}" height="${h}" viewBox="${g.viewBox}" aria-hidden="true" overflow="visible">${g.body()}</svg>`;
  }

  const TOOLS = [
    { id: 'scrawl', name: 'Scrawl', blurb: 'Draw on your screen.', theme: 'scrawl', bg: '#E3E8EF' },
    { id: 'away', name: 'Away', blurb: 'Blur your screen while you’re away.', theme: 'away', bg: '#ECE6DD' },
  ];

  // Away's gradient blobs. Each mood is three soft colors that drift behind the blur.
  const MOODS = [
    { id: 'dusk', name: 'Dusk', colors: ['#B9A5F4', '#FFB38A', '#F3A6CB'] },
    { id: 'sea', name: 'Sea', colors: ['#7CC4E8', '#8EE0C6', '#A3A9F6'] },
    { id: 'grove', name: 'Grove', colors: ['#A6D98C', '#F2DC86', '#7ACFB6'] },
    { id: 'ember', name: 'Ember', colors: ['#FF9C78', '#FFD07A', '#F28CA6'] },
    { id: 'mist', name: 'Mist', colors: ['#CFC6DE', '#E8DECF', '#B9C6D2'] },
  ];
  const mood = (id) => MOODS.find((m) => m.id === id) || MOODS[0];

  const DEFAULT_MESSAGE = 'I’m away from my computer right now.';

  const api = { TOOLS, MOODS, mood, glyph, DEFAULT_MESSAGE, COLORS: C };
  if (typeof window !== 'undefined') window.Tools = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
