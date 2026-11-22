'use client';

import { useRef, type PointerEvent } from 'react';
import styles from './access.module.css';

// Изометрическая проекция раскрытого атласа. Каждая линия построена на
// одном развороте, поэтому сетка следует корешку и загибам страниц.
function point(x: number, y: number, layer: number): string {
  const rise = 62 * Math.sin(Math.PI * Math.abs(x)) + 24 * x * x + 8 * Math.sin(y * Math.PI) * x;
  return [288 + 175 * x - 118 * (y - 0.5), 183 + 34 * x + 88 * (y - 0.5) - rise + layer].map(n => n.toFixed(2)).join(',');
}

function curve(axis: 'across' | 'along', value: number, layer = 0): string {
  return Array.from({ length: 65 }, (_, i) => {
    const t = i / 64;
    return (i === 0 ? 'M' : 'L') + (axis === 'across' ? point(t * 2 - 1, value, layer) : point(value, t, layer));
  }).join(' ');
}

function sheet(layer: number): string {
  return curve('across', 0, layer) + ' ' + Array.from({ length: 65 }, (_, i) => 'L' + point(1 - i / 32, 1, layer)).join(' ') + 'Z';
}

export function Atlas(): React.JSX.Element {
  const ref = useRef<SVGSVGElement>(null);
  function tilt(event: PointerEvent<SVGSVGElement>): void {
    if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--roll', ((event.clientX - box.left) / box.width * 6 - 3) + 'deg');
    event.currentTarget.style.setProperty('--lift', ((event.clientY - box.top) / box.height * 8 - 4) + 'px');
  }
  function reset(): void {
    ref.current?.style.removeProperty('--roll');
    ref.current?.style.removeProperty('--lift');
  }
  return (
    <svg ref={ref} className={styles.atlas} viewBox="0 0 576 315" onPointerMove={tilt} onPointerLeave={reset} aria-hidden="true">
      <g className={styles.book} strokeLinejoin="round">
        {[24, 20, 16, 12, 8, 4, 0].map(depth => (
          <path key={depth} d={sheet(depth)} fill="var(--page-blue)" stroke="var(--page-line)" strokeWidth="1.35" />
        ))}
        <g fill="none" stroke="var(--page-line)" strokeWidth="1.2">
          {Array.from({ length: 25 }, (_, i) => <path key={i} d={curve('along', i / 12 - 1)} />)}
          {Array.from({ length: 13 }, (_, i) => <path key={i} d={curve('across', i / 12)} />)}
        </g>
      </g>
    </svg>
  );
}
