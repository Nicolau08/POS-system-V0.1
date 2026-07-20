'use client';

import { useCallback, useEffect, useRef } from 'react';

export function useFamiliesDragScroll() {
  const familiesScrollRef = useRef<HTMLDivElement | null>(null);
  const familiesMomentumFrameRef = useRef<number | null>(null);
  const familiesDragStateRef = useRef({
    isDragging: false,
    pointerId: null as number | null,
    startX: 0,
    lastX: 0,
    startScrollLeft: 0,
    lastMoveTime: 0,
    velocity: 0,
    moved: false,
  });

  useEffect(() => {
    const node = familiesScrollRef.current;
    if (!node) return;

    const stopMomentum = () => {
      if (familiesMomentumFrameRef.current !== null) {
        window.cancelAnimationFrame(familiesMomentumFrameRef.current);
        familiesMomentumFrameRef.current = null;
      }
    };

    const handleWheel = (event: WheelEvent) => {
      stopMomentum();
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        node.scrollLeft += event.deltaY;
      } else if (event.deltaX !== 0) {
        event.preventDefault();
        node.scrollLeft += event.deltaX;
      }
    };

    node.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      stopMomentum();
      node.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const stopFamiliesMomentum = useCallback(() => {
    if (familiesMomentumFrameRef.current !== null) {
      window.cancelAnimationFrame(familiesMomentumFrameRef.current);
      familiesMomentumFrameRef.current = null;
    }
  }, []);

  const startFamiliesMomentum = useCallback(
    (initialVelocity: number) => {
      const node = familiesScrollRef.current;
      if (!node) return;

      stopFamiliesMomentum();

      let velocity = initialVelocity;

      const step = () => {
        if (Math.abs(velocity) < 0.2) {
          familiesMomentumFrameRef.current = null;
          return;
        }

        node.scrollLeft -= velocity;
        velocity *= 0.94;
        familiesMomentumFrameRef.current = window.requestAnimationFrame(step);
      };

      familiesMomentumFrameRef.current = window.requestAnimationFrame(step);
    },
    [stopFamiliesMomentum],
  );

  const handleFamiliesPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const node = familiesScrollRef.current;
      if (!node) return;

      stopFamiliesMomentum();
      familiesDragStateRef.current = {
        isDragging: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        lastX: event.clientX,
        startScrollLeft: node.scrollLeft,
        lastMoveTime: performance.now(),
        velocity: 0,
        moved: false,
      };
    },
    [stopFamiliesMomentum],
  );

  const handleFamiliesPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const node = familiesScrollRef.current;
    const state = familiesDragStateRef.current;
    if (!node || !state.isDragging || state.pointerId !== event.pointerId) return;

    const delta = event.clientX - state.startX;
    const movement = event.clientX - state.lastX;
    const now = performance.now();
    const elapsed = Math.max(now - state.lastMoveTime, 1);

    if (Math.abs(delta) > 4) {
      if (!state.moved) {
        node.setPointerCapture(event.pointerId);
      }
      state.moved = true;
    }

    state.velocity = (movement / elapsed) * 16;
    state.lastX = event.clientX;
    state.lastMoveTime = now;
    node.scrollLeft = state.startScrollLeft - delta;
  }, []);

  const handleFamiliesPointerRelease = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const node = familiesScrollRef.current;
      const state = familiesDragStateRef.current;
      if (!node || state.pointerId !== event.pointerId) return;

      if (node.hasPointerCapture(event.pointerId)) {
        node.releasePointerCapture(event.pointerId);
      }

      familiesDragStateRef.current = {
        ...state,
        isDragging: false,
        pointerId: null,
      };

      if (state.moved) {
        startFamiliesMomentum(state.velocity);
      }
    },
    [startFamiliesMomentum],
  );

  return {
    familiesScrollRef,
    familiesDragStateRef,
    handleFamiliesPointerDown,
    handleFamiliesPointerMove,
    handleFamiliesPointerRelease,
  };
}
