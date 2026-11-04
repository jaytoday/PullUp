// Adapted from Magic UI (MIT license), "animated-list". Changed: the original reveals its children one
// by one on a timer (a demo); this version shows every item at once and animates only items that
// arrive later, which suits live lists. With reduced motion items are plain elements.
"use client";

import { AnimatePresence, type HTMLMotionProps, motion } from "motion/react";
import { Children, type ComponentPropsWithoutRef, isValidElement } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const ITEM_MOTION = {
  layout: true,
  initial: { scale: 0.96, opacity: 0, y: -6 },
  animate: { scale: 1, opacity: 1, y: 0 },
  exit: { scale: 0.96, opacity: 0 },
  transition: { type: "spring", stiffness: 350, damping: 40 },
} as const;

/**
 * Wrap the items of a live list in `<AnimatePresence initial={false}>` and render each one with this
 * (keyed as usual). Items present on the first render appear at once; later ones pop into place.
 */
export function AnimatedListItem({ as = "li", ...props }: { as?: "li" | "div" } & HTMLMotionProps<"li">) {
  const reduced = useReducedMotion();
  const motionProps = reduced ? {} : ITEM_MOTION;
  if (as === "div") return <motion.div {...motionProps} {...(props as HTMLMotionProps<"div">)} />;
  return <motion.li {...motionProps} {...props} />;
}

export { AnimatePresence };

/** A `div` list whose children (by React key) animate in when they arrive after the first render. */
export function AnimatedList({ children, className, ...props }: ComponentPropsWithoutRef<"div">) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <div className={className} {...props}>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <AnimatedListItem as="div" key={item.key}>
            {item}
          </AnimatedListItem>
        ))}
      </AnimatePresence>
    </div>
  );
}
