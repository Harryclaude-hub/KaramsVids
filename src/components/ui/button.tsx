import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Apple-Rezept: Primaer als blaue Pille, Sekundaer als graue Fuellung mit 11px Radius.
// Der Radius haengt an der Variante, die Groesse nur an Hoehe, Innenabstand und Schriftgrad.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "rounded-full bg-primary text-primary-foreground hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]",
        destructive:
          "rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "rounded-[11px] border border-border bg-card text-foreground hover:bg-secondary",
        secondary:
          "rounded-[11px] bg-secondary text-foreground hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]",
        ghost: "rounded-[11px] text-foreground hover:bg-secondary",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 text-[15px]",
        sm: "h-9 px-4 text-[13px]",
        lg: "h-12 px-6 text-[15px]",
        icon: "h-9 w-9 text-[13px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
