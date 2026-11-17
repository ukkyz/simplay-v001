import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simplayz — World Simulation & City Operations Console",
  description:
    "Simplayz — a world simulation where CEOs claim land on the real map, build resource territories, and run a city through an SDLC pipeline with an AI executive board.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      {/*
        The console is a fixed-height, client-rendered application surface. Page
        content that depends on the anonymous session is loaded in the browser
        (see GameShell) so server rendering never attempts to read localStorage,
        Leaflet, Three.js or WebGL.
      */}
      <body>{children}</body>
    </html>
  );
}
