// Copyright year
document.getElementById('year').textContent = new Date().getFullYear();

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---- Reveals ---------------------------------------------------------------
// The intro fades up as soon as the page is there. The Experience list waits
// to be scrolled to and arrives a block at a time, the blocks that land
// together stepping in one after another rather than all at once.
const show = (el, delay = 0) => {
  el.style.setProperty('--reveal-delay', `${Math.round(delay)}ms`);
  el.classList.add('is-in');
};

const intro = document.querySelector('.copy.reveal');
if (intro) {
  // Commit the hidden state first, so this reads as a fade rather than the
  // text simply being there. Reading a layout property forces that
  // synchronously — a frame or a timer can be too late in a tab that is not
  // drawing yet.
  void intro.offsetHeight;
  show(intro, reducedMotion.matches ? 0 : 160);
}

const blocks = document.querySelectorAll('.experience .reveal');

if (blocks.length) {
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    blocks.forEach((el) => show(el));
  } else {
    void document.body.offsetHeight;

    // If nothing is ever reported back — a browser or an embedded view where
    // intersections never fire — the list must not stay invisible. Anyone
    // actually scrolling will have seen it arrive long before this.
    let reported = false;
    const watchdog = setTimeout(() => {
      if (reported) return;
      observer.disconnect();
      blocks.forEach((el) => show(el));
    }, 3000);

    const observer = new IntersectionObserver(
      (entries) => {
        reported = true;
        clearTimeout(watchdog);
        entries
          .filter((entry) => entry.isIntersecting)
          // Top of the page first, so a batch arriving together reads downward.
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
          .forEach((entry, i) => {
            show(entry.target, i * 90);
            observer.unobserve(entry.target);
          });
      },
      // A little way into view, so a block is clearly on screen before it moves.
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );

    blocks.forEach((el) => observer.observe(el));
  }
}

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
