// Draws a 1080×1350 (Instagram portrait) trade card on a canvas using the current theme colours.

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function drawCrosshair(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.09;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.36, 0, Math.PI * 2); ctx.stroke();
  const g = size * 0.14, o = size * 0.5;
  [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
    ctx.beginPath(); ctx.moveTo(cx + dx * g, cy + dy * g); ctx.lineTo(cx + dx * o, cy + dy * o); ctx.stroke();
  });
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx + size * 0.06, cy - size * 0.04, size * 0.06, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/**
 * card: { headline, sub, rows: [[label, value]], tags: [], footer, tone: 'pos'|'neg'|'' , big, bigLabel }
 * c: theme colours { bg, surface, surface2, ink, ink2, mute, accent, accent2, accentInk, profit, loss }
 */
export function drawShareCard(canvas, card, c, fonts) {
  const W = 1080, H = 1350;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const F = (w, s, fam = fonts.num) => `${w} ${s}px ${fam}`;

  // Background with soft glows
  ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
  const glow = (x, y, r, col) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
  glow(80, 60, 760, c.accentGlow); glow(W, 0, 620, c.accent2Glow);
  glow(W / 2, H + 200, 700, card.tone === 'neg' ? c.lossGlow : c.profitGlow);

  // Brand
  const bx = 88, by = 96;
  const grad = ctx.createLinearGradient(bx, by, bx + 72, by + 72);
  grad.addColorStop(0, c.accent); grad.addColorStop(1, c.accent2);
  ctx.fillStyle = grad; rr(ctx, bx, by, 72, 72, 20); ctx.fill();
  drawCrosshair(ctx, bx + 36, by + 36, 46, c.accentInk);
  ctx.fillStyle = c.ink; ctx.font = F('700', 40, fonts.body); ctx.textBaseline = 'middle';
  ctx.fillText('Windage', bx + 96, by + 36);
  ctx.textAlign = 'right'; ctx.fillStyle = c.mute; ctx.font = F('500', 30, fonts.body);
  ctx.fillText(card.date, W - 88, by + 36);
  ctx.textAlign = 'left';

  // Headline (e.g. "NQ Long · Silver Bullet")
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.ink2; ctx.font = F('600', 46, fonts.body);
  ctx.fillText(card.headline, 88, 330);
  ctx.fillStyle = c.mute; ctx.font = F('500', 32, fonts.body);
  ctx.fillText(card.sub, 88, 382);

  // Big number
  const tone = card.tone === 'pos' ? c.profit : card.tone === 'neg' ? c.loss : c.ink;
  ctx.fillStyle = tone;
  let size = 240; ctx.font = F('700', size);
  while (ctx.measureText(card.big).width > W - 176 && size > 120) { size -= 10; ctx.font = F('700', size); }
  ctx.fillText(card.big, 80, 400 + size * 0.95);
  ctx.fillStyle = c.mute; ctx.font = F('500', 32, fonts.body);
  ctx.fillText(card.bigLabel, 88, 400 + size * 0.95 + 64);

  // Stat tiles
  const top = 860, gap = 20, cols = 3, tw = (W - 176 - gap * (cols - 1)) / cols, th = 150;
  card.rows.slice(0, 6).forEach(([label, value, vt], i) => {
    const x = 88 + (i % cols) * (tw + gap), y = top + Math.floor(i / cols) * (th + gap);
    ctx.fillStyle = c.surfaceA; rr(ctx, x, y, tw, th, 24); ctx.fill();
    ctx.fillStyle = c.mute; ctx.font = F('500', 26, fonts.body); ctx.fillText(label, x + 28, y + 52);
    ctx.fillStyle = vt === 'pos' ? c.profit : vt === 'neg' ? c.loss : c.ink;
    let fs = 46; ctx.font = F('700', fs);
    while (ctx.measureText(value).width > tw - 56 && fs > 24) { fs -= 2; ctx.font = F('700', fs); }
    ctx.fillText(value, x + 28, y + 112);
  });

  // Footer
  ctx.fillStyle = c.line; ctx.fillRect(88, H - 150, W - 176, 2);
  ctx.fillStyle = c.mute; ctx.font = F('500', 28, fonts.body);
  ctx.fillText(card.footer, 88, H - 92);
  ctx.textAlign = 'right'; ctx.fillStyle = c.accent; ctx.font = F('600', 28, fonts.body);
  ctx.fillText('Read the wind. Adjust your aim.', W - 88, H - 92);
  ctx.textAlign = 'left';
}
