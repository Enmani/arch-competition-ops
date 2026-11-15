"use client";

import { useEffect, useState } from "react";

import { loadSatellite } from "@/lib/opportunity-satellite";

/**
 * The imagery credit for a satellite picture, printed as text over its bottom edge. The credit is
 * a licence condition of the tile provider, so it stays visible, but it is no longer baked into
 * the image. Renders nothing when the URL answers with the drawn locator.
 */
export const ImageryCredit = ({ url }: { url: string }) => {
  const [credit, setCredit] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void loadSatellite(url).then((satellite) => {
      if (current) {
        setCredit(satellite?.attribution ?? null);
      }
    });
    return () => {
      current = false;
    };
  }, [url]);

  return credit ? <p className="imagery-credit">{credit}</p> : null;
};
