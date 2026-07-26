import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Der Fokus-Ring ist Teil der Basisklassen, nicht optional: er ist für
  // Tastaturnutzer die einzige Orientierung.
  [
    'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium',
    'whitespace-nowrap transition-colors',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2',
    'focus-visible:ring-offset-background focus-visible:outline-none',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-subtle',
        secondary: 'bg-surface text-foreground border hover:bg-muted shadow-subtle',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground hover:opacity-90 shadow-subtle',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-11 px-6 text-base',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Rendert die Kindkomponente statt eines <button> (z. B. einen Link). */
    readonly asChild?: boolean;
    /** Zeigt einen Spinner und sperrt die Schaltfläche. */
    readonly loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled ?? loading}
      // aria-busy sagt Screenreadern, dass gearbeitet wird — der Spinner allein
      // ist für sie unsichtbar.
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          <span className="sr-only">Wird ausgeführt</span>
          {children}
        </>
      ) : (
        children
      )}
    </Component>
  );
}

export { buttonVariants };
