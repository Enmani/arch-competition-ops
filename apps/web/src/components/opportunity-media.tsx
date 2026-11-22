"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { StaticOpportunityPreview } from "@arch-competition/previews/serve";

import { loadSatellite } from "@/lib/opportunity-satellite";
import { opportunityImageRevision } from "@/lib/opportunity-preview-revision";

type OpportunityMediaProps = {
  preview?: StaticOpportunityPreview;
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
export const OpportunityMedia = ({ preview, slug }: OpportunityMediaProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [satellite, setSatellite] = useState<Satellite | null>(null);
  const [shown, setShown] = useState(false);

  const base = `/api/opportunities/${slug}/image?rev=${opportunityImageRevision}`;
  const staticImage = preview?.image;
  const attribution = preview?.attribution;
  const inset = preview ? preview.inset : `${base}&kind=inset`;
  const useStatic = preview !== undefined;

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

    const fetchSatellite = async () => {
      loading = true;
      const loaded = useStatic ? null : await loadSatellite(base);
      if (disposed || (!staticImage && !loaded)) {
        loading = false;
        missing = true;
        return;
      }
      const blobUrl = loaded ? URL.createObjectURL(loaded.blob) : null;
      const url = staticImage ?? blobUrl!;
      // Decode before the fade starts. Fallback insets may return 404 for an unknown location.
      const [decoded, hasInset] = await Promise.all([preload(url), inset ? preload(inset) : false]);
      loading = false;
      if (disposed || !decoded) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        missing ||= !decoded;
        return;
      }
      objectUrl = blobUrl;
      ready = true;
      setSatellite({ attribution: attribution ?? loaded?.attribution ?? null, hasInset, url });
      reveal();
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
          void fetchSatellite();
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
  }, [attribution, base, inset, staticImage, useStatic]);

  return (
    <div className={`opportunity-media${shown ? " is-shown" : ""}`} ref={rootRef}>
      <Image
        alt=""
        className="opportunity-media-locator"
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1200px) 50vw, 33vw"
        src={preview?.locator ?? `${base}&kind=locator`}
        unoptimized
      />
      {satellite ? (
        // The satellite has already been decoded off-screen.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="opportunity-media-satellite" src={satellite.url} />
      ) : null}
      {satellite?.attribution ? <p className="imagery-credit">{satellite.attribution}</p> : null}
      {satellite?.hasInset && inset ? (
        <div className="opportunity-media-inset">
          <Image alt="" fill sizes="10vw" src={inset} unoptimized />
        </div>
      ) : null}
    </div>
  );
};
