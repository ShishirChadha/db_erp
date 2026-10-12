import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DigitalBluez",
    short_name: "DigitalBluez",
    description: "Quality-checked refurbished laptops, desktops, monitors and accessories, backed by warranty.",
    start_url: "/",
    display: "browser",
    icons: [
      { src: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
