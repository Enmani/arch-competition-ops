"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { loadSatellite } from "@/lib/opportunity-satellite";
import { opportunityImageRevision } from "@/lib/opportunity-preview-revision";

type OpportunityMediaProps = {
  slug: string;
};

const HOVER_INTENT_MS = 90;

type Satellite = { attribution: string | null; hasInset: boolean; url: string };

/** Loads and decodes an image off screen; false when it is missing or broken. */
const preload = (src: string) => {
  const image = new window.Image();
  image.src = src;
  return image.decode().then(
    () => true,
    () => false,
  );
};

/**
 * A card's picture. At rest it is the drawn locator (cheap, and every card looks alike). When the
 * card is pointed at, the satellite image fades in while the locator shrinks into a corner as a
 * small map with a dot at the project (all CSS, see tiles.css); leaving plays it backwards. Cards
 * without a satellite image stay as they are, and touch screens, where there is no hover, keep
 * the locator (the detail sheet shows the satellite).
 */
export const OpportunityMedia = ({ slug }: OpportunityMediaProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [satellite, setSatellite] = useState<Satellite | null>(null);
  const [shown, setShown] = useState(false);

  const base = `/api/opportunities/${slug}/image?rev=${opportunityImageRevision}`;

  useEffect(() => {
    const tile = rootRef.current?.closest(".opportunity-tile");
    if (!tile) {
      return;
    }

    let intent = 0;
    let wanted = false;
    let missing = false;
    let loading = false;
    let ready = false;
    let objectUrl: string | null = null;
    let disposed = false;

    // The element mounts hidden and is revealed two frames later, so the browser has a starting
    // style to transition from.
    const reveal = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!disposed && wanted) {
            setShown(true);
          }
        }),
      );

    const fetchSatellite = () => {
      loading = true;
      void loadSatellite(base).then(async (loaded) => {
        loading = false;
        if (disposed || !loaded?.blob) {
          missing = true;
          return;
        }
        const url = URL.createObjectURL(loaded.blob);
        // Decode both before the fade starts, so it never shows a half-painted picture. The corner
        // map exists only when the project's position is really known (otherwise 404).
        const [decoded, hasInset] = await Promise.all([preload(url), preload(`${base}&kind=inset`)]);
        if (disposed || !decoded) {
          URL.revokeObjectURL(url);
          missing ||= !decoded;
          return;
        }
        objectUrl = url;
        ready = true;
        setSatellite({ attribution: loaded.attribution, hasInset, url });
        reveal();
      });
    };

    const enter = () => {
      wanted = true;
      clearTimeout(intent);
      intent = window.setTimeout(() => {
        if (!wanted || missing) {
          return;
        }
        if (ready) {
          setShown(true);
        } else if (!loading) {
          fetchSatellite();
        }
      }, HOVER_INTENT_MS);
    };
    const leave = () => {
      wanted = false;
      clearTimeout(intent);
      setShown(false);
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
      disposed = true;
      tile.removeEventListener("pointerenter", onPointerEnter);
      tile.removeEventListener("pointerleave", onPointerLeave);
      tile.removeEventListener("focusin", onFocusIn);
      tile.removeEventListener("focusout", leave);
      clearTimeout(intent);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [base]);

  return (
    <div className={`opportunity-media${shown ? " is-shown" : ""}`} ref={rootRef}>
      <Image
        alt=""
        className="opportunity-media-locator"
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1200px) 50vw, 33vw"
        src={`${base}&kind=locator`}
        unoptimized
      />
      {satellite ? (
        // A blob URL from the shared satellite cache: next/image has nothing to optimise here.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="opportunity-media-satellite" src={satellite.url} />
      ) : null}
      {satellite?.attribution ? <p className="imagery-credit">{satellite.attribution}</p> : null}
      {satellite?.hasInset ? (
        <div className="opportunity-media-inset">
          <Image alt="" fill sizes="10vw" src={`${base}&kind=inset`} unoptimized />
        </div>
      ) : null}
    </div>
  );
};
