import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Apple-Rezept Status-Pille: rund, 12px, halbfett, Statusfarbe mit /15 Hintergrund.
const badgeVariants = cva(
  "inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-foreground",
        destructive: "bg-destructive/15 text-destructive",
        success: "bg-success/15 text-success",
        warning: "bg-warning/15 text-warning",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
