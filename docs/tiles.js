// SVG tile faces (no image assets). Exposes window.TileArt.face(kind) -> svg markup.
(function () {
  const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const WIND = ['東', '南', '西', '北'];
  const RED = '#c62828', GREEN = '#1b7a3a', BLUE = '#1e4f9c', INK = '#1d2433';
  const FONT = `font-family="'Noto Serif CJK SC','Songti SC','SimSun','PingFang SC','Hiragino Mincho ProN',serif" font-weight="700" text-anchor="middle"`;

  const DOTS = {
    1: [[15, 20, 9]],
    2: [[15, 11, 5.5], [15, 29, 5.5]],
    3: [[8, 9, 4.6], [15, 20, 4.6], [22, 31, 4.6]],
    4: [[9, 11, 5], [21, 11, 5], [9, 29, 5], [21, 29, 5]],
    5: [[8, 9, 4.4], [22, 9, 4.4], [15, 20, 4.4], [8, 31, 4.4], [22, 31, 4.4]],
    6: [[9, 8, 4.2], [21, 8, 4.2], [9, 20, 4.2], [21, 20, 4.2], [9, 32, 4.2], [21, 32, 4.2]],
    7: [[7, 6, 3.5], [15, 9.5, 3.5], [23, 13, 3.5], [9, 24, 3.7], [21, 24, 3.7], [9, 33, 3.7], [21, 33, 3.7]],
    8: [[9, 6, 3.6], [21, 6, 3.6], [9, 15.3, 3.6], [21, 15.3, 3.6], [9, 24.7, 3.6], [21, 24.7, 3.6], [9, 34, 3.6], [21, 34, 3.6]],
    9: [[7, 8, 3.6], [15, 8, 3.6], [23, 8, 3.6], [7, 20, 3.6], [15, 20, 3.6], [23, 20, 3.6], [7, 32, 3.6], [15, 32, 3.6], [23, 32, 3.6]],
  };
  const dotColor = (n, i) => {
    if (n === 1) return RED;
    if (n === 3 || n === 5 || n === 9) return [BLUE, RED, GREEN][Math.floor(i / (n === 9 ? 3 : 1)) % 3];
    if (n === 7) return i < 3 ? GREEN : RED;
    return [BLUE, GREEN][i % 2];
  };

  // bamboo sticks: [cx, cy, height, color?]
  const STICKS = {
    2: [[15, 11], [15, 29]],
    3: [[15, 11], [9, 29], [21, 29]],
    4: [[9, 11], [21, 11], [9, 29], [21, 29]],
    5: [[8, 11], [22, 11], [15, 20, 0, RED], [8, 29], [22, 29]],
    6: [[7, 11], [15, 11], [23, 11], [7, 29], [15, 29], [23, 29]],
    7: [[15, 7, 9, RED], [7, 20, 9], [15, 20, 9], [23, 20, 9], [7, 33, 9], [15, 33, 9], [23, 33, 9]],
    8: [[6, 11], [12, 11], [18, 11], [24, 11], [6, 29], [12, 29], [18, 29], [24, 29]],
    9: [[7, 8, 10, RED], [15, 8, 10, BLUE], [23, 8, 10, RED], [7, 20, 10, RED], [15, 20, 10, BLUE], [23, 20, 10, RED], [7, 32, 10, RED], [15, 32, 10, BLUE], [23, 32, 10, RED]],
  };

  function stick(cx, cy, h, color) {
    h = h || 13; color = color || GREEN;
    const w = 4;
    return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="2" fill="${color}"/>` +
      `<line x1="${cx - w / 2}" y1="${cy}" x2="${cx + w / 2}" y2="${cy}" stroke="#fff" stroke-width="0.8"/>`;
  }

  function body(k) {
    if (k < 9) {
      return `<text x="15" y="17" font-size="14" fill="${INK}" ${FONT}>${NUM[k]}</text>` +
        `<text x="15" y="36" font-size="15" fill="${RED}" ${FONT}>萬</text>`;
    }
    if (k < 18) {
      const n = k - 8;
      return DOTS[n].map(([x, y, r], i) => {
        const c = dotColor(n, i);
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="${r > 6 ? 2 : 1.5}"/>` +
          `<circle cx="${x}" cy="${y}" r="${r * 0.42}" fill="${c}"/>`;
      }).join('');
    }
    if (k < 27) {
      const n = k - 17;
      if (n === 1) {
        // the "one bamboo" is traditionally a bird: a simple stylised one
        return `<ellipse cx="15" cy="22" rx="8" ry="10" fill="${GREEN}"/>` +
          `<circle cx="15" cy="12" r="4.5" fill="${GREEN}"/><circle cx="16.2" cy="11" r="1" fill="#fff"/>` +
          `<path d="M19 12 l4 1.2 l-4 1.2z" fill="${RED}"/>` +
          `<path d="M11 29 l-3 6 M15 31 v5 M19 29 l3 6" stroke="${RED}" stroke-width="1.8" stroke-linecap="round"/>` +
          `<path d="M10 20 q5 6 10 0" stroke="#fff" stroke-width="1" fill="none"/>`;
      }
      return STICKS[n].map(([x, y, h, c]) => stick(x, y, h, c)).join('');
    }
    if (k < 31) return `<text x="15" y="28.5" font-size="19" fill="${INK}" ${FONT}>${WIND[k - 27]}</text>`;
    if (k === 31) return `<text x="15" y="28.5" font-size="20" fill="${RED}" ${FONT}>中</text>`;
    if (k === 32) return `<text x="15" y="28.5" font-size="19" fill="${GREEN}" ${FONT}>發</text>`;
    return `<rect x="6" y="7" width="18" height="26" rx="2" fill="none" stroke="${BLUE}" stroke-width="2"/>` +
      `<rect x="9" y="10" width="12" height="20" rx="1" fill="none" stroke="${BLUE}" stroke-width="0.8"/>`;
  }

  const cache = {};
  window.TileArt = {
    face(k) {
      if (!cache[k]) cache[k] = `<svg viewBox="0 0 30 40" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${body(k)}</svg>`;
      return cache[k];
    },
    windChar: (k) => WIND[k - 27],
  };
})();
