import { Logo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { UserMenu } from '@/components/layout/user-menu';

export function AppHeader({
  displayName,
  email,
}: {
  readonly displayName: string | null;
  readonly email: string | null;
}) {
  return (
    <header className="bg-background/85 sticky top-0 z-30 border-b backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <UserMenu displayName={displayName} email={email} />
        </div>
      </div>
    </header>
  );
}
