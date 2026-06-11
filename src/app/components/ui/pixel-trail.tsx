import React, { useCallback, useMemo, useRef } from 'react';
import { motion, useAnimationControls } from 'motion/react';
import { v4 as uuidv4 } from 'uuid';

import { useDimensions } from '../hooks/use-debounced-dimensions';

interface PixelTrailProps {
  pixelSize?: number;
  fadeDuration?: number;
  delay?: number;
  className?: string;
  pixelClassName?: string;
  /** Optional external onMouseMove handler — lets the parent section
   *  own pointer events so the trail layer itself stays pointer-events-none,
   *  preventing it from blocking clicks on buttons/cards beneath it.
   *  Pass the handler ref returned by usePixelTrailHandlers(). */
  onMouseMoveRef?: React.RefObject<((e: MouseEvent) => void) | null>;
}

/**
 * Returns a stable ref you can attach to a parent element's onMouseMove.
 * The trail container becomes fully pointer-events-none so buttons beneath
 * it remain clickable.
 */
export function usePixelTrailHandlers(
  containerRef: React.RefObject<HTMLDivElement | null>,
  pixelSize: number,
  trailId: string,
) {
  return useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / pixelSize);
      const y = Math.floor((e.clientY - rect.top) / pixelSize);
      const el = document.getElementById(`${trailId}-pixel-${x}-${y}`);
      if (el) {
        const animate = (el as unknown as { __animatePixel?: () => void }).__animatePixel;
        if (animate) animate();
      }
    },
    [containerRef, pixelSize, trailId],
  );
}

export const PixelTrail: React.FC<PixelTrailProps> = ({
  pixelSize = 40,
  fadeDuration = 600,
  delay = 100,
  className,
  pixelClassName,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dimensions = useDimensions(containerRef);
  const trailId = useRef(uuidv4()).current;

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / pixelSize);
      const y = Math.floor((e.clientY - rect.top) / pixelSize);
      const el = document.getElementById(`${trailId}-pixel-${x}-${y}`);
      if (el) {
        const animate = (el as unknown as { __animatePixel?: () => void }).__animatePixel;
        if (animate) animate();
      }
    },
    [pixelSize, trailId],
  );

  const columns = useMemo(() => Math.ceil(dimensions.width  / pixelSize), [dimensions.width,  pixelSize]);
  const rows    = useMemo(() => Math.ceil(dimensions.height / pixelSize), [dimensions.height, pixelSize]);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className={`absolute inset-0 w-full h-full overflow-hidden ${className ?? ''}`}
      /*
       * CRITICAL: pointer-events-none on the container so this layer never
       * blocks clicks on buttons, cards, or links that sit visually above it.
       * The section element (the parent) forwards mouse coordinates here via
       * the onMouseMove handler; the hit-test is done manually by ID lookup,
       * so no DOM events need to bubble through this layer.
       */
      style={{ pointerEvents: 'none' }}
    >
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} style={{ display: 'flex' }}>
          {Array.from({ length: columns }).map((_, col) => (
            <PixelDot
              key={`${col}-${row}`}
              id={`${trailId}-pixel-${col}-${row}`}
              size={pixelSize}
              fadeDuration={fadeDuration}
              delay={delay}
              className={pixelClassName}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

interface PixelDotProps {
  id: string;
  size: number;
  fadeDuration: number;
  delay: number;
  className?: string;
}

const PixelDot: React.FC<PixelDotProps> = React.memo(({ id, size, fadeDuration, delay, className }) => {
  const controls = useAnimationControls();

  const animatePixel = useCallback(() => {
    controls.start({
      opacity: [1, 0],
      transition: { duration: fadeDuration / 1000, delay: delay / 1000 },
    });
  }, [controls, fadeDuration, delay]);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        (node as unknown as { __animatePixel: () => void }).__animatePixel = animatePixel;
      }
    },
    [animatePixel],
  );

  return (
    <motion.div
      id={id}
      ref={ref}
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
      initial={{ opacity: 0 }}
      animate={controls}
    />
  );
});

PixelDot.displayName = 'PixelDot';
