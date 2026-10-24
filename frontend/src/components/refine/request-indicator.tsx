"use client";

import { motion, useReducedMotion } from "motion/react";

/** design.md §4.2: three amber dots pulsing while /v1/enhance is in flight. */
export function RequestIndicator() {
  const reduced = useReducedMotion();
  return (
    <span role="status" aria-label="Generating suggestion" className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1 rounded-full bg-marker"
          initial={{ opacity: 1 - i * 0.35 }}
          animate={reduced ? undefined : { opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}
