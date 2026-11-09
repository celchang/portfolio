// Copyright year
document.getElementById('year').textContent = new Date().getFullYear();

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Easter egg: hovering the name turns the dot into a shifting organic blob.
// The outline is a circle whose radius is nudged by several drifting sine
// waves (2–5 lobes each), traced as a clip-path polygon. Leaving eases it back
// into a circle.
const brand = document.querySelector('.brand');
const dot = document.querySelector('.brand-dot');

if (brand && dot) {
  const CENTER = 18; // half of the 36px .brand-dot box
  const RADIUS = 12; // resting 24px circle
  const POINTS = 72;

  const waves = [
    { lobes: 2, strength: 0.09 },
    { lobes: 3, strength: 0.07 },
    { lobes: 4, strength: 0.06 },
    { lobes: 5, strength: 0.04 },
  ].map((w, i) => ({
    ...w,
    phase: Math.random() * Math.PI * 2,
    speed: (0.0008 + Math.random() * 0.0008) * (i % 2 ? -1 : 1),
  }));

  let target = 0;
  let amount = 0;
  let frame = null;
  let last = 0;

  const render = (now) => {
    const dt = last ? now - last : 16;
    last = now;
    amount += (target - amount) * (1 - Math.exp(-dt / 180));

    if (target === 0 && amount < 0.002) {
      dot.style.clipPath = '';
      frame = null;
      last = 0;
      return;
    }

    const points = [];
    for (let i = 0; i < POINTS; i++) {
      const angle = (i / POINTS) * Math.PI * 2;
      let wobble = 0.03; // slight overall growth
      for (const w of waves) {
        wobble += w.strength * Math.sin(w.lobes * angle + w.phase + now * w.speed);
      }
      const r = RADIUS * (1 + amount * wobble);
      const x = CENTER + r * Math.cos(angle);
      const y = CENTER + r * Math.sin(angle);
      points.push(`${x.toFixed(2)}px ${y.toFixed(2)}px`);
    }

    dot.style.clipPath = `polygon(${points.join(',')})`;
    frame = requestAnimationFrame(render);
  };

  const setActive = (active) => {
    if (reducedMotion.matches) return;
    target = active ? 1 : 0;
    if (!frame) frame = requestAnimationFrame(render);
  };

  brand.addEventListener('pointerenter', () => setActive(true));
  brand.addEventListener('pointerleave', () => setActive(false));
  brand.addEventListener('focus', () => setActive(true));
  brand.addEventListener('blur', () => setActive(false));
}
