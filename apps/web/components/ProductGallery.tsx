"use client";

import { useState } from "react";
import Image from "next/image";
import { productImageUrl } from "@/lib/image-url";

export function ProductGallery({
  images,
  alt,
}: {
  images: { id: string; storage_path: string; alt_text: string | null }[];
  alt: string;
}) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-xl border border-border bg-muted text-sm text-muted-foreground">
        No image
      </div>
    );
  }

  const active = images[activeIdx];

  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-muted">
        <Image
          src={productImageUrl(active.storage_path)}
          alt={active.alt_text || alt}
          fill
          sizes="(min-width: 1024px) 40vw, 90vw"
          className="object-cover"
          priority
        />
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex gap-2">
          {images.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={`relative h-16 w-16 overflow-hidden rounded-lg border-2 ${
                idx === activeIdx ? "border-brand-orange" : "border-border"
              }`}
            >
              <Image src={productImageUrl(img.storage_path)} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
