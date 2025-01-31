import { Pane } from 'https://cdn.skypack.dev/tweakpane@4.0.4';
import gsap from 'https://cdn.skypack.dev/gsap@3.12.0';
import ScrollTrigger from 'https://cdn.skypack.dev/gsap@3.12.0/ScrollTrigger';

// ✅ Register the ScrollTrigger plugin before using it
gsap.registerPlugin(ScrollTrigger);

const config = {
  theme: 'dark',
  animate: true,
  snap: true,
  start: gsap.utils.random(0, 1000, 1), // 🎨 Initial hue
  end: gsap.utils.random(900, 1000, 1),  // 🎨 Final hue
  scroll: true,
  debug: false,
};

const ctrl = new Pane({
  title: 'Accessibility',
  expanded: false,
});

let items, scrollerScrub, dimmerScrub, chromaEntry, chromaExit;

const update = () => {
  document.documentElement.dataset.theme = config.theme;
  document.documentElement.dataset.syncScrollbar = config.scroll;
  document.documentElement.dataset.animate = config.animate;
  document.documentElement.dataset.snap = config.snap;
  document.documentElement.dataset.debug = config.debug;
  document.documentElement.style.setProperty('--start', config.start);
  document.documentElement.style.setProperty('--hue', config.start);
  document.documentElement.style.setProperty('--end', config.end);

  if (!config.animate) {
    chromaEntry?.scrollTrigger?.disable(true, false);
    chromaExit?.scrollTrigger?.disable(true, false);
    dimmerScrub?.disable(true, false);
    scrollerScrub?.disable(true, false);

    gsap.set(items, { opacity: 1 });
    gsap.set(document.documentElement, { '--chroma': 0 });
  } else {
    gsap.set(items, { opacity: (i) => (i !== 0 ? 0.2 : 1) });

    dimmerScrub?.enable(true, true);
    scrollerScrub?.enable(true, true);
    chromaEntry?.scrollTrigger?.enable(true, true);
    chromaExit?.scrollTrigger?.enable(true, true);
  }
};

const sync = (event) => {
  if (
    !document.startViewTransition ||
    event.target.controller.view.labelElement.innerText !== 'Theme'
  ) return update();
  
  document.startViewTransition(() => update());
};

// ✅ Config Panel Bindings
//ctrl.addBinding(config, 'animate', { label: 'Animate' });
//ctrl.addBinding(config, 'snap', { label: 'Snap' });
//ctrl.addBinding(config, 'start', { label: 'Hue Start', min: 0, max: 1000, step: 1 });
//ctrl.addBinding(config, 'end', { label: 'Hue End', min: 0, max: 1000, step: 1 });
ctrl.addBinding(config, 'scroll', { label: 'Scrollbar' });
//ctrl.addBinding(config, 'debug', { label: 'Debug' });

ctrl.addBinding(config, 'theme', {
  label: 'Theme',
  options: { System: 'system', Light: 'light', Dark: 'dark' },
});

ctrl.on('change', sync);

// ✅ Ensure animations run only after DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  items = gsap.utils.toArray('ul li');

  // ✅ Check if <li> elements exist before running animations
  if (items.length === 0) {
    console.warn("No <li> elements found! Skipping animations.");
    return;
  }

  gsap.set(items, { opacity: (i) => (i !== 0 ? 0.2 : 1) });

  const dimmer = gsap.timeline()
    .to(items.slice(1), { opacity: 1, stagger: 0.5 })
    .to(items.slice(0, items.length - 1), { opacity: 0.2, stagger: 0.5 }, 0);

  dimmerScrub = ScrollTrigger.create({
    trigger: items[0],
    endTrigger: items[items.length - 1],
    start: 'top center',
    end: 'bottom center',
    animation: dimmer,
    scrub: 0.2,
  });

  ScrollTrigger.create({
    trigger: items[0],
    endTrigger: items[items.length - 1],
    start: 'top center',
    end: 'bottom center',
    scrub: 0.2,
    onUpdate: (self) => {
        let hueValue = config.start + (config.end - config.start) * self.progress;
        document.documentElement.style.setProperty('--hue', hueValue);

        // ✅ Force `li` elements to reapply color
        items.forEach(li => {
            li.style.color = `oklch(var(--lightness) var(--base-chroma) ${hueValue})`;
        });
    }
});

  if (items.length > 1) {
    chromaEntry = gsap.fromTo(
      document.documentElement,
      { '--chroma': 0 },
      { '--chroma': 0.3, ease: 'none', scrollTrigger: {
          scrub: 0.2,
          trigger: items[0], 
          start: 'top center+=40', 
          end: 'top center' 
        }
      }
    );
  }

  // ✅ Now, run update() only after everything is initialized
  update();
});
