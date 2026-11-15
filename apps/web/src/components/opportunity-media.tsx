"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { drawMosaic } from "@/lib/mosaic";
import { loadSatellite } from "@/lib/opportunity-satellite";
import { opportunityImageRevision } from "@/lib/opportunity-preview-revision";

type OpportunityMediaProps = {
  slug: string;
};

const HOVER_INTENT_MS = 90;
/** Whole transition, locator to satellite. A half way reversal takes half as long. */
const TRANSITION_MS = 760;
const MAX_CANVAS_PX = 720;

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/**
 * A card's picture. At rest it is the drawn locator (cheap, and every card looks alike). When the
 * card is pointed at, the locator turns into a coarse mosaic that sharpens into the satellite
 * image, and the locator settles into a corner as a small map with a dot at the project. Leaving
 * plays it backwards. Cards without a satellite image stay as they are, and touch screens, where
 * there is no hover, keep the locator (the detail sheet shows the satellite).
 */
export const OpportunityMedia = ({ slug }: OpportunityMediaProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const locatorRef = useRef<HTMLImageElement | null>(null);
  const [insetShown, setInsetShown] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [active, setActive] = useState(false);
  const [credit, setCredit] = useState<string | null>(null);

  const base = `/api/opportunities/${slug}/image?rev=${opportunityImageRevision}`;

  useEffect(() => {
    const root = rootRef.current;
    const tile = root?.closest(".opportunity-tile");
    if (!root || !tile) {
      return;
    }

    let progress = 0;
    let frame = 0;
    let intent = 0;
    let wanted = false;
    let satellite: ImageBitmap | null = null;
    let missing = false;
    let loading = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const render = () => {
      const canvas = canvasRef.current;
      const locator = locatorRef.current;
      if (!canvas || !locator) {
        return;
      }
      // A canvas starts at 300x150; it must be sized to the card (square) or it is stretched.
      const size = Math.max(
        1,
        Math.round(Math.min(MAX_CANVAS_PX, root.clientWidth * Math.min(window.devicePixelRatio || 1, 2))),
      );
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
      }
      drawMosaic(canvas, progress, locator, satellite);
      setActive(progress > 0);
      setRevealed(progress >= 1);
    };

    const run = () => {
      cancelAnimationFrame(frame);
      const from = progress;
      // Without the satellite yet the transition holds at the coarsest step of the locator.
      const goal = wanted ? (satellite ? 1 : 0.5) : 0;
      const distance = Math.abs(goal - from);
      if (distance === 0) {
        return;
      }
      const duration = reduced.matches ? 0 : TRANSITION_MS * distance;
      const start = performance.now();
      const step = (now: number) => {
        const k = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
        progress = from + (goal - from) * ease(k);
        render();
        if (k < 1) {
          frame = requestAnimationFrame(step);
        } else if (!wanted) {
          satellite?.close();
          satellite = null;
        }
      };
      frame = requestAnimationFrame(step);
    };

    const fetchSatellite = () => {
      if (loading || satellite || missing) {
        return;
      }
      loading = true;
      void loadSatellite(base).then(async (loaded) => {
        loading = false;
        const blob = loaded?.blob;
        if (!blob) {
          missing = true;
          if (wanted) {
            wanted = false;
            run();
          }
          return;
        }
        const bitmap = await createImageBitmap(blob).catch(() => null);
        if (!bitmap) {
          missing = true;
          return;
        }
        if (!wanted) {
          bitmap.close();
          return;
        }
        satellite = bitmap;
        setCredit(loaded.attribution);
        setInsetShown(true);
        run();
      });
    };

    const enter = () => {
      wanted = true;
      clearTimeout(intent);
      intent = window.setTimeout(() => {
        if (wanted && !missing) {
          fetchSatellite();
          run();
        }
      }, HOVER_INTENT_MS);
    };
    const leave = () => {
      wanted = false;
      clearTimeout(intent);
      run();
    };

    const onPointerEnter = (event: Event) => {
      if ((event as PointerEvent).pointerType === "mouse") {
        enter();
      }
    };
    const onPointerLeave = (event: Event) => {
      if ((event as PointerEvent).pointerType === "mouse") {
        leave();
      }
    };
    // Keyboard focus reveals too; a mouse click focuses the link without :focus-visible.
    const onFocusIn = () => {
      if (tile.querySelector(":focus-visible")) {
        enter();
      }
    };

    tile.addEventListener("pointerenter", onPointerEnter);
    tile.addEventListener("pointerleave", onPointerLeave);
    tile.addEventListener("focusin", onFocusIn);
    tile.addEventListener("focusout", leave);
    return () => {
      tile.removeEventListener("pointerenter", onPointerEnter);
      tile.removeEventListener("pointerleave", onPointerLeave);
      tile.removeEventListener("focusin", onFocusIn);
      tile.removeEventListener("focusout", leave);
      cancelAnimationFrame(frame);
      clearTimeout(intent);
      satellite?.close();
    };
  }, [base]);

  return (
    <div className={`opportunity-media${active ? " is-active" : ""}`} ref={rootRef}>
      <Image
        alt=""
        className="opportunity-media-locator"
        fill
        ref={locatorRef}
        sizes="(max-width: 640px) 100vw, (max-width: 1200px) 50vw, 33vw"
        src={`${base}&kind=locator`}
        unoptimized
      />
      <canvas aria-hidden="true" className="opportunity-media-canvas" ref={canvasRef} />
      {credit ? <p className={`imagery-credit${revealed ? " is-revealed" : ""}`}>{credit}</p> : null}
      {insetShown ? (
        <div className={`opportunity-media-inset${revealed ? " is-revealed" : ""}`}>
          <Image alt="" fill onError={() => setInsetShown(false)} sizes="10vw" src={`${base}&kind=inset`} unoptimized />
        </div>
      ) : null}
    </div>
  );
};
