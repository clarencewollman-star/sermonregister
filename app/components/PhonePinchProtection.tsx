"use client";

import { useEffect } from "react";

export default function PhonePinchProtection() {
  useEffect(() => {
    const isIPhone = /\biPhone\b/i.test(navigator.userAgent) || navigator.platform === "iPhone";
    if (!isIPhone && !window.matchMedia("(pointer: coarse)").matches) return;

    const root = document.documentElement;
    if (isIPhone) root.classList.add("iphone-no-pinch");

    // Safari can also emit gesture events even when touch-action handles pinch in other browsers.
    function preventPinch(event: Event) {
      if (isIPhone || document.querySelector(".bible-reader-page") ||
          (event.target instanceof Element && event.target.closest(".bible-dialog"))) {
        event.preventDefault();
      }
    }

    const options = { capture: true, passive: false };
    document.addEventListener("gesturestart", preventPinch, options);
    document.addEventListener("gesturechange", preventPinch, options);
    return () => {
      if (isIPhone) root.classList.remove("iphone-no-pinch");
      document.removeEventListener("gesturestart", preventPinch, options);
      document.removeEventListener("gesturechange", preventPinch, options);
    };
  }, []);

  return null;
}
