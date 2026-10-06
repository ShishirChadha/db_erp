"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { productImageUrl } from "@/lib/image-url";

export interface GalleryImage {
  id: string;
  storage_path: string;
  alt_text: string | null;
  width?: number | null;
  height?: number | null;
}

const DEFAULT_ASPECT = "1 / 1";

// How far "in" the hover magnifier and the mobile double-tap zoom go. Only
// one derivative of each photo is stored (longest side capped at 1600px,
// apps/erp/lib/image-process.ts), so this is a real ceiling, not a UI
// choice -- going much past 2.5x on a 1600px source starts showing visible
// softness on a modern phone/laptop screen, so we don't offer it.
const ZOOM_SCALE = 2.2;

export function ProductGallery({ images, alt }: { images: GalleryImage[]; alt: string }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (images.length === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-xl border border-border bg-muted text-sm text-muted-foreground">
        No image
      </div>
    );
  }

  const active = images[activeIdx];
  // The container's aspect-ratio matches the photo's own natural dimensions
  // (captured at upload time in the ERP) so nothing is ever cropped away --
  // same pattern already shipped for home banners (HomeBanners.tsx). Falls
  // back to a square for pre-feature rows with no stored width/height.
  const aspect =
    active.width && active.height ? `${active.width} / ${active.height}` : DEFAULT_ASPECT;

  return (
    <div>
      <HoverZoomImage
        src={productImageUrl(active.storage_path)}
        alt={active.alt_text || alt}
        aspect={aspect}
        onOpenLightbox={() => setLightboxOpen(true)}
      />
      {images.length > 1 && (
        <div className="mt-3 flex gap-2">
          {images.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`relative h-16 w-16 overflow-hidden rounded-lg border-2 bg-muted ${
                idx === activeIdx ? "border-brand-orange" : "border-border"
              }`}
            >
              {/* object-contain here too -- a square 64px thumbnail is a fixed
                  frame these photos were never meant to fill, so letterboxing
                  beats cropping the same way it does everywhere else. */}
              <Image src={productImageUrl(img.storage_path)} alt="" fill sizes="64px" className="object-contain" />
            </button>
          ))}
        </div>
      )}

      {lightboxOpen && mounted &&
        createPortal(
          <Lightbox
            images={images}
            alt={alt}
            startIdx={activeIdx}
            onIndexChange={setActiveIdx}
            onClose={() => setLightboxOpen(false)}
          />,
          document.body
        )}
    </div>
  );
}

// Desktop hover magnifier: a lens follows the cursor over the main image and
// a second, larger copy of the same photo is scrolled underneath it via
// background-position -- no second image request, since the already-loaded
// 1600px source is simply rendered bigger. Tapping/clicking on touch devices
// opens the fullscreen lightbox instead (there's no cursor to hover with).
function HoverZoomImage({
  src,
  alt,
  aspect,
  onOpenLightbox,
}: {
  src: string;
  alt: string;
  aspect: string;
  onOpenLightbox: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    []
  );

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPos({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-xl border border-border bg-muted"
      style={{ aspectRatio: aspect }}
      onMouseEnter={() => !reducedMotion && setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onMouseMove={handleMove}
      onClick={onOpenLightbox}
      role="button"
      tabIndex={0}
      aria-label="View full image"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpenLightbox();
      }}
    >
      <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 40vw, 90vw" className="object-contain" priority />
      {hovering && (
        <div
          className="pointer-events-none absolute inset-0 hidden lg:block"
          style={{
            backgroundImage: `url(${src})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${ZOOM_SCALE * 100}%`,
            backgroundPosition: `${pos.x}% ${pos.y}%`,
          }}
        />
      )}
      {/* Small affordance so it's clear the image is interactive even before
          hovering -- especially since on touch devices it's the only hint
          that tapping opens the lightbox. */}
      <span className="absolute bottom-2 right-2 rounded-full bg-black/50 p-1.5 text-white lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.35-4.35" />
          <path d="M11 8v6M8 11h6" />
        </svg>
      </span>
    </div>
  );
}

// Fullscreen lightbox -- swipe/arrow between images, double-tap (or click) to
// toggle a fixed zoom level centered on where you tapped, Escape closes.
function Lightbox({
  images,
  alt,
  startIdx,
  onIndexChange,
  onClose,
}: {
  images: GalleryImage[];
  alt: string;
  startIdx: number;
  onIndexChange: (idx: number) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIdx);
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const touchStartX = useRef<number | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  function go(dir: 1 | -1) {
    setZoomed(false);
    setIdx((i) => {
      const next = (i + dir + images.length) % images.length;
      onIndexChange(next);
      return next;
    });
  }

  function handleTap(e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) {
    const now = Date.now();
    const isDoubleTap = now - lastTap.current < 300;
    lastTap.current = now;
    if (!isDoubleTap) return;

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const clientX = "touches" in e ? e.changedTouches[0]?.clientX ?? rect.left : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e ? e.changedTouches[0]?.clientY ?? rect.top : (e as React.MouseEvent).clientY;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    setOrigin(`${x}% ${y}%`);
    setZoomed((z) => !z);
  }

  const active = images[idx];

  return (
    <div className="fixed inset-0 z-[100] bg-black/95" role="dialog" aria-modal="true" aria-label="Image viewer">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next image"
            className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </>
      )}

      <div
        className="flex h-full w-full items-center justify-center overflow-hidden px-4"
        onClick={handleTap}
        onTouchEnd={(e) => {
          handleTap(e);
          const endX = e.changedTouches[0]?.clientX ?? 0;
          if (touchStartX.current !== null) {
            const dx = endX - touchStartX.current;
            if (!zoomed && Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          }
          touchStartX.current = null;
        }}
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0]?.clientX ?? null;
        }}
      >
        <div
          className="relative h-full w-full max-w-4xl transition-transform duration-200"
          style={{
            transform: zoomed ? `scale(${ZOOM_SCALE})` : "scale(1)",
            transformOrigin: origin,
          }}
        >
          <Image
            src={productImageUrl(active.storage_path)}
            alt={active.alt_text || alt}
            fill
            sizes="100vw"
            className="object-contain"
            priority
          />
        </div>
      </div>

      <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/70">
        {images.length > 1 ? `${idx + 1} / ${images.length} · ` : ""}
        Double-tap to zoom
      </p>
    </div>
  );
}
