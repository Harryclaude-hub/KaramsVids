import * as React from "react";

import { cn } from "@/lib/utils";

// Apple-Rezept Eingabefeld: 44px hoch, 11px Radius, hauchduenne Linie, blauer Fokusring.
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-[11px] border border-border bg-input px-4 text-[15px] text-foreground outline-none transition-colors file:border-0 file:bg-transparent file:text-[13px] file:font-semibold file:text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
